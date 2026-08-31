-- Company codes are resolved only after account authentication.
revoke execute on function public.taggi_find_group(text) from anon;
grant execute on function public.taggi_find_group(text) to authenticated;
