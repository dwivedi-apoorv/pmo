-- Weekly client calls: each project can have one or more calls that repeat every week on a weekday and time (India time).
-- Also adds a "Call reminders" notification, switched OFF by default (turn it on under Notifications).
-- Run once in Supabase > SQL Editor.

create table if not exists client_calls (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  weekday      smallint not null check (weekday between 1 and 7),  -- 1 = Monday ... 7 = Sunday
  call_time    time not null,                                       -- India time
  duration_min integer check (duration_min is null or duration_min > 0),
  link         text,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists client_calls_project_idx on client_calls (project_id);
alter table client_calls enable row level security;

-- New notification kind starts switched off.
insert into notification_settings (id, disabled_kinds) values (1, '{call_reminders}')
on conflict (id) do update
  set disabled_kinds = array_append(notification_settings.disabled_kinds, 'call_reminders')
  where not ('call_reminders' = any (notification_settings.disabled_kinds));
