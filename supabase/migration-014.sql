-- Services: tag each project with the services it includes (SEO, Ads, Shopify, ...). A project can have
-- several. Services live in their own table, linked to projects through a pivot table, like employees
-- and assignments, so new services can be added at any time without changing the database.

create table if not exists services (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
-- "seo" and "SEO" are the same service
create unique index if not exists services_name_key on services (lower(btrim(name)));

create table if not exists project_services (
  project_id uuid not null references projects(id) on delete cascade,
  service_id uuid not null references services(id) on delete restrict,   -- a service in use can't be removed
  primary key (project_id, service_id)
);
create index if not exists project_services_service_idx on project_services (service_id);

alter table services         enable row level security;
alter table project_services enable row level security;
drop policy if exists "public read services"         on services;
drop policy if exists "public read project_services" on project_services;
create policy "public read services"         on services         for select using (true);
create policy "public read project_services" on project_services for select using (true);

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
