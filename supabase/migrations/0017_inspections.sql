-- County inspections. task_id is the step that can't start until the inspection passes.
create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 120),
  result text not null default 'not_scheduled' check (result in ('not_scheduled', 'scheduled', 'passed', 'failed', 'not_needed')),
  scheduled_date date,
  result_date date,
  inspector text not null default '',
  notes text not null default '',
  vendor_id uuid references public.vendors (id) on delete set null,  -- whose work failed, last time it failed
  fail_count integer not null default 0 check (fail_count >= 0),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index on public.inspections (job_id);
create index on public.inspections (task_id);
create index on public.inspections (vendor_id);
alter table public.inspections enable row level security;
create policy staff_all on public.inspections for all to authenticated using (private.is_staff()) with check (private.is_staff());
revoke all on public.inspections from anon;
grant select, insert, update, delete on public.inspections to authenticated;
