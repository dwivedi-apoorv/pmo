-- Split payments: a due payment can be split into 2-3 installments, each with its own invoice date.
-- split_from holds the date of the payment that was split (the same value on every installment of one split),
-- so the installments can be labelled "1 of 2" and a split can be undone. Run once in Supabase > SQL Editor.

alter table payment_dues add column if not exists split_from date;
