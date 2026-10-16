-- Deactivate / reactivate employees, with a safe handover of their open projects.

alter table employees add column if not exists is_active boolean not null default true;

-- Deactivates an employee in ONE transaction. Their open (not completed)
-- projects must be handed over:
--   p_manager_to  - an active Project Manager who takes over projects they manage
--   p_assignee_to - an active non-manager who takes over projects they're assigned to
-- Completed projects keep their history untouched.
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
  where project_manager_id = p_employee and status <> 'completed';

  select count(*) into open_assigned
  from project_assignments pa
  join projects p on p.id = pa.project_id
  where pa.employee_id = p_employee and p.status <> 'completed';

  if open_managed > 0 then
    if p_manager_to is null or p_manager_to = p_employee or not exists (
      select 1 from employees
      where id = p_manager_to and is_active
        and lower(trim(coalesce(role, ''))) = 'project manager'
    ) then
      raise exception 'Choose an active project manager to take over % project(s).', open_managed;
    end if;

    update projects set project_manager_id = p_manager_to
    where project_manager_id = p_employee and status <> 'completed';
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
    where pa.employee_id = p_employee and p.status <> 'completed'
    on conflict do nothing;

    delete from project_assignments pa
    using projects p
    where p.id = pa.project_id
      and pa.employee_id = p_employee
      and p.status <> 'completed';
  end if;

  update employees set is_active = false where id = p_employee;
end;
$$;

-- Only the server (service-role key) may call it, never the public anon key.
revoke execute on function deactivate_employee(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function deactivate_employee(uuid, uuid, uuid) to service_role;
