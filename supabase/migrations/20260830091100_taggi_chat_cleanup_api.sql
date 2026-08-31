-- API interna usada somente pela Edge Function de retenção.

create or replace function private_taggi.chat_retention_secret_valid(p_secret text)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1 from private_taggi.chat_retention_config c
    where c.id=true and c.secret_hash=extensions.digest(p_secret,'sha256')
  );
$$;

create or replace function public.taggi_chat_cleanup_batch(p_secret text,p_limit integer default 100)
returns table (cleanup_id bigint,bucket_id text,object_path text)
language plpgsql
security definer
set search_path=''
as $$
begin
  if not (select private_taggi.chat_retention_secret_valid(p_secret)) then raise exception using errcode='42501',message='Segredo de retenção inválido.'; end if;
  return query
  select q.id,q.bucket_id,q.object_path
  from private_taggi.chat_file_cleanup_queue q
  order by q.queued_at
  limit least(greatest(coalesce(p_limit,100),1),500)
  for update skip locked;
end;
$$;

create or replace function public.taggi_chat_cleanup_complete(p_secret text,p_cleanup_id bigint,p_success boolean,p_error text default null)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not (select private_taggi.chat_retention_secret_valid(p_secret)) then raise exception using errcode='42501',message='Segredo de retenção inválido.'; end if;
  if p_success then
    delete from private_taggi.chat_file_cleanup_queue where id=p_cleanup_id;
  else
    update private_taggi.chat_file_cleanup_queue set attempts=attempts+1,last_error=left(coalesce(p_error,'Falha desconhecida'),1000) where id=p_cleanup_id;
  end if;
end;
$$;

revoke execute on function public.taggi_chat_cleanup_batch(text,integer) from public,anon,authenticated;
revoke execute on function public.taggi_chat_cleanup_complete(text,bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.taggi_chat_cleanup_batch(text,integer) to service_role;
grant execute on function public.taggi_chat_cleanup_complete(text,bigint,boolean,text) to service_role;
