-- Activity log: who changed what and when. Each row stores a ready-made sentence ("Anurag marked the payment
-- for Acme as paid") plus the names at the time, so it still reads correctly if someone or something is renamed
-- or deleted later. Locked down: row-level security on, no policies, so only the server can use it.
create table if not exists activity_log (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  actor_id     uuid references employees(id) on delete set null,
  actor_name   text not null,
  grp          text not null check (grp in ('project', 'payment', 'report', 'note', 'people', 'access', 'settings')),
  action       text not null,                       -- e.g. project_created, payment_paid
  summary      text not null,
  project_id   uuid references projects(id) on delete set null,
  project_name text,
  details      jsonb
);
create index if not exists activity_log_time_idx    on activity_log (created_at desc);
create index if not exists activity_log_project_idx on activity_log (project_id, created_at desc);
alter table activity_log enable row level security;
