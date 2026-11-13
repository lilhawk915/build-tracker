-- Sign in with a username and password. The owner sets both on the Team page; no email is needed.
alter table public.profiles add column username text unique
  check (username ~ '^[a-z0-9._-]{2,30}$');

-- The sign-in screen turns a username into the login it belongs to. People with no access get nothing back.
create function public.login_email(u text) returns text
language sql stable security definer set search_path = '' as $$
  select email from public.profiles where username = lower(trim(u)) and role <> 'none' limit 1;
$$;
revoke all on function public.login_email(text) from public;
grant execute on function public.login_email(text) to anon, authenticated;
