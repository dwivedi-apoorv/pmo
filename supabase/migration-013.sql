-- Report tracking: one row per report that has been marked as SENT. A scheduled report (project + due
-- date) with no row here has not been sent; once its day has passed it counts as overdue, which is one
-- of the two things that flag a project "At risk" (the other is an overdue payment).
create table if not exists report_log (
  project_id uuid not null references projects(id) on delete cascade,
  due_date   date not null,
  sent_at    timestamptz not null default now(),
  primary key (project_id, due_date)
);

create index if not exists report_log_sent_at_idx on report_log (sent_at desc);

-- Same rule as the other tables: the public key can only read, writes go through the server.
alter table report_log enable row level security;
drop policy if exists "public read report_log" on report_log;
create policy "public read report_log" on report_log for select using (true);
