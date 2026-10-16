-- Backfill: lets the app record payments from before it was used (for example a project that began in
-- 2024) as already collected. Those rows are tagged source = 'backfill' so they are easy to tell apart.
alter table payment_dues drop constraint if exists payment_dues_source_check;
alter table payment_dues
  add constraint payment_dues_source_check check (source in ('cron', 'manual', 'migrated', 'backfill'));

