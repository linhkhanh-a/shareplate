-- Phase 9: deleting your account, and a "what's new" feed for each trip.

-- ===========================================================================
-- 1. Deleting your account
-- ===========================================================================

-- A trip outlives its creator: the creator column empties instead of
-- blocking the account deletion.
alter table public.groups alter column created_by drop not null;
alter table public.groups drop constraint groups_created_by_fkey;
alter table public.groups
  add constraint groups_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;

-- What stops the caller from deleting their account right now, trip by trip.
-- reason: 'balance' (amount_cents is their balance) or 'last_admin'.
create function public.account_deletion_blockers()
returns table (group_id uuid, trip_name text, reason text, amount_cents bigint)
language sql stable security definer set search_path = public
as $$
  select g.id, g.name, 'balance', public._member_balance_cents(m.id)
  from public.group_members m
  join public.groups g on g.id = m.group_id
  where m.user_id = auth.uid() and m.left_at is null
    and public._member_balance_cents(m.id) <> 0
    -- Trips only they can see are deleted with the account, so they don't block it.
    and exists (
      select 1 from public.group_members o
      where o.group_id = g.id and o.user_id is not null and o.user_id <> auth.uid() and o.left_at is null
    )
  union all
  select g.id, g.name, 'last_admin', 0
  from public.group_members m
  join public.groups g on g.id = m.group_id
  where m.user_id = auth.uid() and m.left_at is null and m.role = 'admin'
    and not exists (
      select 1 from public.group_members a
      where a.group_id = g.id and a.id <> m.id and a.role = 'admin' and a.left_at is null and a.user_id is not null
    )
    and exists (
      select 1 from public.group_members o
      where o.group_id = g.id and o.user_id is not null and o.user_id <> auth.uid() and o.left_at is null
    )
$$;

revoke execute on function public.account_deletion_blockers() from public, anon, authenticated;
grant execute on function public.account_deletion_blockers() to authenticated;

-- Deletes the caller's account in one step:
--   * trips nobody else signed in can see (like quick splits) are deleted;
--   * in shared trips they become a former member, so bills keep their name;
--   * their receipt photos stay with the trip;
--   * their sign-in is removed.
-- Refuses (and changes nothing) while they owe or are owed money in a shared
-- trip, or are its only admin.
create function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_blocker record;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN: sign in first' using errcode = 'P0001';
  end if;

  select * into v_blocker from public.account_deletion_blockers() limit 1;
  if found then
    if v_blocker.reason = 'balance' then
      raise exception 'ACCOUNT_HAS_BALANCE: settle up in "%" first', v_blocker.trip_name using errcode = 'P0001';
    end if;
    raise exception 'ACCOUNT_LAST_ADMIN: make someone else an admin of "%" first', v_blocker.trip_name
      using errcode = 'P0001';
  end if;

  -- Trips where they're the only person signed in.
  delete from public.groups g
  where exists (
      select 1 from public.group_members m where m.group_id = g.id and m.user_id = v_uid and m.left_at is null
    )
    and not exists (
      select 1 from public.group_members o
      where o.group_id = g.id and o.user_id is not null and o.user_id <> v_uid and o.left_at is null
    );

  -- Storage refuses to delete a user who still owns files; the photos belong to the trip.
  begin
    update storage.objects set owner = null, owner_id = null where owner = v_uid or owner_id = v_uid::text;
  exception when insufficient_privilege or undefined_column then
    null;
  end;

  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- ===========================================================================
-- 2. What's new in each trip
-- ===========================================================================

create table public.trip_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- Who did it: their member row in this trip (null if unknown).
  actor_member_id uuid references public.group_members (id) on delete set null,
  kind text not null check (kind in (
    'bill_added', 'bill_edited', 'bill_deleted',
    'payment_added', 'payment_deleted',
    'member_joined', 'guest_added', 'member_left',
    'activity_added', 'activity_deleted'
  )),
  -- What it was about: a bill's title, a person's name, an activity…
  subject text,
  amount_cents bigint,
  -- Extra details, e.g. who paid whom.
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index trip_events_group_idx on public.trip_events (group_id, created_at desc);

alter table public.trip_events enable row level security;
create policy "trip_events: members read" on public.trip_events
  for select to authenticated using (public.is_group_member(group_id));
-- Only the database writes events.
revoke insert, update, delete on public.trip_events from anon, authenticated;

-- When each person last looked at each trip. Kept apart from group_members so
-- looking at a trip doesn't count as a change everyone gets live.
create table public.trip_reads (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

alter table public.trip_reads enable row level security;
create policy "trip_reads: your own" on public.trip_reads
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_group_member(group_id));

-- The caller's member row in a trip, for "who did it".
create function public._my_member_id(p_group uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.group_members where group_id = p_group and user_id = auth.uid() limit 1
$$;
revoke execute on function public._my_member_id(uuid) from public, anon, authenticated;

create function public._log_trip_event(p_group uuid, p_kind text, p_subject text, p_amount bigint, p_details jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  -- The trip itself is being deleted: nothing to tell anyone.
  if not exists (select 1 from public.groups where id = p_group) then
    return;
  end if;
  insert into public.trip_events (group_id, actor_member_id, kind, subject, amount_cents, details)
  values (p_group, public._my_member_id(p_group), p_kind, p_subject, p_amount, coalesce(p_details, '{}'));
end;
$$;
revoke execute on function public._log_trip_event(uuid, text, text, bigint, jsonb) from public, anon, authenticated;

create function public.log_bill_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public._log_trip_event(new.group_id, 'bill_added', coalesce(new.title, new.vendor, new.category), new.total_cents,
      jsonb_build_object('bill_id', new.id, 'payer', new.paid_by_member_id));
  elsif tg_op = 'UPDATE' then
    -- Only real edits (the version changes), not pinning to the plan.
    if new.version <> old.version then
      perform public._log_trip_event(new.group_id, 'bill_edited', coalesce(new.title, new.vendor, new.category), new.total_cents,
        jsonb_build_object('bill_id', new.id));
    end if;
  else
    perform public._log_trip_event(old.group_id, 'bill_deleted', coalesce(old.title, old.vendor, old.category), old.total_cents,
      '{}');
  end if;
  return null;
end;
$$;
revoke execute on function public.log_bill_event() from public, anon, authenticated;
create trigger bills_events after insert or update or delete on public.bills
  for each row execute function public.log_bill_event();

create function public.log_payment_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v public.settlements;
begin
  v := case when tg_op = 'DELETE' then old else new end;
  perform public._log_trip_event(v.group_id, case when tg_op = 'DELETE' then 'payment_deleted' else 'payment_added' end,
    null, v.amount_cents, jsonb_build_object('from', v.from_member_id, 'to', v.to_member_id));
  return null;
end;
$$;
revoke execute on function public.log_payment_event() from public, anon, authenticated;
create trigger settlements_events after insert or delete on public.settlements
  for each row execute function public.log_payment_event();

create function public.log_member_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public._log_trip_event(new.group_id, case when new.user_id is null then 'guest_added' else 'member_joined' end,
      new.display_name, null, jsonb_build_object('member', new.id));
  elsif old.left_at is null and new.left_at is not null then
    perform public._log_trip_event(new.group_id, 'member_left', new.display_name, null, jsonb_build_object('member', new.id));
  elsif old.left_at is not null and new.left_at is null then
    perform public._log_trip_event(new.group_id, 'member_joined', new.display_name, null, jsonb_build_object('member', new.id));
  end if;
  return null;
end;
$$;
revoke execute on function public.log_member_event() from public, anon, authenticated;
create trigger group_members_events after insert or update on public.group_members
  for each row execute function public.log_member_event();

create function public.log_activity_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public._log_trip_event(new.group_id, 'activity_added', new.title, new.proposed_budget_cents,
      jsonb_build_object('activity_id', new.id, 'day', new.day_number));
  else
    perform public._log_trip_event(old.group_id, 'activity_deleted', old.title, null, jsonb_build_object('day', old.day_number));
  end if;
  return null;
end;
$$;
revoke execute on function public.log_activity_event() from public, anon, authenticated;
create trigger itinerary_items_events after insert or delete on public.itinerary_items
  for each row execute function public.log_activity_event();

-- How many things changed in each of the caller's trips since they last looked,
-- not counting their own changes.
create function public.my_unread_counts()
returns table (group_id uuid, unread bigint)
language sql stable security definer set search_path = public
as $$
  select m.group_id, count(e.id)
  from public.group_members m
  left join public.trip_reads r on r.group_id = m.group_id and r.user_id = auth.uid()
  left join public.trip_events e on e.group_id = m.group_id
    and e.created_at > coalesce(r.seen_at, m.joined_at)
    and e.actor_member_id is distinct from m.id
  where m.user_id = auth.uid() and m.left_at is null
  group by m.group_id
$$;
revoke execute on function public.my_unread_counts() from public, anon, authenticated;
grant execute on function public.my_unread_counts() to authenticated;
