-- Payment tracker: one row per payment that has been marked as paid.
-- A scheduled payment (project + due date) with no row here is unpaid; once its due date has
-- passed it shows as Overdue on the dashboard.
create table if not exists payment_log (
  project_id uuid not null references projects(id) on delete cascade,
  due_date   date not null,
  amount_usd numeric(12, 2),            -- the plan's amount at the time it was marked paid
  paid_at    timestamptz not null default now(),
  primary key (project_id, due_date)
);

create index if not exists payment_log_paid_at_idx on payment_log (paid_at desc);

-- Same rule as the other tables: the public key can only read, writes go through the server.
alter table payment_log enable row level security;
drop policy if exists "public read payment_log" on payment_log;
create policy "public read payment_log" on payment_log for select using (true);
