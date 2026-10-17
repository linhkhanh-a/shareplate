-- A tiny stand-in for the parts of Supabase the migration relies on, so the
-- schema can be tested in an in-memory Postgres (PGlite) without a Supabase
-- account. Real Supabase already provides all of this.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Supabase reads the signed-in user's id from the request's JWT.
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Like a real Supabase project: anything created in public is granted to the
-- API roles by default. The migration must lock things down itself.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
