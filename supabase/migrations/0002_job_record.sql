-- Permanent job record: job facts, colors and selections, drawings and files, and who did each step.
-- All of it is staff-only. Subs have no policy on these tables, and jobs was already closed to them.

-- Not every job is a new house.
alter table public.jobs drop constraint jobs_job_type_check;
alter table public.jobs add constraint jobs_job_type_check
  check (job_type in ('spec', 'client', 'flip', 'remodel', 'addition', 'repair', 'other'));

alter table public.jobs
  add column type_note text not null default '',  -- what kind of job, when the list doesn't fit
  add column client_name text not null default '',
  add column client_phone text not null default '',
  add column client_email text not null default '',
  add column plan_name text not null default '',
  add column square_feet int,
  add column bedrooms numeric(3, 1),
  add column bathrooms numeric(3, 1),
  add column stories numeric(3, 1),
  add column permit_number text not null default '',
  add column finish_date date;

create table public.selections (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  category text not null default 'Other',
  room text not null default '',
  item text not null default '',
  brand text not null default '',
  color_name text not null default '',
  color_code text not null default '',
  finish text not null default '',
  supplier text not null default '',
  vendor_id uuid references public.vendors (id) on delete set null,  -- who installed it
  notes text not null default '',
  file_path text,
  created_at timestamptz not null default now()
);
create index on public.selections (job_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  category text not null default 'Other',
  title text not null,
  file_path text not null,
  file_name text not null default '',
  revision text not null default '',
  doc_date date,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index on public.documents (job_id);

-- Hand-entered history, mainly for jobs finished before this app. Live jobs get theirs from POs, bills, and tasks.
create table public.job_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  step text not null,
  vendor_id uuid references public.vendors (id) on delete set null,
  other_name text not null default '',  -- for someone not in the sub list
  start_date date,
  end_date date,
  cost_cents bigint,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index on public.job_steps (job_id);

alter table public.selections enable row level security;
alter table public.documents enable row level security;
alter table public.job_steps enable row level security;

create policy staff_all on public.selections for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.documents for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.job_steps for all to authenticated using (private.is_staff()) with check (private.is_staff());

revoke all on public.selections, public.documents, public.job_steps from anon;

-- Drawings can be large and come from CAD or office programs.
-- DWG files often arrive with no type, which browsers send as octet-stream.
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/heic', 'image/webp', 'image/tiff', 'image/svg+xml',
      'application/pdf', 'application/acad', 'image/vnd.dwg', 'image/vnd.dxf', 'application/dxf',
      'application/octet-stream', 'application/zip', 'text/csv', 'text/plain',
      'application/msword', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
where id = 'job-files';
