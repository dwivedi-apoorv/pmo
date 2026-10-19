-- Lets the admin switch individual kinds of Teams message on or off (Settings > What gets sent).
-- Holds the kinds that are switched OFF: any of 'reports', 'payments', 'assigned'. Empty = everything on.
alter table notification_settings add column if not exists disabled_kinds text[] not null default '{}';
