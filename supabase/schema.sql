-- Fresh install: Supabase > SQL Editor > New query > paste > Run.
-- Already have a database? Run the numbered files in supabase/ (migration-002 ... 012) instead.

create table employees (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text unique,
  role       text,                       -- e.g. SEO Specialist, Shopify Developer
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table projects (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  client_name        text not null,
  website            text,                                  -- client's site
  onboarding_date    date not null,
  reporting_date     date not null,                         -- reports repeat monthly on this day
  payment_date       date,                                  -- first payment; the schedule repeats from it
  payment_term       text check (payment_term in ('one_off', 'monthly', 'quarterly', 'biannual')),
  payment_method     text check (payment_method in ('subscription', 'stripe_link', 'bank_wire')),
  payment_amount_usd numeric(12, 2) check (payment_amount_usd >= 0),
  project_manager_id uuid references employees(id) on delete set null,  -- optional
  status             text not null default 'active'
                     check (status in ('active', 'halted', 'ended')),
  created_at         timestamptz not null default now()
);

-- Pivot table: many employees <-> many projects (an empty set = unassigned)
create table project_assignments (
  project_id  uuid not null references projects(id)  on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (project_id, employee_id)
);

-- Payment ledger: one row per payment that is owed. A monthly job (and the dashboard's "Generate dues"
-- button) creates a 'due' row for each payment that falls in the month; "Mark as paid" makes it 'paid'.
-- Rows stay when a project is halted or ended, so unpaid money stays owed.
create table payment_dues (
  project_id uuid not null references projects(id) on delete cascade,
  due_date   date not null,
  amount_usd numeric(12, 2) not null default 0 check (amount_usd >= 0),
  term       text check (term in ('one_off', 'monthly', 'quarterly', 'biannual')),   -- plan when the due was created
  method     text check (method in ('subscription', 'stripe_link', 'bank_wire')),    -- plan when the due was created
  status     text not null default 'due' check (status in ('due', 'paid')),
  paid_at    timestamptz,
  source     text not null default 'cron' check (source in ('cron', 'manual', 'migrated', 'backfill')),
  created_at timestamptz not null default now(),
  primary key (project_id, due_date),
  check ((status = 'paid') = (paid_at is not null))
);

-- History of every status change, with the reason given.
create table project_status_log (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  status     text not null check (status in ('active', 'halted', 'ended')),
  reason     text,
  changed_at timestamptz not null default now()
);

create index project_status_log_project_idx on project_status_log (project_id, changed_at desc);

-- Same rule as the other tables: the public key can only read, writes go through the server.
alter table project_status_log enable row level security;
create policy "public read project_status_log" on project_status_log for select using (true);

create index on project_assignments (employee_id);
create index on projects (status);
create index on projects (project_manager_id);
create index on payment_dues (status, due_date);

-- The public anon key can only READ. All writes go through the app's server
-- actions, which use the service-role key (never exposed to the browser).
alter table employees           enable row level security;
alter table projects            enable row level security;
alter table project_assignments enable row level security;
alter table payment_dues        enable row level security;

create policy "public read employees"   on employees           for select using (true);
create policy "public read projects"    on projects            for select using (true);
create policy "public read assignments" on project_assignments for select using (true);
create policy "public read payment_dues" on payment_dues        for select using (true);

-- Project team history: who managed / worked on a project, and from when to when. Written by the
-- functions below (set_project_team, set_project_status, deactivate_employee), never by hand.
create table if not exists project_team_history (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  employee_id   uuid references employees(id) on delete set null,   -- stays blank if the employee is deleted later
  employee_name text not null,                                      -- name at the time, so history survives a deletion
  role          text not null check (role in ('manager', 'member')),
  started_on    date not null,
  ended_on      date,                                               -- null = still on the project
  created_at    timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);

create index if not exists project_team_history_project_idx  on project_team_history (project_id, started_on desc);
create index if not exists project_team_history_employee_idx on project_team_history (employee_id);
-- At most one open stretch per person and role, and one open manager per project.
create unique index if not exists project_team_history_open_member
  on project_team_history (project_id, employee_id) where role = 'member' and ended_on is null;
create unique index if not exists project_team_history_open_manager
  on project_team_history (project_id) where role = 'manager' and ended_on is null;

alter table project_team_history enable row level security;
drop policy if exists "public read project_team_history" on project_team_history;
create policy "public read project_team_history" on project_team_history for select using (true);

-- Sets a project's manager and team in ONE transaction and records the change in the history.
--   p_manager   the project manager (null = none)
--   p_members   everyone assigned to the project
--   p_effective the date the change took effect (default: today, India time). Use an earlier date to
--               record a handover that already happened.
-- People who leave get their stretch closed on that date; people who join get a new one opened.
create or replace function set_project_team(
  p_project   uuid,
  p_manager   uuid,
  p_members   uuid[],
  p_effective date default null
) returns void
language plpgsql
as $$
declare
  eff         date := coalesce(p_effective, (now() at time zone 'Asia/Kolkata')::date);
  cur_manager uuid;
  members     uuid[] := coalesce(p_members, '{}');
begin
  select project_manager_id into cur_manager from projects where id = p_project for update;
  if not found then
    raise exception 'Project not found.';
  end if;

  -- Manager
  if cur_manager is distinct from p_manager then
    update project_team_history
       set ended_on = greatest(eff, started_on)
     where project_id = p_project and role = 'manager' and ended_on is null;

    update projects set project_manager_id = p_manager where id = p_project;

    if p_manager is not null then
      insert into project_team_history (project_id, employee_id, employee_name, role, started_on)
      select p_project, e.id, e.name, 'manager', eff from employees e where e.id = p_manager;
    end if;
  end if;

  -- Team members who are no longer on the project
  update project_team_history h
     set ended_on = greatest(eff, h.started_on)
   where h.project_id = p_project and h.role = 'member' and h.ended_on is null
     and not (h.employee_id = any (members));

  delete from project_assignments
   where project_id = p_project and not (employee_id = any (members));

  -- Team members who just joined
  with added as (
    insert into project_assignments (project_id, employee_id)
    select p_project, m from unnest(members) as m
    on conflict do nothing
    returning employee_id
  )
  insert into project_team_history (project_id, employee_id, employee_name, role, started_on)
  select p_project, e.id, e.name, 'member', eff
  from added a
  join employees e on e.id = a.employee_id;
end;
$$;

revoke execute on function set_project_team(uuid, uuid, uuid[], date) from public, anon, authenticated;
grant  execute on function set_project_team(uuid, uuid, uuid[], date) to service_role;

-- Ending a project closes everyone's stretch on that day; reopening it starts them again today.
-- Halting keeps the team on the project (they are still its team).
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

  if p_status = 'ended' then
    update project_team_history
       set ended_on = greatest(today, started_on)
     where project_id = p_project and ended_on is null;
  elsif cur_status = 'ended' then
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

revoke execute on function set_project_status(uuid, text, text) from public, anon, authenticated;
grant  execute on function set_project_status(uuid, text, text) to service_role;

-- Deactivating an employee hands their open projects over, and now records it in the history.
-- Each step is its own statement, in order: close the old stretch first, then open the new one.
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
  where project_manager_id = p_employee and status <> 'ended';

  select coalesce(array_agg(pa.project_id), '{}') into assigned_ids
  from project_assignments pa
  join projects p on p.id = pa.project_id
  where pa.employee_id = p_employee and p.status <> 'ended';

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

revoke execute on function deactivate_employee(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function deactivate_employee(uuid, uuid, uuid) to service_role;

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

-- Sample data (optional, delete if you don't want it)
insert into employees (name, email, role) values
  ('Sidharth',        'sidharth@digirockettechnologies.com',   'Project Manager'),
  ('Ishika',        'ishika@digirockettechnologies.com',   'Project Manager'),
  ('Ankit',        'ankit@digirockettechnologies.com',   'Project Manager'),
  ('Ritika Singh',         'ritika@digirockettechnologies.com',    'Shopify Developer'),
  ('Sandeep Kumar',        'sandeep@digirockettechnologies.com',   'SEO Specialist'),
  ('Navneet Raj',          'navneet@digirockettechnologies.com',   'SEO Specialist'),
  ('Motahar Hussain',      'motahar@digirockettechnologies.com',   'SEO Specialist'),
  ('Kajal Singh',          'kajal@digirockettechnologies.com',     'SEO Specialist'),
  ('Tushar Yadav',         'tushar@digirockettechnologies.com',    'SEO Specialist'),
  ('Rohit Kaushik',        'rohit@digirockettechnologies.com',     'SEO Specialist'),
  ('Pratyaksh Srivastava', 'pratyaksh@digirockettechnologies.com', 'Graphics'),
  ('Anurag Sharma',        'anurag@digirockettechnologies.com',    'Performance Marketer'),
  ('Shashwat Srivastava',  'shashwat@digirockettechnologies.com',  'Performance Marketer');

insert into projects (name, client_name, website, onboarding_date, reporting_date, project_manager_id,
                      payment_date, payment_term, payment_method, payment_amount_usd)
select v.name, v.client, v.site, current_date - v.onb, current_date + v.rep, e.id,
       current_date + v.pay, v.term, v.method, v.amount
from (values
  ('Store Migration', 'Acme Apparel',   'https://acmeapparel.example',   20, 10, 'sandeep@digirockettechnologies.com',  2, 'monthly',   'bank_wire',    1500.00),
  ('Q4 SEO Campaign', 'Acme Apparel',   'https://acmeapparel.example',   10, 20, 'sandeep@digirockettechnologies.com',  5, 'quarterly', 'stripe_link',  4200.00),
  ('Meta Ads Launch', 'Glow Cosmetics', 'https://glowcosmetics.example',  5,  7, null,                                  1, 'monthly',   'subscription',  900.00)
) as v(name, client, site, onb, rep, pm_email, pay, term, method, amount)
left join employees e on e.email = v.pm_email;

insert into project_assignments (project_id, employee_id)
select p.id, e.id from (values
  ('Store Migration', 'ritika@digirockettechnologies.com'),
  ('Q4 SEO Campaign', 'navneet@digirockettechnologies.com'),
  ('Q4 SEO Campaign', 'kajal@digirockettechnologies.com')
) as v(project, email)
join projects p  on p.name  = v.project
join employees e on e.email = v.email;

-- Start the team history from the sample teams above.
insert into project_team_history (project_id, employee_id, employee_name, role, started_on)
select p.id, e.id, e.name, 'manager', (p.created_at at time zone 'Asia/Kolkata')::date
from projects p
join employees e on e.id = p.project_manager_id
where p.status <> 'ended'
  and not exists (select 1 from project_team_history h where h.project_id = p.id and h.role = 'manager' and h.ended_on is null);

insert into project_team_history (project_id, employee_id, employee_name, role, started_on)
select pa.project_id, e.id, e.name, 'member', (pa.assigned_at at time zone 'Asia/Kolkata')::date
from project_assignments pa
join projects p  on p.id = pa.project_id
join employees e on e.id = pa.employee_id
where p.status <> 'ended'
  and not exists (
    select 1 from project_team_history h
    where h.project_id = pa.project_id and h.employee_id = pa.employee_id and h.role = 'member' and h.ended_on is null
  );
