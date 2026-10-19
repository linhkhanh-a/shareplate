-- Two additions:
--
-- 1. Venmo, PayPal and Cash App, alongside Zelle, as places to send someone
--    money. Like Zelle they are display only: Shareplate opens a link with
--    the amount filled in, and never sees an account or moves money. People
--    with an account keep theirs on their profile; a trip admin fills them in
--    for a guest. A recorded payment can say which app was used.
--
-- 2. A "By shares" split: each person has a number of shares (2 for a couple,
--    0.5 for a child) and the bill is split in proportion. share_input holds
--    the shares in hundredths (1 share = 100).

-- Usernames only, without @ or $ (the app strips those and pasted links).
alter table public.profiles
  add column venmo_username text check (venmo_username is null or venmo_username ~ '^[A-Za-z0-9_-]{1,30}$'),
  add column paypal_username text check (paypal_username is null or paypal_username ~ '^[A-Za-z0-9]{1,30}$'),
  add column cashapp_cashtag text check (cashapp_cashtag is null or cashapp_cashtag ~ '^[A-Za-z0-9_-]{1,30}$');

alter table public.group_members
  add column venmo_username text check (venmo_username is null or venmo_username ~ '^[A-Za-z0-9_-]{1,30}$'),
  add column paypal_username text check (paypal_username is null or paypal_username ~ '^[A-Za-z0-9]{1,30}$'),
  add column cashapp_cashtag text check (cashapp_cashtag is null or cashapp_cashtag ~ '^[A-Za-z0-9_-]{1,30}$');

comment on column public.profiles.venmo_username is 'Venmo username, without the @. Display only.';
comment on column public.profiles.paypal_username is 'PayPal.Me name. Display only.';
comment on column public.profiles.cashapp_cashtag is 'Cash App $Cashtag, without the $. Display only.';
comment on column public.group_members.venmo_username is 'A guest''s Venmo username, set by a trip admin. People with an account use their profile.';
comment on column public.group_members.paypal_username is 'A guest''s PayPal.Me name, set by a trip admin.';
comment on column public.group_members.cashapp_cashtag is 'A guest''s Cash App $Cashtag, set by a trip admin.';

-- As with Zelle, only guests carry them on their place in the trip.
create or replace function public.guest_zelle_only()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.user_id is not null then
    new.zelle_identifier := null;
    new.venmo_username := null;
    new.paypal_username := null;
    new.cashapp_cashtag := null;
  else
    new.zelle_identifier := nullif(btrim(new.zelle_identifier), '');
    new.venmo_username := nullif(btrim(new.venmo_username), '');
    new.paypal_username := nullif(btrim(new.paypal_username), '');
    new.cashapp_cashtag := nullif(btrim(new.cashapp_cashtag), '');
  end if;
  return new;
end;
$$;

drop trigger group_members_guest_zelle on public.group_members;
create trigger group_members_guest_zelle
  before insert or update of zelle_identifier, venmo_username, paypal_username, cashapp_cashtag, user_id
  on public.group_members
  for each row execute function public.guest_zelle_only();

-- Which app a payment went through.
alter table public.settlements drop constraint settlements_method_check;
alter table public.settlements add constraint settlements_method_check
  check (method in ('zelle', 'venmo', 'paypal', 'cashapp', 'cash', 'other'));

-- "By shares".
alter table public.bills drop constraint bills_split_mode_check;
alter table public.bills add constraint bills_split_mode_check
  check (split_mode in ('itemized', 'equal', 'percent', 'exact', 'shares'));

-- Bill integrity, checked at the end of each transaction (unchanged apart
-- from "By shares", where everyone on the bill needs at least some shares).
create or replace function public.check_bill_integrity(p_bill_id uuid)
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
  elsif v_bill.split_mode = 'shares' then
    if exists (
      select 1 from public.bill_participants
      where bill_id = p_bill_id and (share_input is null or share_input <= 0)
    ) then
      raise exception 'SHARES_MISSING: everyone on the bill needs at least some shares' using errcode = 'P0001';
    end if;
  end if;
end;
$$;

-- Saving a typed bill: the same as before, with "By shares" allowed.
create or replace function public.save_bill(p jsonb)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_total bigint := (p ->> 'total_cents')::bigint;
  v_mode text := p ->> 'split_mode';
  v_existing public.bills;
  v_participant jsonb;
  -- Paid in another currency: what was typed, and the rate used (amounts above are already converted).
  v_currency text := nullif(p ->> 'currency', '');
  v_rate numeric := nullif(p ->> 'fx_rate', '')::numeric;
  v_original bigint := nullif(p ->> 'original_total_cents', '')::bigint;
  v_entry jsonb := case when jsonb_typeof(p -> 'entry') = 'object' then p -> 'entry' end;
begin
  if v_mode is null or v_mode not in ('equal', 'percent', 'exact', 'shares') then
    raise exception 'BAD_SPLIT_MODE: choose equal, percent, exact or shares' using errcode = 'P0001';
  end if;
  if v_total is null or v_total <= 0 then
    raise exception 'BAD_AMOUNT: the bill needs an amount above $0.00' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p -> 'participants') <> 'array' or jsonb_array_length(p -> 'participants') = 0 then
    raise exception 'NO_PARTICIPANTS: choose who is splitting this bill' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.bills (
      group_id, paid_by_member_id, title, category, split_mode,
      subtotal_cents, total_cents, bill_date,
      currency, fx_rate, original_total_cents, entry
    ) values (
      (p ->> 'group_id')::uuid,
      (p ->> 'paid_by_member_id')::uuid,
      nullif(trim(p ->> 'title'), ''),
      coalesce(nullif(trim(p ->> 'category'), ''), 'General'),
      v_mode,
      v_total,
      v_total,
      coalesce(nullif(p ->> 'bill_date', '')::date, current_date),
      v_currency, v_rate, v_original, v_entry
    )
    returning id into v_id;
  else
    -- Row level security hides bills from other trips, so "not found" covers both cases.
    select * into v_existing from public.bills where id = v_id for update;
    if not found then
      raise exception 'BILL_NOT_FOUND: this bill was deleted or you are not in its trip' using errcode = 'P0001';
    end if;
    if v_existing.split_mode = 'itemized' then
      raise exception 'ITEMIZED_BILL: edit scanned bills from the receipt screen' using errcode = 'P0001';
    end if;
    if p ? 'expected_version' and v_existing.version <> (p ->> 'expected_version')::int then
      raise exception 'STALE_BILL: someone else changed this bill while you were editing it' using errcode = 'P0001';
    end if;

    update public.bills set
      paid_by_member_id = (p ->> 'paid_by_member_id')::uuid,
      title = nullif(trim(p ->> 'title'), ''),
      category = coalesce(nullif(trim(p ->> 'category'), ''), 'General'),
      split_mode = v_mode,
      subtotal_cents = v_total,
      discount_cents = 0,
      tax_cents = 0,
      tip_cents = 0,
      total_cents = v_total,
      bill_date = coalesce(nullif(p ->> 'bill_date', '')::date, v_existing.bill_date),
      currency = v_currency,
      fx_rate = v_rate,
      original_total_cents = v_original,
      entry = v_entry
    where id = v_id;

    delete from public.bill_participants where bill_id = v_id;
  end if;

  for v_participant in select * from jsonb_array_elements(p -> 'participants') loop
    insert into public.bill_participants (bill_id, group_member_id, share_input, items_cents, amount_cents)
    values (
      v_id,
      (v_participant ->> 'member_id')::uuid,
      (v_participant ->> 'share_input')::bigint,
      (v_participant ->> 'amount_cents')::bigint,
      (v_participant ->> 'amount_cents')::bigint
    );
  end loop;

  return v_id;
end;
$$;
