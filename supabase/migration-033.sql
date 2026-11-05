-- Send a Stripe invoice from the app (the "Send invoice" button on a Stripe-link payment).
--  * projects.billing_email: where the client's invoice is emailed
--  * projects.stripe_customer_id: the client's customer in Stripe, created the first time an invoice is sent
--  * payment_dues.stripe_invoice_id / invoice_url / invoiced_at: the invoice that was sent for this payment,
--    so one payment is never invoiced twice
-- Run once in Supabase > SQL Editor.

alter table projects     add column if not exists billing_email      text;
alter table projects     add column if not exists stripe_customer_id text;
alter table payment_dues add column if not exists stripe_invoice_id  text;
alter table payment_dues add column if not exists invoice_url        text;
alter table payment_dues add column if not exists invoiced_at        timestamptz;
