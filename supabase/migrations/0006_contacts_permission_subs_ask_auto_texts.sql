-- 1. A separate permission for seeing contractor contacts, so an office person can call without being an admin.
-- 2. Subs can ask for materials on their jobs.
-- 3. Automatic contractor texts. Installed switched off.

-- ---------- contacts permission ----------
alter table public.profiles add column can_view_contacts boolean not null default false;

-- Admins always. Staff only if an admin turned it on. Crew and subs never, even if the flag gets set.
create function private.can_view_contacts() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select role = 'admin' or (role = 'staff' and can_view_contacts)
    from public.profiles where id = auth.uid()
  ), false);
$$;
revoke execute on function private.can_view_contacts() from public, anon;
grant execute on function private.can_view_contacts() to authenticated;

drop policy admin_all on public.vendor_contacts;
create policy contacts_all on public.vendor_contacts for all to authenticated
  using (private.can_view_contacts()) with check (private.can_view_contacts());

drop policy read_profiles on public.profiles;
create policy read_profiles on public.profiles for select to authenticated using (
  id = auth.uid() or private.can_view_contacts() or (private.is_staff() and role <> 'sub')
);

-- Permission to auto-text is per person and starts off. Only a mobile number can be used.
alter table public.vendor_contacts add column auto_text_ok boolean not null default false;

-- ---------- subs ask for materials ----------
create or replace function public.request_material(p_job uuid, p_name text, p_quantity text, p_needed_by date, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare who text; v uuid := private.my_vendor();
begin
  if p_job not in (select m.id from public.my_jobs() m) then raise exception 'This job is not one of yours.'; end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then raise exception 'Say what you need.'; end if;
  if v is not null then
    select name into who from public.vendors where id = v;
  else
    select coalesce(nullif(name, ''), email) into who from public.profiles where id = auth.uid();
  end if;
  insert into public.materials (job_id, name, quantity, needed_by, notes, status, requested_by, requested_by_name, requested_at)
  values (p_job, left(btrim(p_name), 200), left(btrim(coalesce(p_quantity, '')), 60), p_needed_by,
          left(coalesce(p_notes, ''), 1000), 'needed', auth.uid(), who, now());
end $$;

-- A sub sees only what they asked for, never the job's material list or costs.
create function public.my_material_requests()
returns table (id uuid, job_id uuid, name text, quantity text, status text, needed_by date, expected_date date, arrived_date date, notes text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.job_id, m.name, m.quantity, m.status, m.needed_by, m.expected_date, m.arrived_date, m.notes
  from public.materials m where m.requested_by = auth.uid();
$$;
revoke execute on function public.my_material_requests() from public, anon;
grant execute on function public.my_material_requests() to authenticated;

-- ---------- automatic texts ----------
create table public.auto_text_settings (
  id text primary key default 'main' check (id = 'main'),
  enabled boolean not null default false,
  sender_name text not null default '',
  notice_days int not null default 7 check (notice_days between 1 and 60),
  reminder_days int not null default 1 check (reminder_days between 1 and 30),
  start_hour int not null default 9 check (start_hour between 0 and 23),
  end_hour int not null default 18 check (end_hour between 1 and 24),
  daily_cap int not null default 25 check (daily_cap between 1 and 500),
  updated_at timestamptz not null default now()
);
insert into public.auto_text_settings (id) values ('main');

create table public.auto_texts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks (id) on delete set null,
  job_id uuid references public.jobs (id) on delete cascade,
  vendor_id uuid references public.vendors (id) on delete set null,
  kind text not null check (kind in ('notice', 'reminder')),
  start_date date not null,
  recipient text not null default '',
  phone text not null default '',
  body text not null default '',
  status text not null check (status in ('accepted', 'failed')),  -- accepted means Kixie took it, not that it arrived
  error text not null default '',
  created_at timestamptz not null default now()
);
create index on public.auto_texts (task_id);
-- The same text for the same dates can never be accepted twice, even if two runs overlap.
create unique index auto_texts_once on public.auto_texts (task_id, kind, start_date, vendor_id) where status = 'accepted';

alter table public.auto_text_settings enable row level security;
alter table public.auto_texts enable row level security;
create policy read_settings on public.auto_text_settings for select to authenticated using (private.can_view_contacts());
create policy admin_edit on public.auto_text_settings for update to authenticated using (private.is_admin()) with check (private.is_admin());
-- The log holds phone numbers. Only the server writes it.
create policy read_log on public.auto_texts for select to authenticated using (private.can_view_contacts());
revoke all on public.auto_text_settings, public.auto_texts from anon;
