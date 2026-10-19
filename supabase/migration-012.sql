-- Editing an employee (name, email, role) in ONE transaction.
--  * the new name is also written into their project history, so history reads the same everywhere
--  * a project manager can't be changed to another role while they still run a project that hasn't
--    ended: hand those projects to someone else first (Employees > Deactivate does that for you)
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
     and exists (select 1 from projects where project_manager_id = p_employee and status <> 'ended') then
    raise exception 'This person still manages projects. Hand them over before changing the role from Project Manager.';
  end if;

  update employees
     set name = btrim(p_name), email = lower(btrim(p_email)), role = btrim(p_role)
   where id = p_employee;

  update project_team_history set employee_name = btrim(p_name) where employee_id = p_employee;
end;
$$;

revoke execute on function update_employee(uuid, text, text, text) from public, anon, authenticated;
grant  execute on function update_employee(uuid, text, text, text) to service_role;
