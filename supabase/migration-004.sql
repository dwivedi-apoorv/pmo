-- Adds the 3 project managers. Safe to run twice: emails that already exist are skipped.
insert into employees (name, email, role) values
  ('Sidharth', 'sidharth@digirockettechnologies.com', 'Project Manager'),
  ('Ishika',   'ishika@digirockettechnologies.com',   'Project Manager'),
  ('Ankit',    'ankit@digirockettechnologies.com',    'Project Manager')
on conflict (email) do nothing;
