-- More than one currency. Each project is billed in one currency (USD by default) and each payment in the
-- ledger keeps the currency it was opened in, so changing a project's currency later never rewrites old payments.
-- (The columns payment_amount_usd and amount_usd keep their old names; they hold the amount in the row's currency.)
create table if not exists currencies (
  code       text primary key check (code ~ '^[A-Z]{3}$'),   -- ISO code, e.g. USD, CAD
  created_at timestamptz not null default now()
);
alter table currencies enable row level security;   -- no policies: only the server can use it
insert into currencies (code) values ('USD'), ('CAD') on conflict do nothing;

alter table projects     add column if not exists currency text not null default 'USD' references currencies(code) on update cascade;
alter table payment_dues add column if not exists currency text not null default 'USD' references currencies(code) on update cascade;
