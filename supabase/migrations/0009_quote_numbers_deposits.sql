-- Quote numbers, deposit terms on quotes, and deposit / final invoices.
-- Flow: quote (with its number and payment terms) -> signed -> deposit invoice -> work and
-- change orders -> final invoice (quote + change orders - deposit received).

-- Every quote gets a number the invoices can point to. Existing quotes are numbered oldest first.
create sequence public.quote_number_seq;
alter table public.estimates add column number int unique;
update public.estimates e set number = s.n
  from (select id, 1000 + row_number() over (order by created_at, id) as n from public.estimates) s
  where s.id = e.id;
select setval('public.quote_number_seq', coalesce((select max(number) from public.estimates), 1000) + 1, false);
alter table public.estimates alter column number set default nextval('public.quote_number_seq');
alter table public.estimates alter column number set not null;
alter sequence public.quote_number_seq owned by public.estimates.number;
revoke all on sequence public.quote_number_seq from anon;
grant usage on sequence public.quote_number_seq to authenticated;

-- Percent of the quote due up front, before material is ordered or the job is scheduled. 0 = none.
alter table public.estimates add column deposit_pct numeric not null default 0
  check (deposit_pct >= 0 and deposit_pct <= 100);

-- deposit: the up-front part of a quote. final: the quote, plus change orders, less deposits.
-- standard: anything else (extra change orders, one-off bills).
alter table public.invoices add column kind text not null default 'standard'
  check (kind in ('standard', 'deposit', 'final'));
update public.invoices set kind = 'final' where estimate_id is not null;
