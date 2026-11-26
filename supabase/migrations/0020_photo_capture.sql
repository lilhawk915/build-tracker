-- Job-site camera: when and where a photo was taken, and whether the client may see it.
-- Stage = the schedule step the photo is tied to (photos.task_id), so there is no separate tag list.

alter table public.photos
  add column taken_at timestamptz,
  add column lat double precision,
  add column lng double precision,
  add column client_visible boolean not null default false;

create index on public.photos (job_id, taken_at);

-- Only the office decides what the client sees. A sub's photo always starts hidden,
-- and a photo that is not approved is never shown.
create function private.photo_client_visible() returns trigger
language plpgsql as $$
begin
  if private.my_role() = 'sub' then
    if tg_op = 'INSERT' then
      new.client_visible := false;
    elsif new.client_visible is distinct from old.client_visible then
      raise exception 'Only the office can share a photo with the client.';
    end if;
  end if;
  if new.review_status <> 'approved' then new.client_visible := false; end if;
  return new;
end $$;
revoke execute on function private.photo_client_visible() from public, anon;
grant execute on function private.photo_client_visible() to authenticated;

-- runs after photo_review (trigger names fire alphabetically), so review_status is final
create trigger photo_zz_client_visible before insert or update on public.photos
  for each row execute function private.photo_client_visible();
