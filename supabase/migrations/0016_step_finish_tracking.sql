-- Sub scorecard: record when each step really finished, and the finish date the sub was held to.
-- promised_end is the end date as it stood when the step started, so delays before the sub showed up aren't on them.
alter table public.tasks add column if not exists promised_end date;

create or replace function private.task_track_finish() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status <> 'done' then new.completed_at := coalesce(new.completed_at, now());
    else new.completed_at := coalesce(old.completed_at, new.completed_at); end if;
  else
    new.completed_at := null;
  end if;
  if new.status = 'todo' then
    new.promised_end := null;
  elsif new.promised_end is null then
    new.promised_end := case when tg_op = 'UPDATE' then old.end_date else new.end_date end;
  end if;
  return new;
end $$;

create trigger task_track_finish before insert or update on public.tasks
  for each row execute function private.task_track_finish();

-- Steps already going are held to the end date they have today. Finished steps keep no date: their real finish is unknown.
update public.tasks set promised_end = end_date where status = 'in_progress' and promised_end is null;
