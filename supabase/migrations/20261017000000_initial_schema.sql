-- Shareplate: initial schema
--
-- Conventions
--   * Money is always an integer number of cents (bigint). Never numeric dollars.
--   * People inside a group are `group_members`. A member is either a registered
--     user (user_id set) or a guest (user_id null). Payers, debtors and
--     payments all point at group_members, so guests can pay and owe too.
--   * Bills are never locked. Editing a bill simply changes balances.
--   * Zelle is only stored as text (email or phone) for people to copy.
--     The app never moves money.

-- ---------------------------------------------------------------------------
-- Profiles (one per signed-in user, created automatically on sign-up)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  zelle_identifier text check (zelle_identifier is null or length(zelle_identifier) <= 254),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.zelle_identifier is
  'Email or phone number the person uses for Zelle. Shown to group mates on the Settle Up screen.';

-- ---------------------------------------------------------------------------
-- Groups (a trip)
-- ---------------------------------------------------------------------------

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  -- 'registered': everyone signs in. 'quick': one host tracks guests.
  mode text not null default 'registered' check (mode in ('registered', 'quick')),
  currency char(3) not null default 'USD',
  start_date date,
  end_date date,
  total_budget_cents bigint not null default 0 check (total_budget_cents >= 0),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- ---------------------------------------------------------------------------
-- Group members (registered users and guests)
-- ---------------------------------------------------------------------------

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- Null for guests, and for people who deleted their account (history is kept).
  user_id uuid references public.profiles (id) on delete set null,
  display_name text not null check (length(trim(display_name)) between 1 and 60),
  role text not null default 'member' check (role in ('admin', 'member')),
  daily_allowance_cents bigint not null default 0 check (daily_allowance_cents >= 0),
  joined_at timestamptz not null default now(),
  -- Set when someone leaves. Their past bills stay in the ledger.
  left_at timestamptz,
  unique (group_id, user_id),
  -- Lets other tables require "a member of the same group".
  unique (group_id, id),
  -- Guests can never be admins.
  check (user_id is not null or role = 'member')
);

create index group_members_user_idx on public.group_members (user_id);

-- ---------------------------------------------------------------------------
-- Itinerary ("Bullet Plan")
-- ---------------------------------------------------------------------------

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  day_number int not null check (day_number >= 1),
  -- Sort order within the day (lets people drag items around).
  position int not null default 0,
  start_time time,
  end_time time,
  title text not null check (length(trim(title)) between 1 and 200),
  location text,
  notes text,
  proposed_budget_cents bigint not null default 0 check (proposed_budget_cents >= 0),
  -- Bumped on every edit; used to detect two people editing at once.
  version int not null default 1,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, id)
);

create index itinerary_items_group_day_idx on public.itinerary_items (group_id, day_number, position);

-- ---------------------------------------------------------------------------
-- Bills
-- ---------------------------------------------------------------------------

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  paid_by_member_id uuid not null,
  itinerary_item_id uuid,
  title text,
  vendor text,
  category text not null default 'General',
  -- How the bill was split. 'itemized' = per item (scanned or typed).
  split_mode text not null check (split_mode in ('itemized', 'equal', 'percent', 'exact')),
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  tip_cents bigint not null default 0 check (tip_cents >= 0),
  total_cents bigint not null,
  bill_image_path text,
  bill_date date not null default current_date,
  version int not null default 1,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount_cents <= subtotal_cents),
  check (total_cents = subtotal_cents - discount_cents + tax_cents + tip_cents),
  foreign key (group_id, paid_by_member_id) references public.group_members (group_id, id),
  -- Pinning a bill to an itinerary item of the same trip. If the item is deleted, the bill stays.
  foreign key (group_id, itinerary_item_id) references public.itinerary_items (group_id, id)
    on delete set null (itinerary_item_id)
);

create index bills_group_date_idx on public.bills (group_id, bill_date desc);
create index bills_itinerary_idx on public.bills (itinerary_item_id);
create index bills_payer_idx on public.bills (paid_by_member_id);

create table public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  name text not null,
  price_cents bigint not null check (price_cents >= 0),
  position int not null default 0
);

create index bill_items_bill_idx on public.bill_items (bill_id);

-- Who had which item (itemized bills). A shared dish has several rows.
create table public.bill_item_mappings (
  bill_item_id uuid not null references public.bill_items (id) on delete cascade,
  group_member_id uuid not null references public.group_members (id),
  primary key (bill_item_id, group_member_id)
);

create index bill_item_mappings_member_idx on public.bill_item_mappings (group_member_id);

-- What each person owes for a bill (the money engine's output), plus the
-- number they typed for percent / exact splits.
create table public.bill_participants (
  bill_id uuid not null references public.bills (id) on delete cascade,
  group_member_id uuid not null references public.group_members (id),
  -- percent split: basis points (25% = 2500). exact split: cents. Otherwise null.
  share_input bigint check (share_input is null or share_input >= 0),
  items_cents bigint not null default 0 check (items_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  tip_cents bigint not null default 0 check (tip_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  primary key (bill_id, group_member_id)
);

create index bill_participants_member_idx on public.bill_participants (group_member_id);

-- ---------------------------------------------------------------------------
-- Settlements (recorded payments: "An paid Linh $20")
-- ---------------------------------------------------------------------------

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_member_id uuid not null,
  to_member_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null default 'zelle' check (method in ('zelle', 'cash', 'other')),
  note text,
  settled_on date not null default current_date,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_member_id <> to_member_id),
  foreign key (group_id, from_member_id) references public.group_members (group_id, id),
  foreign key (group_id, to_member_id) references public.group_members (group_id, id)
);

create index settlements_group_idx on public.settlements (group_id, settled_on desc);
create index settlements_from_idx on public.settlements (from_member_id);
create index settlements_to_idx on public.settlements (to_member_id);

-- ===========================================================================
-- Helper functions
-- ===========================================================================

-- Is the signed-in user an active member of this group?
create function public.is_group_member(p_group_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid() and left_at is null
  );
$$;

create function public.is_group_admin(p_group_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid() and left_at is null and role = 'admin'
  );
$$;

-- Do the signed-in user and this person share an active group? (to see names and Zelle)
create function public.shares_group_with(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.group_members me
    join public.group_members them on them.group_id = me.group_id
    where me.user_id = auth.uid() and me.left_at is null
      and them.user_id = p_user_id and them.left_at is null
  );
$$;

-- Net balance of one member in cents. Positive = the group owes them.
-- Internal: used by triggers. Apps read the member_balances view instead.
create function public._member_balance_cents(p_member_id uuid)
returns bigint
language sql stable security definer set search_path = public
as $$
  select
      coalesce((select sum(total_cents) from public.bills where paid_by_member_id = p_member_id), 0)
    - coalesce((select sum(amount_cents) from public.bill_participants where group_member_id = p_member_id), 0)
    + coalesce((select sum(amount_cents) from public.settlements where from_member_id = p_member_id), 0)
    - coalesce((select sum(amount_cents) from public.settlements where to_member_id = p_member_id), 0);
$$;

revoke execute on function public._member_balance_cents(uuid) from public;

-- Balances for every member the viewer can see (row level security applies).
create view public.member_balances
with (security_invoker = true)
as
select
  gm.id as group_member_id,
  gm.group_id,
  gm.display_name,
  coalesce(paid.total, 0) - coalesce(owed.total, 0)
    + coalesce(sent.total, 0) - coalesce(received.total, 0) as balance_cents
from public.group_members gm
left join lateral (
  select sum(b.total_cents) as total from public.bills b where b.paid_by_member_id = gm.id
) paid on true
left join lateral (
  select sum(bp.amount_cents) as total from public.bill_participants bp where bp.group_member_id = gm.id
) owed on true
left join lateral (
  select sum(s.amount_cents) as total from public.settlements s where s.from_member_id = gm.id
) sent on true
left join lateral (
  select sum(s.amount_cents) as total from public.settlements s where s.to_member_id = gm.id
) received on true;

-- ===========================================================================
-- Triggers
-- ===========================================================================

-- Keep updated_at current.
create function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Bump version on every edit (for "someone else changed this" detection).
create function public.bump_version()
returns trigger language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger groups_touch before update on public.groups
  for each row execute function public.touch_updated_at();
create trigger bills_version before update on public.bills
  for each row execute function public.bump_version();
create trigger itinerary_items_version before update on public.itinerary_items
  for each row execute function public.bump_version();

-- Create a profile when someone signs up, and keep their email in sync.
create function public.handle_auth_user_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (id, email, full_name, avatar_url)
    values (
      new.id,
      coalesce(new.email, ''),
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
      new.raw_user_meta_data ->> 'avatar_url'
    );
  elsif new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_change
  after insert or update of email on auth.users
  for each row execute function public.handle_auth_user_change();

-- Whoever creates a group becomes its first admin.
create function public.add_group_creator_as_admin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, display_name, role)
  select new.id, p.id, coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1), 'Me'), 'admin'
  from public.profiles p
  where p.id = new.created_by;
  return new;
end;
$$;

create trigger groups_add_creator
  after insert on public.groups
  for each row execute function public.add_group_creator_as_admin();

-- Membership rules:
--   * A group always keeps at least one active admin.
--   * Nobody can leave, be removed, or delete their account with a balance other than $0.00.
create function public.enforce_member_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_other_admins int;
  v_balance bigint;
  v_member public.group_members;
begin
  v_member := old;

  -- Deleting the whole group removes its members too; nothing to protect then.
  if tg_op = 'DELETE' and not exists (select 1 from public.groups where id = old.group_id) then
    return old;
  end if;

  select count(*) into v_other_admins
  from public.group_members
  where group_id = v_member.group_id and id <> v_member.id
    and role = 'admin' and left_at is null and user_id is not null;

  -- Removed from the group.
  if tg_op = 'DELETE' then
    v_balance := public._member_balance_cents(old.id);
    if v_balance <> 0 then
      raise exception 'UNSETTLED_BALANCE: % still has a balance of % cents', old.display_name, v_balance
        using errcode = 'P0001', hint = 'Settle up before removing this person.';
    end if;
    if old.role = 'admin' and old.left_at is null and v_other_admins = 0 then
      raise exception 'LAST_ADMIN: the group needs another admin first'
        using errcode = 'P0001', hint = 'Make someone else an admin before removing the last admin.';
    end if;
    return old;
  end if;

  -- Account deleted (user_id cleared by the foreign key) or leaving the group.
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

create trigger group_members_rules
  before update or delete on public.group_members
  for each row execute function public.enforce_member_rules();

-- Bill integrity, checked at the end of each transaction (so a bill and its
-- participants can be saved together):
--   * everyone's shares add up to exactly the bill total;
--   * percent splits add up to 100%, exact splits match what was typed;
--   * participants and item eaters belong to the bill's group.
create function public.check_bill_integrity(p_bill_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bill public.bills;
  v_sum bigint;
  v_bp_sum bigint;
begin
  select * into v_bill from public.bills where id = p_bill_id;
  if not found then
    return; -- bill was deleted
  end if;

  select coalesce(sum(amount_cents), 0) into v_sum
  from public.bill_participants where bill_id = p_bill_id;
  if v_sum <> v_bill.total_cents then
    raise exception 'SHARES_NOT_TOTAL: shares add up to % cents but the bill total is % cents',
      v_sum, v_bill.total_cents using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.bill_participants bp
    join public.group_members gm on gm.id = bp.group_member_id
    where bp.bill_id = p_bill_id and gm.group_id <> v_bill.group_id
  ) or exists (
    select 1 from public.bill_items bi
    join public.bill_item_mappings m on m.bill_item_id = bi.id
    join public.group_members gm on gm.id = m.group_member_id
    where bi.bill_id = p_bill_id and gm.group_id <> v_bill.group_id
  ) then
    raise exception 'WRONG_GROUP: everyone on a bill must be in the same trip' using errcode = 'P0001';
  end if;

  if v_bill.split_mode = 'percent' then
    select coalesce(sum(share_input), 0) into v_bp_sum
    from public.bill_participants where bill_id = p_bill_id;
    if v_bp_sum <> 10000 or exists (
      select 1 from public.bill_participants where bill_id = p_bill_id and share_input is null
    ) then
      raise exception 'PERCENT_NOT_100: percentages must add up to 100%%' using errcode = 'P0001';
    end if;
  elsif v_bill.split_mode = 'exact' then
    if exists (
      select 1 from public.bill_participants
      where bill_id = p_bill_id and share_input is distinct from amount_cents
    ) then
      raise exception 'EXACT_MISMATCH: exact amounts must match what each person owes' using errcode = 'P0001';
    end if;
  end if;
end;
$$;

revoke execute on function public.check_bill_integrity(uuid) from public;

create function public.check_bill_integrity_trigger()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'bills' then
    perform public.check_bill_integrity(new.id);
  elsif tg_table_name = 'bill_participants' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform public.check_bill_integrity(old.bill_id);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform public.check_bill_integrity(new.bill_id);
    end if;
  elsif tg_table_name = 'bill_item_mappings' then
    perform public.check_bill_integrity(
      (select bill_id from public.bill_items where id = coalesce(new.bill_item_id, old.bill_item_id))
    );
  end if;
  return null;
end;
$$;

create constraint trigger bills_integrity
  after insert or update on public.bills
  deferrable initially deferred
  for each row execute function public.check_bill_integrity_trigger();

create constraint trigger bill_participants_integrity
  after insert or update or delete on public.bill_participants
  deferrable initially deferred
  for each row execute function public.check_bill_integrity_trigger();

create constraint trigger bill_item_mappings_integrity
  after insert or update on public.bill_item_mappings
  deferrable initially deferred
  for each row execute function public.check_bill_integrity_trigger();

-- ===========================================================================
-- Row level security: people only ever see trips they belong to.
-- ===========================================================================

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.bill_item_mappings enable row level security;
alter table public.bill_participants enable row level security;
alter table public.settlements enable row level security;

-- Profiles: your own, plus people you share a trip with (names and Zelle).
create policy "profiles: read self and trip mates" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));
create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Groups
create policy "groups: members read" on public.groups
  for select to authenticated
  using (public.is_group_member(id) or created_by = auth.uid());
create policy "groups: anyone signed in can create" on public.groups
  for insert to authenticated
  with check (created_by = auth.uid());
create policy "groups: admins update" on public.groups
  for update to authenticated
  using (public.is_group_admin(id)) with check (public.is_group_admin(id));
create policy "groups: admins delete" on public.groups
  for delete to authenticated
  using (public.is_group_admin(id));

-- Group members: members see each other; admins manage the list.
create policy "group_members: members read" on public.group_members
  for select to authenticated
  using (public.is_group_member(group_id));
create policy "group_members: admins add" on public.group_members
  for insert to authenticated
  with check (public.is_group_admin(group_id));
create policy "group_members: admins update" on public.group_members
  for update to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));
create policy "group_members: admins remove" on public.group_members
  for delete to authenticated
  using (public.is_group_admin(group_id));

-- Trip content: every active member can read and edit (it is a shared trip).
create policy "itinerary: members all" on public.itinerary_items
  for all to authenticated
  using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));

create policy "bills: members all" on public.bills
  for all to authenticated
  using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));

create policy "bill_items: members all" on public.bill_items
  for all to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_id and public.is_group_member(b.group_id)))
  with check (exists (select 1 from public.bills b where b.id = bill_id and public.is_group_member(b.group_id)));

create policy "bill_item_mappings: members all" on public.bill_item_mappings
  for all to authenticated
  using (exists (
    select 1 from public.bill_items bi join public.bills b on b.id = bi.bill_id
    where bi.id = bill_item_id and public.is_group_member(b.group_id)
  ))
  with check (exists (
    select 1 from public.bill_items bi join public.bills b on b.id = bi.bill_id
    where bi.id = bill_item_id and public.is_group_member(b.group_id)
  ));

create policy "bill_participants: members all" on public.bill_participants
  for all to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_id and public.is_group_member(b.group_id)))
  with check (exists (select 1 from public.bills b where b.id = bill_id and public.is_group_member(b.group_id)));

create policy "settlements: members all" on public.settlements
  for all to authenticated
  using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
