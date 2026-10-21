-- Fresh install: Supabase > SQL Editor > New query > paste > Run.
-- Already have a database? Run the numbered files in supabase/ (migration-002 ... 025) instead.

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
                     check (status in ('active', 'halted', 'ended', 'completed')),
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
  status     text not null check (status in ('active', 'halted', 'ended', 'completed')),
  reason     text,                                  -- the reasons joined as text (for display)
  reasons    text[] not null default '{}',          -- each reason on its own (for counting)
  changed_at timestamptz not null default now()
);

create index project_status_log_project_idx on project_status_log (project_id, changed_at desc);

-- Locked down: row-level security is on with no policies, so only the server can use this table.
alter table project_status_log enable row level security;

create index on project_assignments (employee_id);
create index on projects (status);
create index on projects (project_manager_id);
create index on payment_dues (status, due_date);

-- Locked down: row-level security is on and there are NO policies, so the public (anon) key can
-- neither read nor write anything. The app talks to the database only from the server, with the
-- service-role key, after checking that you are logged in.
alter table employees           enable row level security;
alter table projects            enable row level security;
alter table project_assignments enable row level security;
alter table payment_dues        enable row level security;


-- Services: tag each project with the services it includes (SEO, Ads, Shopify, ...). A project can have
-- several. Services live in their own table, linked to projects through a pivot table, like employees
-- and assignments, so new services can be added at any time without changing the database.

create table services (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
-- "seo" and "SEO" are the same service
create unique index services_name_key on services (lower(btrim(name)));

create table project_services (
  project_id uuid not null references projects(id) on delete cascade,
  service_id uuid not null references services(id) on delete restrict,   -- a service in use can't be removed
  primary key (project_id, service_id)
);
create index project_services_service_idx on project_services (service_id);

alter table services         enable row level security;
alter table project_services enable row level security;

-- The starting services. Add others from the project form whenever you need them.
insert into services (name) values ('SEO'), ('Performance Marketing'), ('UI UX'), ('Redesign')
on conflict do nothing;

-- Returns the id of the service with this name, creating it if it doesn't exist yet. Extra spaces and
-- capital letters don't create duplicates.
create or replace function add_service(p_name text) returns uuid
language plpgsql
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_id   uuid;
begin
  if v_name = '' then
    raise exception 'Service name is required.';
  end if;
  if char_length(v_name) > 40 then
    raise exception 'Service name is too long (40 characters at most).';
  end if;

  select id into v_id from services where lower(btrim(name)) = lower(v_name);
  if v_id is null then
    insert into services (name) values (v_name) returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Sets exactly which services a project has, in ONE transaction: removes the ones left out, adds new ones.
create or replace function set_project_services(p_project uuid, p_services uuid[]) returns void
language plpgsql
as $$
declare
  wanted uuid[] := coalesce(p_services, '{}');
begin
  if not exists (select 1 from projects where id = p_project) then
    raise exception 'Project not found.';
  end if;

  delete from project_services where project_id = p_project and not (service_id = any (wanted));

  insert into project_services (project_id, service_id)
  select p_project, s from unnest(wanted) as s
  on conflict do nothing;
end;
$$;

revoke execute on function add_service(text)                 from public, anon, authenticated;
revoke execute on function set_project_services(uuid, uuid[]) from public, anon, authenticated;
grant  execute on function add_service(text)                 to service_role;
grant  execute on function set_project_services(uuid, uuid[]) to service_role;

-- Project notes: onboarding notes for the client, plus calls, decisions and client requests over time.
-- Each note belongs to one project and has a type, an author, and an edit history. A project can have
-- only one onboarding note (it can be edited, not added to). Deleting a project removes its notes.
create table project_notes (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  kind            text not null default 'general'
                  check (kind in ('onboarding', 'call', 'decision', 'request', 'general')),
  body            text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by_id   uuid references employees(id) on delete set null,
  created_by_name text,
  updated_by_id   uuid references employees(id) on delete set null,
  updated_by_name text
);

create index project_notes_project_idx on project_notes (project_id, created_at desc);
create unique index project_notes_one_onboarding on project_notes (project_id) where kind = 'onboarding';

-- Earlier versions of a note. Each row is the text as it stood before an edit replaced it.
create table project_note_versions (
  id            uuid primary key default gen_random_uuid(),
  note_id       uuid not null references project_notes(id) on delete cascade,
  body          text not null,
  saved_at      timestamptz not null,   -- when this version was written
  saved_by_id   uuid references employees(id) on delete set null,
  saved_by_name text,                   -- who wrote this version
  replaced_at   timestamptz not null default now()
);

create index project_note_versions_note_idx on project_note_versions (note_id, saved_at desc);

-- Locked down: row-level security is on with no policies, so only the server can use this table.
alter table project_notes         enable row level security;
alter table project_note_versions enable row level security;

-- Adds a note. The author is the logged-in employee (empty until the app has a login). A second
-- onboarding note for a project is refused.
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

-- Report tracking: one row per report that has been marked as SENT. A scheduled report (project + due
-- date) with no row here has not been sent; once its day has passed it counts as overdue, which is one
-- of the two things that flag a project "At risk" (the other is an overdue payment).
create table report_log (
  project_id uuid not null references projects(id) on delete cascade,
  due_date   date not null,
  sent_at    timestamptz not null default now(),
  primary key (project_id, due_date)
);

create index report_log_sent_at_idx on report_log (sent_at desc);

-- Locked down: row-level security is on with no policies, so only the server can use this table.
alter table report_log enable row level security;

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
     and exists (select 1 from projects where project_manager_id = p_employee and status not in ('ended', 'completed')) then
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

-- Login with a one-time code (OTP) sent to the employee's email.
--  * only an ACTIVE employee's email can get a code
--  * the 6-digit code itself is never stored, only a keyed hash of it (computed by the app)
--  * a code works once, for 10 minutes, and gets 5 wrong tries
--  * limits: one code per email every 30 seconds, 5 per hour per email, 20 per hour per network address
--  * row-level security is on with NO policies, so nothing but the server can read or write this table

create table login_codes (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,              -- lower-case
  code_hash  text not null,
  ip         text,
  expires_at timestamptz not null,
  attempts   int  not null default 0,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index login_codes_email_idx on login_codes (email, created_at desc);
create index login_codes_ip_idx    on login_codes (ip, created_at desc);

alter table login_codes enable row level security;

-- Prepares a code for an email. Returns 'sent' (the app should now email the code), 'unknown' (not an
-- active employee, so nothing is sent) or 'limited' (too many requests). The app shows the same message
-- for all three, so nobody can use the login page to find out which emails exist.
create or replace function login_issue_code(
  p_email       text,
  p_code_hash   text,
  p_ip          text default null,
  p_ttl_minutes int  default 10
) returns text
language plpgsql
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email = '' or not exists (
    select 1 from employees where lower(btrim(email)) = v_email and is_active
  ) then
    return 'unknown';
  end if;

  if exists (select 1 from login_codes where email = v_email and created_at > now() - interval '30 seconds') then
    return 'limited';
  end if;
  if (select count(*) from login_codes where email = v_email and created_at > now() - interval '1 hour') >= 5 then
    return 'limited';
  end if;
  if p_ip is not null and (select count(*) from login_codes where ip = p_ip and created_at > now() - interval '1 hour') >= 20 then
    return 'limited';
  end if;

  -- a new code replaces any earlier unused one
  update login_codes set used_at = now() where email = v_email and used_at is null;
  insert into login_codes (email, code_hash, ip, expires_at)
  values (v_email, p_code_hash, p_ip, now() + make_interval(mins => p_ttl_minutes));

  delete from login_codes where created_at < now() - interval '1 day';
  return 'sent';
end;
$$;

-- Checks a code. Returns the employee's id when it is right, otherwise null. A right code is used up;
-- a wrong one counts as a try, and after 5 the code no longer works.
create or replace function login_check_code(p_email text, p_code_hash text) returns uuid
language plpgsql
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  c       login_codes%rowtype;
  v_emp   uuid;
begin
  select * into c from login_codes
   where email = v_email and used_at is null and expires_at > now()
   order by created_at desc
   limit 1
   for update;
  if not found or c.attempts >= 5 then
    return null;
  end if;

  if c.code_hash <> coalesce(p_code_hash, '') then
    update login_codes set attempts = attempts + 1 where id = c.id;
    return null;
  end if;

  update login_codes set used_at = now() where id = c.id;
  select id into v_emp from employees where lower(btrim(email)) = v_email and is_active;
  return v_emp; -- null if they were deactivated since the code was sent
end;
$$;

revoke execute on function login_issue_code(text, text, text, int) from public, anon, authenticated;
revoke execute on function login_check_code(text, text)            from public, anon, authenticated;
grant  execute on function login_issue_code(text, text, text, int) to service_role;
grant  execute on function login_check_code(text, text)            to service_role;

-- Microsoft Teams notifications.
--  * notification_settings : how messages are delivered (one row)
--  * ms_connection         : the Microsoft account the app "sends as" (one row; its sign-in is stored ENCRYPTED)
--  * teams_chats           : each employee's private Teams chat for each delivery method
--  * notification_log      : every message sent, skipped or failed (so you can see what happened)
-- All four are locked down: row-level security on, no policies, so only the server can use them.

create table notification_settings (
  id     int primary key default 1 check (id = 1),
  method text not null default 'off' check (method in ('off', 'user', 'bot', 'auto')),
  disabled_kinds text[] not null default '{}'  -- kinds switched off: 'reports', 'payments', 'assigned'
  -- off  = send nothing
  -- user = send as the connected Microsoft account
  -- bot  = send from the Teams bot
  -- auto = try the bot, and use the connected account if the bot can't reach that person
);
insert into notification_settings (id) values (1);

create table ms_connection (
  id                int primary key default 1 check (id = 1),
  account_id        text,
  account_email     text,
  account_name      text,
  refresh_token_enc text not null,                 -- encrypted; never stored in plain text
  status            text not null default 'ok' check (status in ('ok', 'needs_reconnect')),
  last_error        text,
  last_error_at     timestamptz,
  connected_by      uuid references employees(id) on delete set null,
  connected_at      timestamptz not null default now()
);

create table teams_chats (
  employee_id uuid not null references employees(id) on delete cascade,
  method      text not null check (method in ('user', 'bot')),
  chat_id     text not null,
  service_url text,                                -- bot only: where to send replies
  created_at  timestamptz not null default now(),
  primary key (employee_id, method)
);

create table notification_log (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid references employees(id) on delete set null,
  employee_name text,
  kind          text not null check (kind in ('digest', 'assigned', 'test')),
  method        text,
  status        text not null check (status in ('sent', 'failed', 'skipped')),
  detail        text,                              -- why it failed or was skipped
  summary       text,                              -- the first line of what was sent
  created_at    timestamptz not null default now()
);

create index notification_log_created_idx  on notification_log (created_at desc);
create index notification_log_employee_idx on notification_log (employee_id, kind, created_at desc);

alter table notification_settings enable row level security;
alter table ms_connection         enable row level security;
alter table teams_chats           enable row level security;
alter table notification_log      enable row level security;

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
where p.status not in ('ended', 'completed')
  and not exists (select 1 from project_team_history h where h.project_id = p.id and h.role = 'manager' and h.ended_on is null);

insert into project_team_history (project_id, employee_id, employee_name, role, started_on)
select pa.project_id, e.id, e.name, 'member', (pa.assigned_at at time zone 'Asia/Kolkata')::date
from project_assignments pa
join projects p  on p.id = pa.project_id
join employees e on e.id = pa.employee_id
where p.status not in ('ended', 'completed')
  and not exists (
    select 1 from project_team_history h
    where h.project_id = pa.project_id and h.employee_id = pa.employee_id and h.role = 'member' and h.ended_on is null
  );

-- ---- Role-based access (migration-022) ----
alter table employees add column if not exists access_role text not null default 'member'
  check (access_role in ('admin', 'manager', 'member'));

create table if not exists role_permissions (
  role       text not null check (role in ('manager', 'member')),
  permission text not null,
  allowed    boolean not null,
  primary key (role, permission)
);
alter table role_permissions enable row level security;

update employees set access_role = 'manager' where access_role = 'member' and lower(btrim(role)) = 'project manager';
update employees set access_role = 'admin' where lower(email) = 'apoorv.dwivedi@digirockettechnologies.com';

-- ---- Reasons for stopping a project (migration-024) ----
create table if not exists status_reasons (
  id         uuid primary key default gen_random_uuid(),
  status     text not null check (status in ('halted', 'ended', 'completed')),   -- ended = lost
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index if not exists status_reasons_name_key on status_reasons (status, lower(btrim(name)));
alter table status_reasons enable row level security;   -- no policies: only the server can use it

insert into status_reasons (status, name) values
  ('ended', 'Budget constraints'),
  ('ended', 'Moved to another agency'),
  ('ended', 'Not satisfied with results'),
  ('ended', 'Brought work in-house'),
  ('ended', 'Business closed'),
  ('ended', 'Payment issues'),
  ('ended', 'Poor communication'),
  ('halted', 'Awaiting client approval'),
  ('halted', 'Budget on hold'),
  ('halted', 'Client unresponsive'),
  ('halted', 'Payment pending'),
  ('halted', 'Seasonal pause'),
  ('completed', 'Project delivered'),
  ('completed', 'Contract term finished')
on conflict do nothing;

-- Keep the short reasons already typed in the past (long sentences are left out of the list).
insert into status_reasons (status, name)
select distinct on (status, lower(regexp_replace(btrim(reason), '\s+', ' ', 'g'))) status, regexp_replace(btrim(reason), '\s+', ' ', 'g')
from project_status_log
where status in ('halted', 'ended', 'completed') and reason is not null and char_length(btrim(reason)) between 1 and 60
on conflict do nothing;
