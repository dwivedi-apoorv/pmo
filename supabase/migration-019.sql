-- LOCK DOWN. Run this LAST, after you have signed in successfully with the new login.
--
-- Until now every table allowed anyone holding the public (anon) key to read it. The app now reads the
-- database only from the server, after checking you are logged in, so that public access is removed.
-- Row-level security stays on with no policies, which means the public key can neither read nor write
-- anything. The server (service-role key) is unaffected.
--
-- Do NOT run this before the new version of the app is deployed and login works: the old version of the
-- app reads with the public key and would stop working.
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
     where schemaname = 'public' and policyname like 'public read %'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
