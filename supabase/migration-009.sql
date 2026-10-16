-- Payment ledger: one row per payment that is owed. A monthly job (and the dashboard's "Generate
-- dues" button) creates a 'due' row for every payment that falls in the month; "Mark as paid" turns it
-- into 'paid'. Rows are never deleted when a project is halted or ended, so unpaid money stays owed.
--
-- Replaces payment_log (which only recorded paid payments). The old table is left in place, unused.

create table if not exists payment_dues (
  project_id uuid not null references projects(id) on delete cascade,
  due_date   date not null,
  amount_usd numeric(12, 2) not null default 0 check (amount_usd >= 0),
  term       text check (term in ('one_off', 'monthly', 'quarterly', 'biannual')),   -- plan when the due was created
  method     text check (method in ('subscription', 'stripe_link', 'bank_wire')),    -- plan when the due was created
  status     text not null default 'due' check (status in ('due', 'paid')),
  paid_at    timestamptz,
  source     text not null default 'cron' check (source in ('cron', 'manual', 'migrated')),
  created_at timestamptz not null default now(),
  primary key (project_id, due_date),
  check ((status = 'paid') = (paid_at is not null))
);

create index if not exists payment_dues_status_idx on payment_dues (status, due_date);

-- Same rule as the other tables: the public key can only read, writes go through the server.
alter table payment_dues enable row level security;
drop policy if exists "public read payment_dues" on payment_dues;
create policy "public read payment_dues" on payment_dues for select using (true);

-- Carry over everything already marked as paid.
do $$
begin
  if to_regclass('public.payment_log') is not null then
    insert into payment_dues (project_id, due_date, amount_usd, term, method, status, paid_at, source)
    select l.project_id, l.due_date,
           coalesce(l.amount_usd, p.payment_amount_usd, 0),
           p.payment_term, p.payment_method, 'paid', l.paid_at, 'migrated'
    from payment_log l
    join projects p on p.id = l.project_id
    on conflict (project_id, due_date) do nothing;
  end if;
end $$;
