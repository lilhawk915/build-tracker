-- Partial payments on invoices, one row per payment. Only the owner can add, change or delete a
-- payment, or change an invoice's notes. Other admins can see them.

-- ---------- the owner ----------
-- One person: the business owner. Starts as the first admin who signed up.
alter table public.profiles add column is_owner boolean not null default false;
create unique index profiles_one_owner on public.profiles (is_owner) where is_owner;
update public.profiles set is_owner = true
  where id = (select id from public.profiles where role = 'admin' order by created_at, id limit 1);

-- A new setup has no owner yet: the first admin becomes it.
create function private.first_admin_owns() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'admin' and not new.is_owner and not exists (select 1 from public.profiles where is_owner) then
    new.is_owner := true;
  end if;
  return new;
end $$;
create trigger first_admin_owns before insert or update of role on public.profiles
  for each row execute function private.first_admin_owns();

create function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_owner and role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- Admins can edit profiles, but only the owner (or the database itself) can move the owner flag.
create function private.guard_owner_flag() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.is_owner is distinct from old.is_owner and auth.uid() is not null and not private.is_owner() then
    raise exception 'Only the owner can change who the owner is.';
  end if;
  return new;
end $$;
create trigger guard_owner_flag before update on public.profiles
  for each row execute function private.guard_owner_flag();

-- ---------- payments ----------
create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  paid_on date not null default current_date,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);
create index on public.invoice_payments (invoice_id);

alter table public.invoice_payments enable row level security;
create policy admin_read on public.invoice_payments for select to authenticated using (private.is_admin());
create policy owner_insert on public.invoice_payments for insert to authenticated with check (private.is_owner());
create policy owner_update on public.invoice_payments for update to authenticated using (private.is_owner()) with check (private.is_owner());
create policy owner_delete on public.invoice_payments for delete to authenticated using (private.is_owner());
revoke all on public.invoice_payments from anon;

-- Deleting an invoice deletes its payments too, so only the owner can delete an invoice that has any.
create function private.guard_payment_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and not private.is_owner() then
    raise exception 'Only the owner can delete payments. This invoice has payments on it.';
  end if;
  return old;
end $$;
create trigger guard_payment_delete before delete on public.invoice_payments
  for each row execute function private.guard_payment_delete();

-- The invoice's "paid so far" and "last payment date" always add up from its payments.
create function private.sync_invoice_paid() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  perform set_config('app.syncing_paid', 'on', true);
  update public.invoices i set
    paid_cents = coalesce((select sum(amount_cents) from public.invoice_payments where invoice_id = inv), 0),
    paid_date = (select max(paid_on) from public.invoice_payments where invoice_id = inv)
  where i.id = inv;
  if tg_op = 'UPDATE' and old.invoice_id <> new.invoice_id then
    update public.invoices i set
      paid_cents = coalesce((select sum(amount_cents) from public.invoice_payments where invoice_id = old.invoice_id), 0),
      paid_date = (select max(paid_on) from public.invoice_payments where invoice_id = old.invoice_id)
    where i.id = old.invoice_id;
  end if;
  perform set_config('app.syncing_paid', 'off', true);
  return null;
end $$;
create trigger sync_invoice_paid after insert or update or delete on public.invoice_payments
  for each row execute function private.sync_invoice_paid();

-- Nobody types "paid so far" by hand any more, and only the owner writes invoice notes.
create function private.guard_invoice_money() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.paid_cents := 0; new.paid_date := null;
    if not private.is_owner() then new.notes := ''; end if;
    return new;
  end if;
  if current_setting('app.syncing_paid', true) is distinct from 'on'
     and (new.paid_cents is distinct from old.paid_cents or new.paid_date is distinct from old.paid_date) then
    raise exception 'Payments are added one at a time in the Payments section.';
  end if;
  if new.notes is distinct from old.notes and not private.is_owner() then
    raise exception 'Only the owner can change invoice notes.';
  end if;
  return new;
end $$;
create trigger guard_invoice_money before insert or update on public.invoices
  for each row execute function private.guard_invoice_money();

-- What was already marked paid becomes one payment, on the date it was marked.
insert into public.invoice_payments (invoice_id, paid_on, amount_cents, note)
  select id, coalesce(paid_date, invoice_date), paid_cents, 'Paid before payments were listed one by one'
  from public.invoices where paid_cents > 0;
