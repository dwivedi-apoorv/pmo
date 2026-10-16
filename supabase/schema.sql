-- Fresh install: Supabase > SQL Editor > New query > paste > Run
-- (Already ran an older version? Run supabase/migration-002.sql instead.)

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
  website            text,                                              -- client's site
  onboarding_date    date not null,
  reporting_date     date not null,
  payment_date       date,                                   -- first payment; the schedule repeats from it
  payment_term       text check (payment_term in ('one_off', 'monthly', 'quarterly', 'biannual')),
  payment_method     text check (payment_method in ('subscription', 'stripe_link', 'bank_wire')),
  payment_amount_usd numeric(12, 2) check (payment_amount_usd >= 0),
  project_manager_id uuid references employees(id) on delete set null,  -- optional
  status             text not null default 'active'
                     check (status in ('active', 'on_hold', 'completed')),
  created_at         timestamptz not null default now()
);

-- Pivot table: many employees <-> many projects (an empty set = unassigned)
create table project_assignments (
  project_id  uuid not null references projects(id)  on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (project_id, employee_id)
);

create index on project_assignments (employee_id);
create index on projects (status);
create index on projects (project_manager_id);

-- The public anon key can only READ. All writes go through the app's server
-- actions, which use the service-role key (never exposed to the browser).
alter table employees           enable row level security;
alter table projects            enable row level security;
alter table project_assignments enable row level security;

create policy "public read employees"   on employees           for select using (true);
create policy "public read projects"    on projects            for select using (true);
create policy "public read assignments" on project_assignments for select using (true);

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

insert into projects (name, client_name, website, onboarding_date, reporting_date, project_manager_id)
select v.name, v.client, v.site, current_date - v.onb, current_date + v.rep, e.id
from (values
  ('Store Migration', 'Acme Apparel',   'https://acmeapparel.example', 20, 10, 'sandeep@digirockettechnologies.com'),
  ('Q4 SEO Campaign', 'Acme Apparel',   'https://acmeapparel.example', 10, 20, 'sandeep@digirockettechnologies.com'),
  ('Meta Ads Launch', 'Glow Cosmetics', 'https://glowcosmetics.example', 5,  7, null)
) as v(name, client, site, onb, rep, pm_email)
left join employees e on e.email = v.pm_email;

insert into project_assignments (project_id, employee_id)
select p.id, e.id from (values
  ('Store Migration', 'ritika@digirockettechnologies.com'),
  ('Q4 SEO Campaign', 'navneet@digirockettechnologies.com'),
  ('Q4 SEO Campaign', 'kajal@digirockettechnologies.com')
) as v(project, email)
join projects p  on p.name  = v.project
join employees e on e.email = v.email;
