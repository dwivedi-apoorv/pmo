-- Project lifecycle: a project can be Halted (suspended) or Ended instead of being deleted.
-- Existing 'on_hold' projects become 'halted' and 'completed' ones become 'ended'.

alter table projects drop constraint if exists projects_status_check;
update projects set status = 'halted' where status = 'on_hold';
update projects set status = 'ended'  where status = 'completed';
alter table projects add constraint projects_status_check check (status in ('active', 'halted', 'ended'));

-- History of every status change, with the reason given.
create table if not exists project_status_log (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  status     text not null check (status in ('active', 'halted', 'ended')),
  reason     text,
  changed_at timestamptz not null default now()
);

create index if not exists project_status_log_project_idx on project_status_log (project_id, changed_at desc);

-- Same rule as the other tables: the public key can only read, writes go through the server.
alter table project_status_log enable row level security;
drop policy if exists "public read project_status_log" on project_status_log;
create policy "public read project_status_log" on project_status_log for select using (true);

-- Changes a project's status and records why, in ONE transaction. Projects are never deleted.
--   active -> halted | ended      halted -> active | ended      ended -> active (reopen)
-- A reason is required to halt or end a project; it is optional when resuming or reopening.
create or replace function set_project_status(
  p_project uuid,
  p_status  text,
  p_reason  text default null
) returns void
language plpgsql
as $$
declare
  cur_status text;
begin
  select status into cur_status from projects where id = p_project for update;
  if not found then
    raise exception 'Project not found.';
  end if;
  if p_status not in ('active', 'halted', 'ended') then
    raise exception 'Invalid status.';
  end if;
  if p_status = cur_status then
    raise exception 'The project is already %.', cur_status;
  end if;
  if p_status in ('halted', 'ended') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required.';
  end if;

  update projects set status = p_status where id = p_project;
  insert into project_status_log (project_id, status, reason)
  values (p_project, p_status, nullif(btrim(p_reason), ''));
end;
$$;

revoke execute on function set_project_status(uuid, text, text) from public, anon, authenticated;
grant  execute on function set_project_status(uuid, text, text) to service_role;

-- Employee handover now treats a project as "open" until it has ended (halted ones will resume).
-- Deactivates an employee in ONE transaction. Their open (not ended)
-- projects must be handed over:
--   p_manager_to  - an active Project Manager who takes over projects they manage
--   p_assignee_to - an active non-manager who takes over projects they're assigned to
-- Ended projects keep their history untouched.
create or replace function deactivate_employee(
  p_employee    uuid,
  p_manager_to  uuid default null,
  p_assignee_to uuid default null
) returns void
language plpgsql
as $$
declare
  open_managed  int;
  open_assigned int;
begin
  select count(*) into open_managed
  from projects
  where project_manager_id = p_employee and status <> 'ended';

  select count(*) into open_assigned
  from project_assignments pa
  join projects p on p.id = pa.project_id
  where pa.employee_id = p_employee and p.status <> 'ended';

  if open_managed > 0 then
    if p_manager_to is null or p_manager_to = p_employee or not exists (
      select 1 from employees
      where id = p_manager_to and is_active
        and lower(trim(coalesce(role, ''))) = 'project manager'
    ) then
      raise exception 'Choose an active project manager to take over % project(s).', open_managed;
    end if;

    update projects set project_manager_id = p_manager_to
    where project_manager_id = p_employee and status <> 'ended';
  end if;

  if open_assigned > 0 then
    if p_assignee_to is null or p_assignee_to = p_employee or not exists (
      select 1 from employees
      where id = p_assignee_to and is_active
        and lower(trim(coalesce(role, ''))) <> 'project manager'
    ) then
      raise exception 'Choose an active team member to take over % assigned project(s).', open_assigned;
    end if;

    insert into project_assignments (project_id, employee_id)
    select pa.project_id, p_assignee_to
    from project_assignments pa
    join projects p on p.id = pa.project_id
    where pa.employee_id = p_employee and p.status <> 'ended'
    on conflict do nothing;

    delete from project_assignments pa
    using projects p
    where p.id = pa.project_id
      and pa.employee_id = p_employee
      and p.status <> 'ended';
  end if;

  update employees set is_active = false where id = p_employee;
end;
$$;

-- Only the server (service-role key) may call it, never the public anon key.
revoke execute on function deactivate_employee(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function deactivate_employee(uuid, uuid, uuid) to service_role;
