-- Contractors send photos, the office approves or disapproves them.
-- Photos already in the system, and photos the office adds, count as approved.

alter table public.photos
  add column review_status text not null default 'approved' check (review_status in ('pending', 'approved', 'rejected')),
  add column review_note text not null default '',  -- the sub sees this
  add column reviewed_by uuid,
  add column reviewed_at timestamptz;

create function private.photo_review() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if private.my_role() = 'sub' then
      -- Whatever a sub sends, it starts as waiting for review.
      new.review_status := 'pending';
      new.review_note := '';
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.uploaded_by := auth.uid();
      if new.task_id is not null and not exists (
        select 1 from public.tasks t
        where t.id = new.task_id and t.job_id = new.job_id and t.vendor_id = private.my_vendor()
      ) then
        raise exception 'That task is not yours.';
      end if;
    end if;
    return new;
  end if;

  if new.review_status is distinct from old.review_status then
    if new.review_status = 'rejected' and nullif(btrim(new.review_note), '') is null then
      raise exception 'Say why this photo is disapproved, so the contractor knows what to fix.';
    end if;
    if new.review_status = 'approved' then new.review_note := ''; end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end $$;
revoke execute on function private.photo_review() from public, anon;
grant execute on function private.photo_review() to authenticated;

create trigger photo_review before insert or update on public.photos
  for each row execute function private.photo_review();
