-- Walk-through checklists: items checked before a step starts, because that step covers up the work.
create table public.step_checks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 300),
  done boolean not null default false,
  done_at timestamptz,
  done_by text not null default '',
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index on public.step_checks (job_id);
create index on public.step_checks (task_id);
alter table public.step_checks enable row level security;
create policy staff_all on public.step_checks for all to authenticated using (private.is_staff()) with check (private.is_staff());
revoke all on public.step_checks from anon;

-- How much of each budget line's work is done.
alter table public.budget_lines add column pct_complete smallint check (pct_complete is null or pct_complete between 0 and 100);
