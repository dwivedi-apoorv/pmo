-- Notes get an author, an edit history, and a rule: one onboarding note per project.
--  * every note records who wrote it and who last edited it (picked in the app until there is a login)
--  * every edit keeps the previous version, with who wrote it and when
--  * a project can have only ONE onboarding note: once it exists it can be edited but not added to
--    (other note types can still be added freely)

alter table project_notes
  add column if not exists created_by_id   uuid references employees(id) on delete set null,
  add column if not exists created_by_name text,
  add column if not exists updated_by_id   uuid references employees(id) on delete set null,
  add column if not exists updated_by_name text;

-- Projects that already have several onboarding notes keep the oldest as THE onboarding note; the extra
-- ones become General notes (their text is kept).
update project_notes n
   set kind = 'general'
 where n.kind = 'onboarding'
   and exists (
     select 1 from project_notes o
      where o.project_id = n.project_id and o.kind = 'onboarding'
        and (o.created_at, o.id) < (n.created_at, n.id)
   );

create unique index if not exists project_notes_one_onboarding on project_notes (project_id) where kind = 'onboarding';

-- Earlier versions of a note. Each row is the text as it stood before an edit replaced it.
create table if not exists project_note_versions (
  id            uuid primary key default gen_random_uuid(),
  note_id       uuid not null references project_notes(id) on delete cascade,
  body          text not null,
  saved_at      timestamptz not null,   -- when this version was written
  saved_by_id   uuid references employees(id) on delete set null,
  saved_by_name text,                   -- who wrote this version
  replaced_at   timestamptz not null default now()
);

create index if not exists project_note_versions_note_idx on project_note_versions (note_id, saved_at desc);

alter table project_note_versions enable row level security;
drop policy if exists "public read project_note_versions" on project_note_versions;
create policy "public read project_note_versions" on project_note_versions for select using (true);

-- Adds a note. The author is required. A second onboarding note for a project is refused.
create or replace function add_project_note(
  p_project uuid,
  p_kind    text,
  p_body    text,
  p_author  uuid
) returns uuid
language plpgsql
as $$
declare
  v_author text;
  v_id     uuid;
begin
  if not exists (select 1 from projects where id = p_project) then
    raise exception 'Project not found.';
  end if;
  if p_kind not in ('onboarding', 'call', 'decision', 'request', 'general') then
    raise exception 'Choose a type for the note.';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write something in the note.';
  end if;
  if char_length(btrim(p_body)) > 5000 then
    raise exception 'Notes can be 5000 characters at most.';
  end if;
  select name into v_author from employees where id = p_author;
  if v_author is null then
    raise exception 'Choose who is writing the note.';
  end if;
  if p_kind = 'onboarding' and exists (select 1 from project_notes where project_id = p_project and kind = 'onboarding') then
    raise exception 'This project already has onboarding notes. Edit them instead of adding more.';
  end if;

  insert into project_notes (project_id, kind, body, created_by_id, created_by_name, updated_by_id, updated_by_name)
  values (p_project, p_kind, btrim(p_body), p_author, v_author, p_author, v_author)
  returning id into v_id;
  return v_id;
end;
$$;

-- Edits a note's text, keeping the previous version in the history. Saving unchanged text does nothing.
create or replace function edit_project_note(
  p_note   uuid,
  p_body   text,
  p_editor uuid
) returns void
language plpgsql
as $$
declare
  old_note project_notes%rowtype;
  v_editor text;
begin
  select * into old_note from project_notes where id = p_note for update;
  if not found then
    raise exception 'Note not found.';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write something in the note.';
  end if;
  if char_length(btrim(p_body)) > 5000 then
    raise exception 'Notes can be 5000 characters at most.';
  end if;
  select name into v_editor from employees where id = p_editor;
  if v_editor is null then
    raise exception 'Choose who is editing the note.';
  end if;

  if btrim(old_note.body) = btrim(p_body) then
    return; -- nothing changed, so no new version
  end if;

  insert into project_note_versions (note_id, body, saved_at, saved_by_id, saved_by_name)
  values (
    old_note.id, old_note.body, old_note.updated_at,
    coalesce(old_note.updated_by_id, old_note.created_by_id),
    coalesce(old_note.updated_by_name, old_note.created_by_name)
  );

  update project_notes
     set body = btrim(p_body), updated_at = now(), updated_by_id = p_editor, updated_by_name = v_editor
   where id = p_note;
end;
$$;

revoke execute on function add_project_note(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function edit_project_note(uuid, text, uuid)      from public, anon, authenticated;
grant  execute on function add_project_note(uuid, text, text, uuid) to service_role;
grant  execute on function edit_project_note(uuid, text, uuid)      to service_role;
