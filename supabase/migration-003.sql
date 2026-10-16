-- Adds the website column. Run this if you already created the tables.
-- Existing projects keep working (website stays empty until you fill it in).
alter table projects add column if not exists website text;
