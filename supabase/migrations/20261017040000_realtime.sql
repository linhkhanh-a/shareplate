-- Phase 4: live updates.
--
-- 1. Every change inside a trip (bills, shares, payments, people) bumps
--    groups.activity_at. Phones subscribe to that one row per trip, so they
--    hear about inserts, edits AND deletes, and row level security makes sure
--    only trip members are told.
-- 2. Both live channels per trip are private: "trip-data:<id>" carries the
--    data changes and "trip:<id>" carries presence, e.g. "Minh is editing this
--    bill". Only trip members can join either one.

alter table public.groups add column activity_at timestamptz not null default now();

create function public.touch_trip_activity()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_group uuid;
begin
  if tg_op = 'DELETE' then
    v_group := old.group_id;
  else
    v_group := new.group_id;
  end if;
  update public.groups set activity_at = now() where id = v_group;
  return null;
end;
$$;

revoke execute on function public.touch_trip_activity() from public, anon, authenticated;

-- save_bill always touches the bills row (insert, or update with a version bump),
-- and deleting a bill removes its shares, so shares don't need their own trigger.
create trigger bills_activity after insert or update or delete on public.bills
  for each row execute function public.touch_trip_activity();
create trigger settlements_activity after insert or update or delete on public.settlements
  for each row execute function public.touch_trip_activity();
create trigger group_members_activity after insert or update or delete on public.group_members
  for each row execute function public.touch_trip_activity();

-- Send changes to the groups table over Supabase Realtime (the publication
-- only exists on Supabase itself, not in the test database).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'groups'
     ) then
    alter publication supabase_realtime add table public.groups;
  end if;
end;
$$;

-- Can the signed-in user use this live channel? Topics look like "trip:<uuid>"
-- (presence) or "trip-data:<uuid>" (data changes).
create function public.can_use_trip_channel(p_topic text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_topic is null
     or p_topic !~ '^trip(-data)?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_group_member(split_part(p_topic, ':', 2)::uuid);
end;
$$;

revoke execute on function public.can_use_trip_channel(text) from public, anon, authenticated;
grant execute on function public.can_use_trip_channel(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $policy$
      create policy "trip members can listen on their trip channel"
      on realtime.messages for select to authenticated
      using (public.can_use_trip_channel((select realtime.topic())))
    $policy$;
    execute $policy$
      create policy "trip members can share presence on their trip channel"
      on realtime.messages for insert to authenticated
      with check (
        realtime.messages.extension in ('broadcast', 'presence')
        and public.can_use_trip_channel((select realtime.topic()))
      )
    $policy$;
  end if;
end;
$$;
