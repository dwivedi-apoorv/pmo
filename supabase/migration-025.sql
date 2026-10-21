-- Several reasons at once when halting, completing or losing a project.
--  * project_status_log.reasons : each reason on its own (for counting); .reason keeps them joined as text
--  * set_project_status takes the list of reasons
alter table project_status_log add column if not exists reasons text[] not null default '{}';
update project_status_log set reasons = array[btrim(reason)] where reasons = '{}' and reason is not null and btrim(reason) <> '' and status <> 'active';

drop function if exists set_project_status(uuid, text, text);

create or replace function set_project_status(
  p_project uuid,
  p_status  text,
  p_reason  text default null,                -- a free note (used when a project is resumed or reopened)
  p_reasons text[] default '{}'               -- the reasons picked from the list
) returns void
language plpgsql
as $$
declare
  cur_status text;
  today      date := (now() at time zone 'Asia/Kolkata')::date;
  v_reasons  text[] := coalesce((select array_agg(distinct btrim(r)) from unnest(coalesce(p_reasons, '{}')) r where btrim(r) <> ''), '{}');
  v_text     text;
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
  v_text := coalesce(nullif(array_to_string(v_reasons, ', '), ''), nullif(btrim(p_reason), ''));
  if p_status in ('halted', 'ended') and v_text is null then
    raise exception 'A reason is required.';
  end if;

  update projects set status = p_status where id = p_project;
  insert into project_status_log (project_id, status, reason, reasons)
  values (p_project, p_status, v_text, v_reasons);

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

revoke execute on function set_project_status(uuid, text, text, text[]) from public, anon, authenticated;
grant  execute on function set_project_status(uuid, text, text, text[]) to service_role;
