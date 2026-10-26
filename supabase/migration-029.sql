-- Teams group chat per project.
--  * project_chats                       : the Teams chat made for a project (so a project never gets two)
--  * notification_settings.project_chat_auto : create the chat automatically when a project is created
create table if not exists project_chats (
  project_id uuid primary key references projects(id) on delete cascade,
  chat_id    text not null,
  web_url    text,
  created_at timestamptz not null default now()
);
alter table project_chats enable row level security;   -- no policies: only the server can use it

alter table notification_settings add column if not exists project_chat_auto boolean not null default false;
