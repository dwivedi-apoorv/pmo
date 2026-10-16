-- Payment plan per project: first payment date, term, method and USD amount.
-- Columns are nullable so existing projects keep working; fill them in via Edit project.
alter table projects
  add column if not exists payment_date       date,
  add column if not exists payment_term       text
    check (payment_term in ('one_off', 'monthly', 'quarterly', 'biannual')),
  add column if not exists payment_method     text
    check (payment_method in ('subscription', 'stripe_link', 'bank_wire')),
  add column if not exists payment_amount_usd numeric(12, 2)
    check (payment_amount_usd >= 0);
