-- Phase 2: onboarding, invite links, joining and leaving trips.

-- ---------------------------------------------------------------------------
-- Deleting a trip must also delete its bills and payments. These links now
-- clean up with the trip. People are never hard-deleted while they have any
-- bills or payments: they leave the trip instead (see the guard below).
-- ---------------------------------------------------------------------------

alter table public.bills drop constraint bills_group_id_paid_by_member_id_fkey,
  add constraint bills_group_id_paid_by_member_id_fkey
    foreign key (group_id, paid_by_member_id) references public.group_members (group_id, id) on delete cascade;
alter table public.bill_item_mappings drop constraint bill_item_mappings_group_member_id_fkey,
  add constraint bill_item_mappings_group_member_id_fkey
    foreign key (group_member_id) references public.group_members (id) on delete cascade;
alter table public.bill_participants drop constraint bill_participants_group_member_id_fkey,
  add constraint bill_participants_group_member_id_fkey
    foreign key (group_member_id) references public.group_members (id) on delete cascade;
alter table public.settlements drop constraint settlements_group_id_from_member_id_fkey,
  add constraint settlements_group_id_from_member_id_fkey
    foreign key (group_id, from_member_id) references public.group_members (group_id, id) on delete cascade;
alter table public.settlements drop constraint settlements_group_id_to_member_id_fkey,
  add constraint settlements_group_id_to_member_id_fkey
    foreign key (group_id, to_member_id) references public.group_members (group_id, id) on delete cascade;

create or replace function public.enforce_member_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_other_admins int;
  v_balance bigint;
begin
  -- Deleting the whole trip removes its members too; nothing to protect then.
  if tg_op = 'DELETE' and not exists (select 1 from public.groups where id = old.group_id) then
    return old;
  end if;

  select count(*) into v_other_admins
  from public.group_members
  where group_id = old.group_id and id <> old.id
    and role = 'admin' and left_at is null and user_id is not null;

  -- Hard-deleting a person from a trip: only allowed if they never appear on a bill or payment.
  if tg_op = 'DELETE' then
    if exists (select 1 from public.bills where paid_by_member_id = old.id)
       or exists (select 1 from public.bill_participants where group_member_id = old.id)
       or exists (select 1 from public.bill_item_mappings where group_member_id = old.id)
       or exists (select 1 from public.settlements where from_member_id = old.id or to_member_id = old.id) then
      raise exception 'HAS_HISTORY: % is on bills or payments, so they can leave the trip but not be deleted',
        old.display_name using errcode = 'P0001';
    end if;
    if old.role = 'admin' and old.left_at is null and v_other_admins = 0 then
      raise exception 'LAST_ADMIN: the group needs another admin first'
        using errcode = 'P0001', hint = 'Make someone else an admin before removing the last admin.';
    end if;
    return old;
  end if;

  -- Account deleted (user_id cleared by the foreign key) or leaving the trip.
  if (old.user_id is not null and new.user_id is null)
     or (old.left_at is null and new.left_at is not null) then
    v_balance := public._member_balance_cents(old.id);
    if v_balance <> 0 then
      raise exception 'UNSETTLED_BALANCE: % still has a balance of % cents', old.display_name, v_balance
        using errcode = 'P0001', hint = 'Settle up before leaving the group or deleting the account.';
    end if;
    if old.role = 'admin' and old.left_at is null and v_other_admins = 0 then
      raise exception 'LAST_ADMIN: the group needs another admin first'
        using errcode = 'P0001', hint = 'Choose a new admin before leaving or deleting the account.';
    end if;
    new.role := 'member';
    new.left_at := coalesce(new.left_at, now());
    return new;
  end if;

  -- Demoting the last admin.
  if old.role = 'admin' and new.role <> 'admin' and old.left_at is null and v_other_admins = 0 then
    raise exception 'LAST_ADMIN: the group needs another admin first'
      using errcode = 'P0001', hint = 'Make someone else an admin before stepping down.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_member_rules() from public, anon, authenticated;

-- Set once the person finishes (or skips) the first-time profile setup.
alter table public.profiles add column onboarded_at timestamptz;

-- ---------------------------------------------------------------------------
-- Invite links: one active link per trip, which admins can reset.
-- ---------------------------------------------------------------------------

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- 32 random hex characters (122 bits of randomness).
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz
);

create index group_invites_group_idx on public.group_invites (group_id);

alter table public.group_invites enable row level security;

create policy "group_invites: members read" on public.group_invites
  for select to authenticated
  using (public.is_group_member(group_id));

-- Admins manage links through the functions below, never directly.
grant select on public.group_invites to authenticated;

-- Returns the trip's current invite token, creating one if needed. Admins only.
create function public.get_or_create_invite(p_group_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_token text;
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'NOT_ADMIN: only trip admins can invite people' using errcode = 'P0001';
  end if;

  select token into v_token
  from public.group_invites
  where group_id = p_group_id and revoked_at is null and expires_at > now()
  order by created_at desc
  limit 1;

  if v_token is null then
    insert into public.group_invites (group_id) values (p_group_id) returning token into v_token;
  end if;
  return v_token;
end;
$$;

-- Turns off the current link and returns a fresh one. Admins only.
create function public.reset_invite(p_group_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'NOT_ADMIN: only trip admins can reset the invite link' using errcode = 'P0001';
  end if;
  update public.group_invites set revoked_at = now()
  where group_id = p_group_id and revoked_at is null;
  return public.get_or_create_invite(p_group_id);
end;
$$;

-- What someone sees before joining: trip name, who invited them, how many people.
create function public.preview_invite(p_token text)
returns table (group_id uuid, group_name text, member_count bigint, invited_by text, already_member boolean)
language sql stable security definer set search_path = public
as $$
  select
    g.id,
    g.name,
    (select count(*) from public.group_members m where m.group_id = g.id and m.left_at is null),
    coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)),
    public.is_group_member(g.id)
  from public.group_invites i
  join public.groups g on g.id = i.group_id
  left join public.profiles p on p.id = i.created_by
  where i.token = p_token and i.revoked_at is null and i.expires_at > now();
$$;

-- Joins the trip behind an invite link. Rejoining after leaving restores the
-- same membership, so past bills stay attached to the same person.
create function public.join_group(p_token text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_group_id uuid;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN: sign in to join a trip' using errcode = 'P0001';
  end if;

  select i.group_id into v_group_id
  from public.group_invites i
  where i.token = p_token and i.revoked_at is null and i.expires_at > now();
  if v_group_id is null then
    raise exception 'INVITE_INVALID: this invite link has expired or was reset' using errcode = 'P0001';
  end if;

  select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1), 'New member')
  into v_name from public.profiles where id = auth.uid();

  insert into public.group_members (group_id, user_id, display_name)
  values (v_group_id, auth.uid(), v_name)
  on conflict (group_id, user_id) do update set left_at = null;

  return v_group_id;
end;
$$;

-- Leaves a trip. The membership rules still apply: nobody leaves owing or
-- being owed money, and the last admin must hand over first.
create function public.leave_group(p_group_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.group_members set left_at = now()
  where group_id = p_group_id and user_id = auth.uid() and left_at is null;
  if not found then
    raise exception 'NOT_MEMBER: you are not in this trip' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.get_or_create_invite(uuid) from public, anon, authenticated;
revoke execute on function public.reset_invite(uuid) from public, anon, authenticated;
revoke execute on function public.preview_invite(text) from public, anon, authenticated;
revoke execute on function public.join_group(text) from public, anon, authenticated;
revoke execute on function public.leave_group(uuid) from public, anon, authenticated;

grant execute on function public.get_or_create_invite(uuid) to authenticated;
grant execute on function public.reset_invite(uuid) to authenticated;
grant execute on function public.preview_invite(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;

-- When someone changes their name, show the new name in every trip they're in.
create function public.sync_member_names()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.full_name is distinct from old.full_name and nullif(trim(new.full_name), '') is not null then
    update public.group_members set display_name = left(trim(new.full_name), 60)
    where user_id = new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_member_names() from public, anon, authenticated;

create trigger profiles_sync_member_names
  after update of full_name on public.profiles
  for each row execute function public.sync_member_names();
