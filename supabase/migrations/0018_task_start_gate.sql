-- A step can't be started or finished while its walk-through checklist has unticked items or an
-- inspection tied to it hasn't passed (or been marked not needed). Enforced here so it holds for
-- everyone: office staff, subs in their portal and crew. Same wording as the app.
-- Security definer because subs and crew can't read checklists or inspections themselves.
create or replace function private.task_start_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n_total int;
  n_done int;
  blocking text;
  n_blocking int;
begin
  if old.status <> 'todo' or new.status = 'todo' then return new; end if;

  select count(*), count(*) filter (where done) into n_total, n_done
  from public.step_checks where task_id = new.id;
  if n_total > n_done then
    raise exception 'Finish the walk-through checklist for % first: % of % done.', new.name, n_done, n_total
      using errcode = 'P0001';
  end if;

  select string_agg(name || case when result = 'failed' then ' (failed)' else '' end, ', ' order by sort), count(*)
    into blocking, n_blocking
  from public.inspections where task_id = new.id and result not in ('passed', 'not_needed');
  if n_blocking > 0 then
    raise exception '% can''t start until % pass%: %.', new.name,
      case when n_blocking = 1 then 'this inspection' else 'these inspections' end,
      case when n_blocking = 1 then 'es' else '' end, blocking
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger task_start_gate before update on public.tasks
  for each row execute function private.task_start_gate();
