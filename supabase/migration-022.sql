-- Role-based access.
--  * employees.access_role : admin / manager / member (separate from the job title in employees.role)
--  * role_permissions      : which permissions the manager and member roles have (admins always have everything).
--                            Only choices made on the Access page are stored; missing rows use the built-in defaults.
alter table employees add column if not exists access_role text not null default 'member'
  check (access_role in ('admin', 'manager', 'member'));

create table if not exists role_permissions (
  role       text not null check (role in ('manager', 'member')),
  permission text not null,
  allowed    boolean not null,
  primary key (role, permission)
);
alter table role_permissions enable row level security;   -- no policies: only the server can use it

-- Project managers (by job title) start as managers; everyone else as members.
update employees set access_role = 'manager' where access_role = 'member' and lower(btrim(role)) = 'project manager';
-- The first admin.
update employees set access_role = 'admin' where lower(email) = 'apoorv.dwivedi@digirockettechnologies.com';
