-- Reasons for stopping a project, picked from a list (and added to it when new) instead of typed each time.
-- One list per outcome, so "why projects are lost" can be counted. The reason itself is still written to
-- project_status_log.reason as text, so history never changes if a list entry is later removed.
create table if not exists status_reasons (
  id         uuid primary key default gen_random_uuid(),
  status     text not null check (status in ('halted', 'ended', 'completed')),   -- ended = lost
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index if not exists status_reasons_name_key on status_reasons (status, lower(btrim(name)));
alter table status_reasons enable row level security;   -- no policies: only the server can use it

insert into status_reasons (status, name) values
  ('ended', 'Budget constraints'),
  ('ended', 'Moved to another agency'),
  ('ended', 'Not satisfied with results'),
  ('ended', 'Brought work in-house'),
  ('ended', 'Business closed'),
  ('ended', 'Payment issues'),
  ('ended', 'Poor communication'),
  ('halted', 'Awaiting client approval'),
  ('halted', 'Budget on hold'),
  ('halted', 'Client unresponsive'),
  ('halted', 'Payment pending'),
  ('halted', 'Seasonal pause'),
  ('completed', 'Project delivered'),
  ('completed', 'Contract term finished')
on conflict do nothing;

-- Keep the short reasons already typed in the past (long sentences are left out of the list).
insert into status_reasons (status, name)
select distinct on (status, lower(regexp_replace(btrim(reason), '\s+', ' ', 'g'))) status, regexp_replace(btrim(reason), '\s+', ' ', 'g')
from project_status_log
where status in ('halted', 'ended', 'completed') and reason is not null and char_length(btrim(reason)) between 1 and 60
on conflict do nothing;
