-- Estimates (moved in from the Estimator app) and simple job expenses.
-- Who sees what:
--   Admins: everything, including markups and profit.
--   Staff:  estimates, line items, costs and the price catalog, but never markups, profit or saved versions
--           (a saved version freezes markups, so it would give profit away).
--   Crew, subs, no-access logins, visitors: nothing.
-- Line items and inputs are kept in the Estimator's own format, so its tested pricing math works unchanged.

-- ---------- price catalog ----------
create table public.catalog_items (
  id text primary key,                          -- "<family>.<grade>" or "<family>", as in the Estimator
  division text not null,
  name text not null,
  unit text not null,
  unit_cost numeric not null default 0,         -- material, per unit, in dollars, exactly as typed (no rounding)
  labor_cost numeric not null default 0,
  grade text not null default 'mid' check (grade in ('builder', 'mid', 'premium')),
  notes text not null default '',
  verified boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------- company details for quote PDFs ----------
create table public.company_settings (
  id text primary key default 'main' check (id = 'main'),
  name text not null default '',
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  license text not null default '',
  logo_data_url text,
  default_assumptions text not null default '',
  default_validity_days int not null default 30 check (default_validity_days between 1 and 365),
  updated_at timestamptz not null default now()
);
insert into public.company_settings (id) values ('main');

-- Starting markups for new quotes. Admin only.
create table public.markup_defaults (
  id text primary key default 'main' check (id = 'main'),
  sales_tax_pct numeric not null default 0,
  contingency_pct numeric not null default 0,
  overhead_pct numeric not null default 0,
  profit_pct numeric not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.markup_defaults (id) values ('main');

-- ---------- estimates ----------
create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,                         -- the Estimator's own id, so importing twice can't make doubles
  kind text not null default 'custom' check (kind in ('custom', 'house')),
  status text not null default 'draft' check (status in ('draft', 'sent', 'won', 'lost')),
  client_name text not null default '',
  address text not null default '',
  quote_date date not null default current_date,
  notes text not null default '',
  inputs jsonb not null default '{}',
  line_edits jsonb not null default '{}',
  custom_lines jsonb not null default '[]',
  assumptions text not null default '',
  validity_days int not null default 30 check (validity_days between 1 and 365),
  job_id uuid references public.jobs (id) on delete set null,  -- set when a won estimate becomes a job
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.estimates (job_id);

-- Markups and profit for one estimate. Admin only.
create table public.estimate_markups (
  estimate_id uuid primary key references public.estimates (id) on delete cascade,
  sales_tax_pct numeric not null default 0,
  contingency_pct numeric not null default 0,
  overhead_pct numeric not null default 0,
  profit_pct numeric not null default 0,
  profit_amount numeric,                  -- a flat dollar profit, used instead of the percent when set
  updated_at timestamptz not null default now()
);

-- Saved versions freeze the whole quote, markups included. Admin only.
create table public.estimate_versions (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  label text not null default '',
  data jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.estimate_versions (estimate_id);

-- Every new estimate gets its markups row from the defaults, so pricing never finds it missing.
create function private.estimate_markups_from_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.estimate_markups (estimate_id, sales_tax_pct, contingency_pct, overhead_pct, profit_pct)
  select new.id, d.sales_tax_pct, d.contingency_pct, d.overhead_pct, d.profit_pct from public.markup_defaults d
  on conflict (estimate_id) do nothing;
  return new;
end $$;
create trigger estimate_markups_from_defaults after insert on public.estimates
  for each row execute function private.estimate_markups_from_defaults();

create function private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger touch before update on public.estimates for each row execute function private.touch_updated_at();
create trigger touch before update on public.estimate_markups for each row execute function private.touch_updated_at();
create trigger touch before update on public.catalog_items for each row execute function private.touch_updated_at();

-- ---------- expenses: receipts that aren't sub bills ----------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  budget_line_id uuid references public.budget_lines (id) on delete set null,
  expense_date date not null default current_date,
  vendor_name text not null default '',
  description text not null default '',
  category text not null default 'Material'
    check (category in ('Material', 'Labor', 'Subcontractor', 'Equipment rental', 'Permit/fee', 'Other')),
  amount_cents bigint not null check (amount_cents > 0),
  paid boolean not null default true,
  file_path text,                                -- receipt photo or PDF
  legacy_id text unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.expenses (job_id);

create function private.expense_same_job() returns trigger
language plpgsql as $$
begin
  if new.budget_line_id is not null and not exists
     (select 1 from public.budget_lines where id = new.budget_line_id and job_id = new.job_id) then
    raise exception 'That budget line belongs to a different job.';
  end if;
  return new;
end $$;
create trigger expense_same_job before insert or update on public.expenses
  for each row execute function private.expense_same_job();

-- ---------- who sees what ----------
alter table public.catalog_items enable row level security;
alter table public.company_settings enable row level security;
alter table public.markup_defaults enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_markups enable row level security;
alter table public.estimate_versions enable row level security;
alter table public.expenses enable row level security;

create policy staff_all on public.catalog_items for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.expenses for all to authenticated using (private.is_staff()) with check (private.is_staff());

create policy staff_read on public.company_settings for select to authenticated using (private.is_staff());
create policy admin_edit on public.company_settings for update to authenticated using (private.is_admin()) with check (private.is_admin());

create policy staff_read on public.estimates for select to authenticated using (private.is_staff());
create policy staff_add on public.estimates for insert to authenticated with check (private.is_staff());
create policy staff_edit on public.estimates for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy admin_delete on public.estimates for delete to authenticated using (private.is_admin());

create policy admin_all on public.markup_defaults for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all on public.estimate_markups for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all on public.estimate_versions for all to authenticated using (private.is_admin()) with check (private.is_admin());

revoke all on public.catalog_items, public.company_settings, public.markup_defaults, public.estimates,
  public.estimate_markups, public.estimate_versions, public.expenses from anon;
revoke execute on function private.estimate_markups_from_defaults() from public, anon;
revoke execute on function private.touch_updated_at() from public, anon;
revoke execute on function private.expense_same_job() from public, anon;
grant execute on function private.touch_updated_at() to authenticated;
grant execute on function private.expense_same_job() to authenticated;
