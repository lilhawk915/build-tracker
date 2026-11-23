-- Order-by dates: how long each item takes to arrive, and the schedule step it is for.
alter table public.materials add column lead_days integer check (lead_days is null or lead_days between 0 and 365);
alter table public.materials add column task_id uuid references public.tasks(id) on delete set null;
create index materials_task_id_idx on public.materials(task_id);

-- What each day on a job costs to carry: loan interest plus other monthly costs.
alter table public.jobs add column interest_rate numeric(5,2) check (interest_rate is null or interest_rate between 0 and 100);
alter table public.jobs add column holding_monthly_cents bigint not null default 0;
