-- One e-mail/account may belong to only one active Taggi company.
create unique index if not exists taggi_group_members_one_active_company_idx
on public.taggi_group_members(user_id)
where status='active';

create or replace function private_taggi.enforce_one_active_company()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='active' and exists(
    select 1 from public.taggi_group_members m
    where m.user_id=new.user_id and m.status='active' and m.group_id<>new.group_id
  ) then
    raise exception using errcode='23505',message='Cada conta pode participar de apenas uma empresa. Use outro e-mail para cadastrar ou entrar em outra empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists taggi_one_active_company on public.taggi_group_members;
create trigger taggi_one_active_company
before insert or update of status,group_id,user_id on public.taggi_group_members
for each row execute function private_taggi.enforce_one_active_company();
