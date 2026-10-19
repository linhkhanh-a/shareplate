-- Feedback from inside the app: ideas, problems and questions. People see
-- their own; the app's owners (listed in app_admins) see everything and
-- mark items done.

create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
-- Nobody manages this list through the app; it's set in the Supabase SQL editor.
revoke all on public.app_admins from anon, authenticated;

create function public.is_app_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid())
$$;
revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  kind text not null check (kind in ('idea', 'problem', 'question')),
  message text not null check (length(btrim(message)) between 3 and 4000),
  -- Whether they're happy to be contacted about it (by their sign-in email).
  contact_ok boolean not null default false,
  -- Where it was sent from and which version, to help reproduce problems.
  page text check (page is null or length(page) <= 300),
  app_version text check (app_version is null or length(app_version) <= 40),
  user_agent text check (user_agent is null or length(user_agent) <= 400),
  status text not null default 'new' check (status in ('new', 'done')),
  created_at timestamptz not null default now()
);

create index feedback_created_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

revoke all on public.feedback from anon;
revoke delete on public.feedback from authenticated;
grant select, insert, update on public.feedback to authenticated;

create policy "feedback: send your own" on public.feedback
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'new');

create policy "feedback: see your own, admins see all" on public.feedback
  for select to authenticated
  using (user_id = auth.uid() or public.is_app_admin());

create policy "feedback: admins mark done" on public.feedback
  for update to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());

-- The sender's email, for admins, when they said it's OK to contact them.
create function public.feedback_inbox()
returns table (
  id uuid,
  kind text,
  message text,
  contact_email text,
  page text,
  app_version text,
  user_agent text,
  status text,
  created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select f.id, f.kind, f.message,
         case when f.contact_ok then p.email end,
         f.page, f.app_version, f.user_agent, f.status, f.created_at
  from public.feedback f
  left join public.profiles p on p.id = f.user_id
  where public.is_app_admin()
  order by f.created_at desc
  limit 500
$$;
revoke execute on function public.feedback_inbox() from public, anon;
grant execute on function public.feedback_inbox() to authenticated;
