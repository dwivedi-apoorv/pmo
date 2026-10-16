-- For databases created from the FIRST version of schema.sql.
-- Reshapes projects to: name, client_name, onboarding_date, reporting_date,
-- project_manager_id. Existing projects are kept.

alter table projects rename column client     to client_name;
alter table projects rename column start_date to onboarding_date;
alter table projects rename column due_date   to reporting_date;
alter table projects drop column service;

update projects set client_name     = coalesce(client_name, '—')      where client_name     is null;
update projects set onboarding_date = coalesce(onboarding_date, current_date) where onboarding_date is null;
update projects set reporting_date  = coalesce(reporting_date,  current_date) where reporting_date  is null;

alter table projects alter column client_name     set not null;
alter table projects alter column onboarding_date set not null;
alter table projects alter column reporting_date  set not null;

alter table projects add column project_manager_id uuid
  references employees(id) on delete set null;
create index on projects (project_manager_id);
