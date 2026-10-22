-- Error alerts: emails to admins when the morning job or a Teams message fails are logged like other messages.
alter table notification_log drop constraint if exists notification_log_kind_check;
alter table notification_log add constraint notification_log_kind_check
  check (kind in ('digest', 'assigned', 'test', 'status', 'payment', 'nudge', 'alert'));
