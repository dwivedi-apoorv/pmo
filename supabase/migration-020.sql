-- Microsoft Teams notifications.
--  * notification_settings : how messages are delivered (one row)
--  * ms_connection         : the Microsoft account the app "sends as" (one row; its sign-in is stored ENCRYPTED)
--  * teams_chats           : each employee's private Teams chat for each delivery method
--  * notification_log      : every message sent, skipped or failed (so you can see what happened)
-- All four are locked down: row-level security on, no policies, so only the server can use them.

create table if not exists notification_settings (
  id     int primary key default 1 check (id = 1),
  method text not null default 'off' check (method in ('off', 'user', 'bot', 'auto'))
  -- off  = send nothing
  -- user = send as the connected Microsoft account
  -- bot  = send from the Teams bot
  -- auto = try the bot, and use the connected account if the bot can't reach that person
);
insert into notification_settings (id) values (1) on conflict do nothing;

create table if not exists ms_connection (
  id                int primary key default 1 check (id = 1),
  account_id        text,
  account_email     text,
  account_name      text,
  refresh_token_enc text not null,                 -- encrypted; never stored in plain text
  status            text not null default 'ok' check (status in ('ok', 'needs_reconnect')),
  last_error        text,
  last_error_at     timestamptz,
  connected_by      uuid references employees(id) on delete set null,
  connected_at      timestamptz not null default now()
);

create table if not exists teams_chats (
  employee_id uuid not null references employees(id) on delete cascade,
  method      text not null check (method in ('user', 'bot')),
  chat_id     text not null,
  service_url text,                                -- bot only: where to send replies
  created_at  timestamptz not null default now(),
  primary key (employee_id, method)
);

create table if not exists notification_log (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid references employees(id) on delete set null,
  employee_name text,
  kind          text not null check (kind in ('digest', 'assigned', 'test')),
  method        text,
  status        text not null check (status in ('sent', 'failed', 'skipped')),
  detail        text,                              -- why it failed or was skipped
  summary       text,                              -- the first line of what was sent
  created_at    timestamptz not null default now()
);

create index if not exists notification_log_created_idx  on notification_log (created_at desc);
create index if not exists notification_log_employee_idx on notification_log (employee_id, kind, created_at desc);

alter table notification_settings enable row level security;
alter table ms_connection         enable row level security;
alter table teams_chats           enable row level security;
alter table notification_log      enable row level security;
