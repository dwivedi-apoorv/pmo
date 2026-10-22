-- More kinds of Teams message: project halted/completed/lost, payment received, overdue-report reminder.
alter table notification_log drop constraint if exists notification_log_kind_check;
alter table notification_log add constraint notification_log_kind_check
  check (kind in ('digest', 'assigned', 'test', 'status', 'payment', 'nudge'));
