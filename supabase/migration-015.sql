-- Project notes: onboarding notes for the client, plus calls, decisions and client requests over time.
-- Each note belongs to one project and has a type. Deleting a project removes its notes.
create table if not exists project_notes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind       text not null default 'general'
             check (kind in ('onboarding', 'call', 'decision', 'request', 'general')),
  body       text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_notes_project_idx on project_notes (project_id, created_at desc);

-- Same rule as the other tables: the public key can only read, writes go through the server.
alter table project_notes enable row level security;
drop policy if exists "public read project_notes" on project_notes;
create policy "public read project_notes" on project_notes for select using (true);
