-- Partner deals: the percent of a job's profit that's ours (Lewis Lane 1 is 50%). Null means all of it.
alter table public.jobs add column if not exists profit_share_pct numeric(5,2)
  check (profit_share_pct is null or profit_share_pct between 0 and 100);
