-- Running jobs day to day: crew logins and assignments, job needs, materials, contractor confirmations, and a contact log.
-- Crew see the work on jobs they're assigned to. They never see money, subs' bills, or other jobs.

-- ---------- crew role ----------
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'staff', 'crew', 'sub', 'none'));
alter table public.team_invites drop constraint team_invites_role_check;
alter table public.team_invites add constraint team_invites_role_check check (role in ('admin', 'staff', 'crew', 'sub'));
alter table public.profiles add column phone text not null default '';

-- ---------- tasks: who's doing it, and whether the contractor has been reached ----------
alter table public.tasks
  add column assigned_to uuid references public.profiles (id) on delete set null,
  add column contact_status text not null default 'not_contacted'
    check (contact_status in ('not_contacted', 'contacted', 'confirmed')),
  add column contacted_at timestamptz,
  add column confirmed_at timestamptz;
create index on public.tasks (assigned_to);

-- A confirmation is for specific dates and a specific sub. If either changes, they need to hear about it again.
create function private.task_reset_contact() returns trigger
language plpgsql as $$
begin
  if (new.start_date, new.end_date, new.vendor_id) is distinct from (old.start_date, old.end_date, old.vendor_id) then
    new.contact_status := 'not_contacted';
    new.contacted_at := null;
    new.confirmed_at := null;
  end if;
  return new;
end $$;
create trigger task_reset_contact before update on public.tasks
  for each row execute function private.task_reset_contact();

-- ---------- what the job needs ----------
create table public.scope_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  title text not null,
  location text not null default '',
  details text not null default '',
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.scope_items (job_id);

-- ---------- materials ----------
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  name text not null,
  quantity text not null default '',
  supplier text not null default '',
  order_number text not null default '',
  status text not null default 'needed' check (status in ('needed', 'ordered', 'arrived')),
  needed_by date,
  ordered_date date,
  expected_date date,
  arrived_date date,
  cost_cents bigint,  -- for reference only; budget actuals still come from bills
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index on public.materials (job_id);

-- ---------- contact log ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  recipient text not null default '',
  channel text not null check (channel in ('text', 'email', 'call')),
  body text not null default '',
  sent_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.notifications (job_id);

alter table public.scope_items enable row level security;
alter table public.materials enable row level security;
alter table public.notifications enable row level security;

create policy staff_all on public.scope_items for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.materials for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.notifications for all to authenticated using (private.is_staff()) with check (private.is_staff());
revoke all on public.scope_items, public.materials, public.notifications from anon;

-- ---------- what crew can see ----------
-- Open jobs where this person has a task. Definer rights, so policies on tasks can use it without looping.
create function private.crew_jobs() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct t.job_id from public.tasks t
  join public.jobs j on j.id = t.job_id
  where t.assigned_to = auth.uid() and j.status <> 'closed' and private.my_role() = 'crew';
$$;
revoke execute on function private.crew_jobs() from public, anon;
grant execute on function private.crew_jobs() to authenticated;
revoke execute on function private.task_reset_contact() from public, anon;

create policy crew_read on public.tasks for select to authenticated using (job_id in (select private.crew_jobs()));
create policy crew_read on public.scope_items for select to authenticated using (job_id in (select private.crew_jobs()));
create policy crew_read on public.selections for select to authenticated using (job_id in (select private.crew_jobs()));
-- Plans, yes. Contracts, closing papers, and bids, no.
create policy crew_read on public.documents for select to authenticated using (
  job_id in (select private.crew_jobs()) and category in ('Drawings', 'Engineering', 'Permits and inspections')
);
create policy crew_read_files on storage.objects for select to authenticated using (
  bucket_id = 'job-files'
  and private.my_role() = 'crew'
  and exists (select 1 from public.documents d where d.file_path = name)
);

create or replace function public.my_jobs() returns table (id uuid, name text, address text)
language sql stable security definer set search_path = '' as $$
  select j.id, j.name, j.address from public.jobs j
  where exists (select 1 from public.pos p where p.job_id = j.id
                  and p.vendor_id = private.my_vendor() and p.status <> 'draft')
     or exists (select 1 from public.tasks t where t.job_id = j.id
                  and t.vendor_id = private.my_vendor())
     or j.id in (select private.crew_jobs());
$$;

-- Materials hold cost, so crew read them through this list, which leaves cost out.
create function public.crew_materials()
returns table (id uuid, job_id uuid, name text, quantity text, supplier text, status text,
               needed_by date, expected_date date, arrived_date date, notes text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.job_id, m.name, m.quantity, m.supplier, m.status, m.needed_by, m.expected_date, m.arrived_date, m.notes
  from public.materials m where m.job_id in (select private.crew_jobs());
$$;

create function public.mark_material_arrived(p_material uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.materials set status = 'arrived', arrived_date = current_date
  where id = p_material and status <> 'arrived' and job_id in (select private.crew_jobs());
  if not found then raise exception 'This material is not on one of your jobs, or it already arrived.'; end if;
end $$;

-- Crew update their own tasks, subs update theirs. Same function, so the portal doesn't change.
create or replace function public.set_task_status(p_task uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('todo', 'in_progress', 'done') then raise exception 'Unknown status.'; end if;
  update public.tasks set status = p_status,
         completed_at = case when p_status = 'done' then now() else null end
  where id = p_task
    and (vendor_id = private.my_vendor() or (assigned_to = auth.uid() and private.my_role() = 'crew'));
  if not found then raise exception 'This task is not assigned to you.'; end if;
end $$;

-- A sub taps "I'll be there" in the portal.
create function public.confirm_task(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.tasks set contact_status = 'confirmed', confirmed_at = now()
  where id = p_task and vendor_id = private.my_vendor();
  if not found then raise exception 'This task is not assigned to you.'; end if;
end $$;

revoke execute on function public.crew_materials() from public, anon;
revoke execute on function public.mark_material_arrived(uuid) from public, anon;
revoke execute on function public.confirm_task(uuid) from public, anon;
grant execute on function public.crew_materials() to authenticated;
grant execute on function public.mark_material_arrived(uuid) to authenticated;
grant execute on function public.confirm_task(uuid) to authenticated;
