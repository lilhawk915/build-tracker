-- 1. Contractor contact details are admin-only. Row rules can't hide single columns, so they get their own table.
-- 2. Crew can ask for materials from the job.

-- ---------- private contacts ----------
create table public.vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  name text not null default '',
  title text not null default '',
  mobile text not null default '',
  office_phone text not null default '',
  email text not null default '',
  address text not null default '',
  notes text not null default '',
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.vendor_contacts (vendor_id);

insert into public.vendor_contacts (vendor_id, name, mobile, email, is_primary)
select id, contact_name, phone, email, true from public.vendors
where contact_name <> '' or phone <> '' or email <> '';

alter table public.vendors drop column contact_name, drop column phone, drop column email;

alter table public.vendor_contacts enable row level security;
create policy admin_all on public.vendor_contacts for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
revoke all on public.vendor_contacts from anon;

-- A sub's login email and phone are contact info too, so staff no longer read sub profiles. Admins still do.
drop policy read_self_or_staff on public.profiles;
create policy read_profiles on public.profiles for select to authenticated using (
  id = auth.uid() or private.is_admin() or (private.is_staff() and role <> 'sub')
);

-- ---------- material requests from the job ----------
alter table public.materials
  add column requested_by uuid references public.profiles (id) on delete set null,
  add column requested_by_name text not null default '',
  add column requested_at timestamptz;

create function public.request_material(p_job uuid, p_name text, p_quantity text, p_needed_by date, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  if p_job not in (select private.crew_jobs()) then raise exception 'This job is not one of yours.'; end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then raise exception 'Say what you need.'; end if;
  select coalesce(nullif(name, ''), email) into who from public.profiles where id = auth.uid();
  insert into public.materials (job_id, name, quantity, needed_by, notes, status, requested_by, requested_by_name, requested_at)
  values (p_job, left(btrim(p_name), 200), left(btrim(coalesce(p_quantity, '')), 60), p_needed_by,
          left(coalesce(p_notes, ''), 1000), 'needed', auth.uid(), who, now());
end $$;
revoke execute on function public.request_material(uuid, text, text, date, text) from public, anon;
grant execute on function public.request_material(uuid, text, text, date, text) to authenticated;

-- Same list as before, plus who asked. Still no cost.
drop function public.crew_materials();
create function public.crew_materials()
returns table (id uuid, job_id uuid, name text, quantity text, supplier text, status text,
               needed_by date, expected_date date, arrived_date date, notes text, requested_by_name text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.job_id, m.name, m.quantity, m.supplier, m.status, m.needed_by, m.expected_date, m.arrived_date, m.notes, m.requested_by_name
  from public.materials m where m.job_id in (select private.crew_jobs());
$$;
revoke execute on function public.crew_materials() from public, anon;
grant execute on function public.crew_materials() to authenticated;
