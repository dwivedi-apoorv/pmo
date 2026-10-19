-- Login with a one-time code (OTP) sent to the employee's email.
--  * only an ACTIVE employee's email can get a code
--  * the 6-digit code itself is never stored, only a keyed hash of it (computed by the app)
--  * a code works once, for 10 minutes, and gets 5 wrong tries
--  * limits: one code per email every 30 seconds, 5 per hour per email, 20 per hour per network address
--  * row-level security is on with NO policies, so nothing but the server can read or write this table

create table if not exists login_codes (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,              -- lower-case
  code_hash  text not null,
  ip         text,
  expires_at timestamptz not null,
  attempts   int  not null default 0,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists login_codes_email_idx on login_codes (email, created_at desc);
create index if not exists login_codes_ip_idx    on login_codes (ip, created_at desc);

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
