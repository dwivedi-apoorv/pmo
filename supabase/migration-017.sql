-- Note authors now come from the logged-in user, not from a box in the form. Until the app has a login
-- there is no logged-in user, so the author may be left empty (the note then shows no author). Once the
-- app passes the logged-in employee, every note records who wrote and who edited it.
--
-- Only the "author is required" check changes. A name that is given must still be a real employee.

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
  if p_author is not null then
    select name into v_author from employees where id = p_author;
    if v_author is null then
      raise exception 'That employee does not exist.';
    end if;
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
  if p_editor is not null then
    select name into v_editor from employees where id = p_editor;
    if v_editor is null then
      raise exception 'That employee does not exist.';
    end if;
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
