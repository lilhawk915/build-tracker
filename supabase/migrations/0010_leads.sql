-- Leads: people who want you to build for them, before there is a job. Investors, subdivisions,
-- custom homes. Each lead moves along a board: new -> appointment set -> met -> waiting on prices ->
-- quote sent -> won (it becomes a job) or lost. Leads carry phone numbers and projected profit,
-- so they are for admins only.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  phone text not null default '',
  email text not null default '',
  kind text not null default 'custom_home'
    check (kind in ('custom_home', 'investor', 'development', 'multi_family', 'remodel', 'other')),
  stage text not null default 'new'
    check (stage in ('new', 'appointment', 'met', 'waiting', 'quoted', 'won', 'lost')),
  -- The lot or property, and its county.
  address text not null default '',
  county text not null default '',
  -- How many houses this lead could turn into, and what you expect to make on each one.
  houses int not null default 1 check (houses >= 1),
  profit_per_house_cents bigint check (profit_per_house_cents is null or profit_per_house_cents >= 0),
  -- The deal in words: "Split profit, or $30K a build".
  deal_terms text not null default '',
  source text not null default '',
  next_step text not null default '',
  next_date date,
  lost_reason text not null default '',
  notes text not null default '',
  -- A running log of calls and meetings. Each entry: { "at": timestamp, "text": text }, newest first.
  log jsonb not null default '[]' check (jsonb_typeof(log) = 'array'),
  job_id uuid references public.jobs (id) on delete set null,
  estimate_id uuid references public.estimates (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.leads (stage);
create index on public.leads (job_id);
create index on public.leads (estimate_id);

create trigger leads_touch before update on public.leads
  for each row execute function private.touch_updated_at();

-- Meetings with a lead: at the lot, the office, or a call. The time is optional ("over Thanksgiving").
create table public.lead_appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  appt_date date not null,
  appt_time time,
  place text not null default '',
  who text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index on public.lead_appointments (lead_id);
create index on public.lead_appointments (appt_date);

alter table public.leads enable row level security;
alter table public.lead_appointments enable row level security;
create policy admin_all on public.leads for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy admin_all on public.lead_appointments for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
revoke all on public.leads from anon;
revoke all on public.lead_appointments from anon;
