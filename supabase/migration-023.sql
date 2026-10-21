-- A fourth project status: 'completed' (finished normally), kept apart from 'ended' (shown as "Lost").
-- Completed behaves like ended everywhere (drops off reports and payments, closes the team's stretch,
-- no handover needed when someone leaves) but needs no reason.
alter table projects           drop constraint if exists projects_status_check;
alter table projects           add  constraint projects_status_check check (status in ('active', 'halted', 'ended', 'completed'));
alter table project_status_log drop constraint if exists project_status_log_status_check;
alter table project_status_log add  constraint project_status_log_status_check check (status in ('active', 'halted', 'ended', 'completed'));

create or replace function set_project_status(
  p_project uuid,
  p_status  text,
  p_reason  text default null
) returns void
language plpgsql
as $$
declare
  cur_status text;
  today      date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select status into cur_status from projects where id = p_project for update;
  if not found then
    raise exception 'Project not found.';
  end if;
  if p_status not in ('active', 'halted', 'ended', 'completed') then
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

  if p_status in ('ended', 'completed') then
    update project_team_history
       set ended_on = greatest(today, started_on)
     where project_id = p_project and ended_on is null;
  elsif cur_status in ('ended', 'completed') then
    -- Reopened: the manager and team assigned to the project start again today.
    insert into project_team_history (project_id, employee_id, employee_name, role, started_on)
    select p.id, e.id, e.name, 'manager', today
    from projects p join employees e on e.id = p.project_manager_id
    where p.id = p_project
      and not exists (select 1 from project_team_history h where h.project_id = p.id and h.role = 'manager' and h.ended_on is null);

    insert into project_team_history (project_id, employee_id, employee_name, role, started_on)
    select pa.project_id, e.id, e.name, 'member', today
    from project_assignments pa join employees e on e.id = pa.employee_id
    where pa.project_id = p_project
      and not exists (
        select 1 from project_team_history h
        where h.project_id = pa.project_id and h.employee_id = pa.employee_id and h.role = 'member' and h.ended_on is null
      );
  end if;
end;
$$;

create or replace function deactivate_employee(
  p_employee    uuid,
  p_manager_to  uuid default null,
  p_assignee_to uuid default null
) returns void
language plpgsql
as $$
declare
  today         date := (now() at time zone 'Asia/Kolkata')::date;
  managed_ids   uuid[];
  assigned_ids  uuid[];
begin
  select coalesce(array_agg(id), '{}') into managed_ids
  from projects
  where project_manager_id = p_employee and status not in ('ended', 'completed');

  select coalesce(array_agg(pa.project_id), '{}') into assigned_ids
  from project_assignments pa
  join projects p on p.id = pa.project_id
  where pa.employee_id = p_employee and p.status not in ('ended', 'completed');

  if cardinality(managed_ids) > 0 then
    if p_manager_to is null or p_manager_to = p_employee or not exists (
      select 1 from employees
      where id = p_manager_to and is_active
        and lower(trim(coalesce(role, ''))) = 'project manager'
    ) then
      raise exception 'Choose an active project manager to take over % project(s).', cardinality(managed_ids);
    end if;

    update project_team_history
       set ended_on = greatest(today, started_on)
     where role = 'manager' and ended_on is null and employee_id = p_employee
       and project_id = any (managed_ids);

    update projects set project_manager_id = p_manager_to where id = any (managed_ids);

    insert into project_team_history (project_id, employee_id, employee_name, role, started_on)
    select pid, e.id, e.name, 'manager', today
    from unnest(managed_ids) as pid
    join employees e on e.id = p_manager_to;
  end if;

  if cardinality(assigned_ids) > 0 then
    if p_assignee_to is null or p_assignee_to = p_employee or not exists (
      select 1 from employees
      where id = p_assignee_to and is_active
        and lower(trim(coalesce(role, ''))) <> 'project manager'
    ) then
      raise exception 'Choose an active team member to take over % assigned project(s).', cardinality(assigned_ids);
    end if;

    update project_team_history
       set ended_on = greatest(today, started_on)
     where role = 'member' and ended_on is null and employee_id = p_employee
       and project_id = any (assigned_ids);

    insert into project_assignments (project_id, employee_id)
    select pid, p_assignee_to from unnest(assigned_ids) as pid
    on conflict do nothing;

    -- Start the replacement's stretch, unless they were already on the project.
    insert into project_team_history (project_id, employee_id, employee_name, role, started_on)
    select pid, e.id, e.name, 'member', today
    from unnest(assigned_ids) as pid
    join employees e on e.id = p_assignee_to
    where not exists (
      select 1 from project_team_history h
      where h.project_id = pid and h.employee_id = p_assignee_to and h.role = 'member' and h.ended_on is null
    );

    delete from project_assignments where employee_id = p_employee and project_id = any (assigned_ids);
  end if;

  update employees set is_active = false where id = p_employee;
end;
$$;

create or replace function update_employee(
  p_employee uuid,
  p_name     text,
  p_email    text,
  p_role     text
) returns void
language plpgsql
as $$
declare
  old_role text;
begin
  select role into old_role from employees where id = p_employee for update;
  if not found then
    raise exception 'Employee not found.';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Name is required.'; end if;
  if coalesce(btrim(p_email), '') = '' then raise exception 'Email is required.'; end if;
  if coalesce(btrim(p_role), '') = '' then raise exception 'Role is required.'; end if;

  if lower(btrim(coalesce(old_role, ''))) = 'project manager'
     and lower(btrim(p_role)) <> 'project manager'
     and exists (select 1 from projects where project_manager_id = p_employee and status not in ('ended', 'completed')) then
    raise exception 'This person still manages projects. Hand them over before changing the role from Project Manager.';
  end if;

  update employees
     set name = btrim(p_name), email = lower(btrim(p_email)), role = btrim(p_role)
   where id = p_employee;

  update project_team_history set employee_name = btrim(p_name) where employee_id = p_employee;
end;
$$;
