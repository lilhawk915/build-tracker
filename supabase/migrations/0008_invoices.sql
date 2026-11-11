-- Customer invoices. A quote (estimate) is accepted, becomes a job, then gets invoiced.
-- Invoices show client prices, so like markups and profit they are for admins only.

create sequence public.invoice_number_seq start 1001;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number int not null unique default nextval('public.invoice_number_seq'),
  job_id uuid references public.jobs (id) on delete set null,
  estimate_id uuid references public.estimates (id) on delete set null,
  bill_to text not null default '',
  address text not null default '',
  invoice_date date not null default current_date,
  due_date date,
  terms text not null default 'Due on receipt',
  -- Each line: { "description": text, "detail": text, "amount_cents": int }
  lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array'),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  paid_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter sequence public.invoice_number_seq owned by public.invoices.number;
create index on public.invoices (job_id);
create index on public.invoices (estimate_id);

create trigger invoices_touch before update on public.invoices
  for each row execute function private.touch_updated_at();

alter table public.invoices enable row level security;
create policy admin_all on public.invoices for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
revoke all on public.invoices from anon;
revoke all on sequence public.invoice_number_seq from anon;
grant usage on sequence public.invoice_number_seq to authenticated;
