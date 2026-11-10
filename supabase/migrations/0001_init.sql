-- Build Tracker: schema, payment gate, sub isolation.
-- Money is stored as integer cents. Dates are plain dates.
-- Roles: admin (everything), staff (everything except user management and payment overrides),
--        sub (own POs, bills, tasks, waivers, photos only), none (no access until invited).

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------- vendors ----------
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade text not null default '',
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  coi_expires date,
  w9_on_file boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- profiles and invites ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  name text not null default '',
  role text not null default 'none' check (role in ('admin', 'staff', 'sub', 'none')),
  vendor_id uuid references public.vendors (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint sub_needs_vendor check (role <> 'sub' or vendor_id is not null)
);

create table public.team_invites (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('admin', 'staff', 'sub')),
  vendor_id uuid references public.vendors (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint invite_sub_needs_vendor check (role <> 'sub' or vendor_id is not null)
);

-- A new login gets the role from its invite. No invite means no access.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv public.team_invites;
begin
  select * into inv from public.team_invites where email = lower(new.email);
  insert into public.profiles (id, email, name, role, vendor_id)
  values (new.id, lower(coalesce(new.email, '')), split_part(coalesce(new.email, ''), '@', 1),
          coalesce(inv.role, 'none'), inv.vendor_id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- An invite added after someone already logged in still takes effect.
create function private.apply_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set role = new.role, vendor_id = new.vendor_id where email = new.email;
  return new;
end $$;
create trigger apply_invite after insert or update on public.team_invites
  for each row execute function private.apply_invite();

create function private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid();
$$;
create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('admin', 'staff') from public.profiles where id = auth.uid()), false);
$$;
create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;
create function private.my_vendor() returns uuid
language sql stable security definer set search_path = '' as $$
  select vendor_id from public.profiles where id = auth.uid() and role = 'sub';
$$;

-- ---------- jobs and budget ----------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  job_type text not null default 'spec' check (job_type in ('spec', 'client')),
  status text not null default 'planning' check (status in ('planning', 'active', 'closed')),
  sale_price_cents bigint not null default 0,  -- client contract price, or expected spec sale price
  loan_amount_cents bigint not null default 0,
  lender text not null default '',
  start_date date,
  target_finish date,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  code text not null default '',
  name text not null,
  budget_cents bigint not null default 0,
  bought_out boolean not null default false,  -- true: all work is under contract, so savings count
  sort int not null default 0
);
create index on public.budget_lines (job_id);

create table public.pos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id),
  budget_line_id uuid not null references public.budget_lines (id),
  number int not null default 0,
  description text not null default '',
  amount_cents bigint not null check (amount_cents >= 0),
  approved_co_cents bigint not null default 0,  -- kept in sync from approved change orders
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'closed')),
  created_at timestamptz not null default now(),
  unique (job_id, number)
);
create index on public.pos (vendor_id);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id),
  po_id uuid references public.pos (id),
  budget_line_id uuid not null references public.budget_lines (id),
  invoice_no text not null default '',
  amount_cents bigint not null check (amount_cents > 0),
  bill_date date not null default current_date,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'paid')),
  notes text not null default '',  -- subs can see this; use it for rejection reasons
  file_path text,
  submitted_by uuid default auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  paid_date date,
  paid_by uuid,
  override_reason text,
  override_by uuid,
  created_at timestamptz not null default now()
);
create index on public.bills (job_id);
create index on public.bills (vendor_id);

create table public.change_orders (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  budget_line_id uuid not null references public.budget_lines (id),
  po_id uuid references public.pos (id) on delete set null,
  number int not null default 0,
  description text not null default '',
  cost_delta_cents bigint not null default 0,
  price_delta_cents bigint not null default 0,  -- what the client pays extra; 0 on spec jobs
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, number)
);
create index on public.change_orders (job_id);

create table public.draws (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  number int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'requested', 'funded')),
  requested_date date,
  funded_date date,
  funded_cents bigint not null default 0,  -- the lender may fund less than requested
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (job_id, number)
);

create table public.draw_lines (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references public.draws (id) on delete cascade,
  budget_line_id uuid not null references public.budget_lines (id),
  amount_cents bigint not null default 0,
  unique (draw_id, budget_line_id)
);

create table public.lien_waivers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id),
  bill_id uuid references public.bills (id) on delete cascade,
  kind text not null default 'conditional_progress'
    check (kind in ('conditional_progress', 'unconditional_progress', 'conditional_final', 'unconditional_final')),
  amount_cents bigint not null default 0,
  through_date date,
  status text not null default 'requested' check (status in ('requested', 'received')),
  file_path text,
  received_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.lien_waivers (job_id);
create index on public.lien_waivers (vendor_id);
create index on public.lien_waivers (bill_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  vendor_id uuid references public.vendors (id) on delete set null,
  name text not null,
  start_date date not null,
  end_date date not null,
  depends_on uuid references public.tasks (id) on delete set null,  -- finish-to-start
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  notes text not null default '',  -- subs can see notes on their own tasks
  sort int not null default 0,
  completed_at timestamptz,
  constraint task_dates check (end_date >= start_date)
);
create index on public.tasks (job_id);
create index on public.tasks (vendor_id);

create table public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  log_date date not null default current_date,
  weather text not null default '',
  notes text not null default '',
  author text not null default '',
  created_at timestamptz not null default now()
);
create index on public.daily_logs (job_id);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  vendor_id uuid references public.vendors (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  file_path text not null,
  caption text not null default '',
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.photos (job_id);

-- ---------- per-job numbering ----------
create function private.next_number() returns trigger
language plpgsql as $$
declare n int;
begin
  execute format('select coalesce(max(number), 0) + 1 from public.%I where job_id = $1', tg_table_name)
    into n using new.job_id;
  new.number := n;
  return new;
end $$;
create trigger number_po before insert on public.pos for each row execute function private.next_number();
create trigger number_co before insert on public.change_orders for each row execute function private.next_number();
create trigger number_draw before insert on public.draws for each row execute function private.next_number();

-- ---------- keep records on the same job ----------
create function private.check_same_job() returns trigger
language plpgsql as $$
declare ok boolean;
begin
  select exists (select 1 from public.budget_lines where id = new.budget_line_id and job_id = new.job_id) into ok;
  if not ok then raise exception 'That budget line belongs to a different job.'; end if;
  return new;
end $$;
create trigger same_job_po before insert or update on public.pos
  for each row execute function private.check_same_job();
create trigger same_job_co before insert or update on public.change_orders
  for each row execute function private.check_same_job();

-- ---------- bills: sub guard, payment gate, automatic waiver requests ----------
create function private.bill_before_insert() returns trigger
language plpgsql as $$
declare p public.pos; r text := private.my_role();
begin
  if r = 'sub' then
    if new.po_id is null then raise exception 'Choose the work order this bill is for.'; end if;
    select * into p from public.pos where id = new.po_id;  -- RLS limits this to the sub's own POs
    if p.id is null or p.vendor_id <> private.my_vendor() then
      raise exception 'That work order is not yours.';
    end if;
    if p.status <> 'accepted' then raise exception 'Accept the work order before billing it.'; end if;
    new.vendor_id := p.vendor_id;
    new.job_id := p.job_id;
    new.budget_line_id := p.budget_line_id;
    new.status := 'submitted';
    new.approved_by := null; new.approved_at := null;
    new.paid_date := null; new.paid_by := null;
    new.override_reason := null; new.override_by := null;
    new.submitted_by := auth.uid();
    return new;
  end if;
  if new.status not in ('submitted', 'approved') then
    raise exception 'New bills start as submitted or approved.';
  end if;
  if new.po_id is not null then
    select * into p from public.pos where id = new.po_id;
    if p.job_id <> new.job_id or p.vendor_id <> new.vendor_id then
      raise exception 'That PO is for a different job or vendor.';
    end if;
    new.budget_line_id := p.budget_line_id;
  end if;
  if not exists (select 1 from public.budget_lines where id = new.budget_line_id and job_id = new.job_id) then
    raise exception 'That budget line belongs to a different job.';
  end if;
  return new;
end $$;
create trigger bill_before_insert before insert on public.bills
  for each row execute function private.bill_before_insert();

create function private.bill_before_update() returns trigger
language plpgsql as $$
declare
  coi date;
  has_waiver boolean;
  blockers text[] := '{}';
  reason text := nullif(btrim(coalesce(new.override_reason, '')), '');
begin
  if (new.amount_cents, new.vendor_id, new.job_id, new.po_id, new.budget_line_id)
     is distinct from (old.amount_cents, old.vendor_id, old.job_id, old.po_id, old.budget_line_id)
     and old.status <> 'submitted' then
    raise exception 'This bill is already %. Reject it and enter a new one to change the amount or vendor.', old.status;
  end if;

  if new.status = old.status then
    if old.status = 'paid'
       and (new.paid_date, new.override_reason, new.override_by, new.paid_by)
           is distinct from (old.paid_date, old.override_reason, old.override_by, old.paid_by) then
      raise exception 'Payment details cannot be edited on a paid bill.';
    end if;
    return new;
  end if;

  if old.status = 'submitted' and new.status in ('approved', 'rejected')
     or old.status = 'approved' and new.status in ('paid', 'rejected', 'submitted')
     or old.status = 'rejected' and new.status = 'submitted' then
    null;
  elsif old.status = 'paid' and new.status = 'approved' then
    if not private.is_admin() then raise exception 'Only an admin can undo a payment.'; end if;
  else
    raise exception 'A bill cannot go from % to %.', old.status, new.status;
  end if;

  if new.status = 'approved' then
    new.approved_by := auth.uid();
    new.approved_at := now();
    new.paid_date := null; new.paid_by := null; new.override_reason := null; new.override_by := null;
  end if;

  if new.status = 'paid' then
    new.paid_date := coalesce(new.paid_date, current_date);
    new.paid_by := auth.uid();
    select coi_expires into coi from public.vendors where id = new.vendor_id;
    if coi is null then
      blockers := blockers || 'no insurance certificate on file'::text;
    elsif coi < new.paid_date then
      blockers := blockers || format('insurance expired %s', coi);
    end if;
    select exists (select 1 from public.lien_waivers where bill_id = new.id and status = 'received') into has_waiver;
    if not has_waiver then
      blockers := blockers || 'no lien waiver received'::text;
    end if;
    if array_length(blockers, 1) > 0 then
      if reason is null or not private.is_admin() then
        raise exception 'Cannot pay this bill: %. An admin can override with a reason.', array_to_string(blockers, ', ');
      end if;
      new.override_reason := reason;
      new.override_by := auth.uid();
    else
      new.override_reason := null;
      new.override_by := null;
    end if;
  end if;
  return new;
end $$;
create trigger bill_before_update before update on public.bills
  for each row execute function private.bill_before_update();

create function private.bill_after_change() returns trigger
language plpgsql as $$
declare w public.lien_waivers; next_kind text;
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    if not exists (select 1 from public.lien_waivers where bill_id = new.id) then
      insert into public.lien_waivers (job_id, vendor_id, bill_id, kind, amount_cents, through_date)
      values (new.job_id, new.vendor_id, new.id, 'conditional_progress', new.amount_cents, new.bill_date);
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'paid' and old.status <> 'paid' then
    select * into w from public.lien_waivers
      where bill_id = new.id and kind like 'conditional%' order by created_at limit 1;
    next_kind := case when w.kind = 'conditional_final' then 'unconditional_final' else 'unconditional_progress' end;
    if not exists (select 1 from public.lien_waivers where bill_id = new.id and kind like 'unconditional%') then
      insert into public.lien_waivers (job_id, vendor_id, bill_id, kind, amount_cents, through_date)
      values (new.job_id, new.vendor_id, new.id, next_kind, new.amount_cents, new.paid_date);
    end if;
  end if;
  return null;
end $$;
create trigger bill_after_change after insert or update on public.bills
  for each row execute function private.bill_after_change();

create function private.protect_paid_bill() returns trigger
language plpgsql as $$
begin
  if old.status = 'paid' and not private.is_admin() then
    raise exception 'Only an admin can delete a paid bill.';
  end if;
  return old;
end $$;
create trigger protect_paid_bill before delete on public.bills
  for each row execute function private.protect_paid_bill();

-- ---------- change orders flow into the PO they apply to ----------
create function private.sync_po_change_orders() returns trigger
language plpgsql as $$
declare ids uuid[];
begin
  if tg_op = 'DELETE' then ids := array[old.po_id];
  elsif tg_op = 'INSERT' then ids := array[new.po_id];
  else ids := array[old.po_id, new.po_id];
  end if;
  update public.pos p set approved_co_cents = coalesce((
    select sum(c.cost_delta_cents) from public.change_orders c
    where c.po_id = p.id and c.status = 'approved'), 0)
  where p.id = any (ids);
  return null;
end $$;
create trigger sync_po_cos after insert or update or delete on public.change_orders
  for each row execute function private.sync_po_change_orders();

create function private.co_stamp() returns trigger
language plpgsql as $$
begin
  if new.po_id is not null and not exists
     (select 1 from public.pos where id = new.po_id and job_id = new.job_id and budget_line_id = new.budget_line_id) then
    raise exception 'That PO is on a different job or budget line.';
  end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    new.approved_at := now();
  end if;
  return new;
end $$;
create trigger co_stamp before insert or update on public.change_orders
  for each row execute function private.co_stamp();

-- ---------- what a sub can do (only through these functions) ----------
create function public.my_jobs() returns table (id uuid, name text, address text)
language sql stable security definer set search_path = '' as $$
  select j.id, j.name, j.address from public.jobs j
  where exists (select 1 from public.pos p where p.job_id = j.id
                  and p.vendor_id = private.my_vendor() and p.status <> 'draft')
     or exists (select 1 from public.tasks t where t.job_id = j.id
                  and t.vendor_id = private.my_vendor());
$$;

create function public.respond_po(p_po uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.pos set status = case when p_accept then 'accepted' else 'declined' end
  where id = p_po and vendor_id = private.my_vendor() and status = 'sent';
  if not found then raise exception 'This work order is not waiting on your answer.'; end if;
end $$;

create function public.submit_waiver(p_waiver uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid := private.my_vendor();
begin
  if v is null or p_path is null or p_path not like 'vendor/' || v::text || '/%' then
    raise exception 'Upload the signed waiver first.';
  end if;
  update public.lien_waivers set status = 'received', file_path = p_path, received_at = now()
  where id = p_waiver and vendor_id = v and status = 'requested';
  if not found then raise exception 'This waiver is not waiting on you.'; end if;
end $$;

create function public.set_task_status(p_task uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('todo', 'in_progress', 'done') then raise exception 'Unknown status.'; end if;
  update public.tasks set status = p_status,
         completed_at = case when p_status = 'done' then now() else null end
  where id = p_task and vendor_id = private.my_vendor();
  if not found then raise exception 'This task is not assigned to you.'; end if;
end $$;

-- ---------- row-level security ----------
alter table public.vendors enable row level security;
alter table public.profiles enable row level security;
alter table public.team_invites enable row level security;
alter table public.jobs enable row level security;
alter table public.budget_lines enable row level security;
alter table public.pos enable row level security;
alter table public.bills enable row level security;
alter table public.change_orders enable row level security;
alter table public.draws enable row level security;
alter table public.draw_lines enable row level security;
alter table public.lien_waivers enable row level security;
alter table public.tasks enable row level security;
alter table public.daily_logs enable row level security;
alter table public.photos enable row level security;

-- Staff work on everything.
create policy staff_all on public.vendors for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.budget_lines for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.pos for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.bills for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.change_orders for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.draws for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.draw_lines for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.lien_waivers for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.tasks for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.daily_logs for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy staff_all on public.photos for all to authenticated using (private.is_staff()) with check (private.is_staff());

-- Jobs hold sale price and loan details, so subs never read this table. They use my_jobs().
create policy staff_read on public.jobs for select to authenticated using (private.is_staff());
create policy staff_add on public.jobs for insert to authenticated with check (private.is_staff());
create policy staff_edit on public.jobs for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy admin_delete on public.jobs for delete to authenticated using (private.is_admin());

-- User management is admin-only.
create policy read_self_or_staff on public.profiles for select to authenticated using (id = auth.uid() or private.is_staff());
create policy admin_edit on public.profiles for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all on public.team_invites for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- Subs read only their own records.
create policy sub_read on public.vendors for select to authenticated using (id = private.my_vendor());
create policy sub_read on public.pos for select to authenticated using (vendor_id = private.my_vendor() and status <> 'draft');
create policy sub_read on public.bills for select to authenticated using (vendor_id = private.my_vendor());
create policy sub_add on public.bills for insert to authenticated with check (vendor_id = private.my_vendor() and status = 'submitted');
create policy sub_read on public.lien_waivers for select to authenticated using (vendor_id = private.my_vendor());
create policy sub_read on public.tasks for select to authenticated using (vendor_id = private.my_vendor());
create policy sub_read on public.photos for select to authenticated using (vendor_id = private.my_vendor());
create policy sub_add on public.photos for insert to authenticated with check (
  vendor_id = private.my_vendor()
  and file_path like 'vendor/' || private.my_vendor()::text || '/%'
  and job_id in (select id from public.my_jobs())
);

-- ---------- function access ----------
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function public.my_jobs() from public, anon;
revoke execute on function public.respond_po(uuid, boolean) from public, anon;
revoke execute on function public.submit_waiver(uuid, text) from public, anon;
revoke execute on function public.set_task_status(uuid, text) from public, anon;
grant execute on function public.my_jobs() to authenticated;
grant execute on function public.respond_po(uuid, boolean) to authenticated;
grant execute on function public.submit_waiver(uuid, text) to authenticated;
grant execute on function public.set_task_status(uuid, text) to authenticated;

-- ---------- file storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-files', 'job-files', false, 26214400,
        array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']);

create policy staff_files on storage.objects for all to authenticated
  using (bucket_id = 'job-files' and private.is_staff())
  with check (bucket_id = 'job-files' and private.is_staff());
create policy sub_read_files on storage.objects for select to authenticated
  using (bucket_id = 'job-files' and (storage.foldername(name))[1] = 'vendor'
         and (storage.foldername(name))[2] = private.my_vendor()::text);
create policy sub_add_files on storage.objects for insert to authenticated
  with check (bucket_id = 'job-files' and (storage.foldername(name))[1] = 'vendor'
              and (storage.foldername(name))[2] = private.my_vendor()::text);
