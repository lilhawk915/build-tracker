-- A job type for buildings we keep (the triplexes): no sale and no profit, refinanced to pull our money back out.
alter table public.jobs drop constraint jobs_job_type_check;
alter table public.jobs add constraint jobs_job_type_check
  check (job_type in ('spec', 'client', 'rental', 'flip', 'remodel', 'addition', 'repair', 'other'));
