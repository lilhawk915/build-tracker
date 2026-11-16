-- A plain-words type for each estimate, such as "Custom home", "Insulation" or "Mold remediation".
alter table public.estimates add column work_type text not null default '';
