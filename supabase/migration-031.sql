-- Lets an admin remove a payment that shouldn't exist (a duplicate, or a month a client paused).
-- The row is kept with status 'void' instead of being deleted, so the monthly job doesn't open that
-- payment again, and it can be restored. Run once in Supabase > SQL Editor.

alter table payment_dues drop constraint if exists payment_dues_status_check;
alter table payment_dues add constraint payment_dues_status_check check (status in ('due', 'paid', 'void'));
