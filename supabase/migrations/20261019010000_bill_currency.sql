-- Bills paid in another currency. Every amount on the bill is still stored
-- in the trip's currency, converted when the bill is saved, so balances and
-- settling up work exactly as before. The bill also keeps what was paid
-- (currency, original total), the rate used, and what was typed (`entry`), so
-- it can be shown and edited in the currency it was paid in.

alter table public.bills
  add column currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  add column fx_rate numeric(24, 12) check (fx_rate is null or fx_rate > 0),
  add column original_total_cents bigint check (original_total_cents is null or original_total_cents > 0),
  add column entry jsonb check (entry is null or (jsonb_typeof(entry) = 'object' and length(entry::text) <= 20000)),
  -- All three, or none.
  add constraint bills_currency_complete check (
    (currency is null and fx_rate is null and original_total_cents is null)
    or (currency is not null and fx_rate is not null and original_total_cents is not null)
  );

comment on column public.bills.currency is 'The currency the bill was paid in, when it differs from the trip''s. Null: the trip''s currency.';
comment on column public.bills.fx_rate is 'Trip currency per 1 unit of the bill''s currency, used to convert every amount on the bill.';
comment on column public.bills.original_total_cents is 'The total in the bill''s own currency, in hundredths.';
comment on column public.bills.entry is 'What was typed, in the bill''s own currency, so editing shows it again.';

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
  if v_mode is null or v_mode not in ('equal', 'percent', 'exact') then
    raise exception 'BAD_SPLIT_MODE: choose equal, percent or exact' using errcode = 'P0001';
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

create or replace function public.save_itemized_bill(p jsonb)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_existing public.bills;
  v_item jsonb;
  v_item_id uuid;
  v_member text;
  v_participant jsonb;
  v_position int := 0;
  v_subtotal bigint := 0;
  v_discount bigint := coalesce((p ->> 'discount_cents')::bigint, 0);
  v_tax bigint := coalesce((p ->> 'tax_cents')::bigint, 0);
  v_tip bigint := coalesce((p ->> 'tip_cents')::bigint, 0);
  -- When discount, tax or tip was typed as a percentage, the percentage (basis points).
  v_discount_rate int := nullif(p ->> 'discount_rate_bp', '')::int;
  v_tax_rate int := nullif(p ->> 'tax_rate_bp', '')::int;
  v_tip_rate int := nullif(p ->> 'tip_rate_bp', '')::int;
  -- Paid in another currency: what was typed, and the rate used (amounts above are already converted).
  v_currency text := nullif(p ->> 'currency', '');
  v_rate numeric := nullif(p ->> 'fx_rate', '')::numeric;
  v_original bigint := nullif(p ->> 'original_total_cents', '')::bigint;
  v_entry jsonb := case when jsonb_typeof(p -> 'entry') = 'object' then p -> 'entry' end;
begin
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'NO_ITEMS: add at least one item' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p -> 'participants') <> 'array' or jsonb_array_length(p -> 'participants') = 0 then
    raise exception 'NO_PARTICIPANTS: choose who had each item' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    if (v_item ->> 'price_cents')::bigint < 0 then
      raise exception 'BAD_AMOUNT: item prices cannot be negative' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_item -> 'member_ids') <> 'array' or jsonb_array_length(v_item -> 'member_ids') = 0 then
      raise exception 'ITEM_UNASSIGNED: % has nobody assigned', coalesce(v_item ->> 'name', 'An item')
        using errcode = 'P0001';
    end if;
    v_subtotal := v_subtotal + (v_item ->> 'price_cents')::bigint;
  end loop;

  if v_subtotal - v_discount + v_tax + v_tip <= 0 then
    raise exception 'BAD_AMOUNT: the bill needs an amount above $0.00' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.bills (
      group_id, paid_by_member_id, title, vendor, category, split_mode,
      subtotal_cents, discount_cents, tax_cents, tip_cents, total_cents, bill_image_path, bill_date,
      discount_rate_bp, tax_rate_bp, tip_rate_bp,
      currency, fx_rate, original_total_cents, entry
    ) values (
      (p ->> 'group_id')::uuid,
      (p ->> 'paid_by_member_id')::uuid,
      nullif(trim(p ->> 'title'), ''),
      nullif(trim(p ->> 'vendor'), ''),
      coalesce(nullif(trim(p ->> 'category'), ''), 'General'),
      'itemized',
      v_subtotal, v_discount, v_tax, v_tip, v_subtotal - v_discount + v_tax + v_tip,
      nullif(p ->> 'image_path', ''),
      coalesce(nullif(p ->> 'bill_date', '')::date, current_date),
      v_discount_rate, v_tax_rate, v_tip_rate,
      v_currency, v_rate, v_original, v_entry
    )
    returning id into v_id;
  else
    select * into v_existing from public.bills where id = v_id for update;
    if not found then
      raise exception 'BILL_NOT_FOUND: this bill was deleted or you are not in its trip' using errcode = 'P0001';
    end if;
    if p ? 'expected_version' and v_existing.version <> (p ->> 'expected_version')::int then
      raise exception 'STALE_BILL: someone else changed this bill while you were editing it' using errcode = 'P0001';
    end if;

    update public.bills set
      paid_by_member_id = (p ->> 'paid_by_member_id')::uuid,
      title = nullif(trim(p ->> 'title'), ''),
      vendor = nullif(trim(p ->> 'vendor'), ''),
      category = coalesce(nullif(trim(p ->> 'category'), ''), 'General'),
      split_mode = 'itemized',
      subtotal_cents = v_subtotal,
      discount_cents = v_discount,
      tax_cents = v_tax,
      tip_cents = v_tip,
      total_cents = v_subtotal - v_discount + v_tax + v_tip,
      bill_image_path = coalesce(nullif(p ->> 'image_path', ''), v_existing.bill_image_path),
      bill_date = coalesce(nullif(p ->> 'bill_date', '')::date, v_existing.bill_date),
      discount_rate_bp = v_discount_rate,
      tax_rate_bp = v_tax_rate,
      tip_rate_bp = v_tip_rate,
      currency = v_currency,
      fx_rate = v_rate,
      original_total_cents = v_original,
      entry = v_entry
    where id = v_id;

    delete from public.bill_items where bill_id = v_id;
    delete from public.bill_participants where bill_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    insert into public.bill_items (bill_id, name, price_cents, position)
    values (v_id, coalesce(nullif(trim(v_item ->> 'name'), ''), 'Item'), (v_item ->> 'price_cents')::bigint, v_position)
    returning id into v_item_id;
    v_position := v_position + 1;
    for v_member in select * from jsonb_array_elements_text(v_item -> 'member_ids') loop
      insert into public.bill_item_mappings (bill_item_id, group_member_id) values (v_item_id, v_member::uuid);
    end loop;
  end loop;

  for v_participant in select * from jsonb_array_elements(p -> 'participants') loop
    insert into public.bill_participants (
      bill_id, group_member_id, share_input, items_cents, discount_cents, tax_cents, tip_cents, amount_cents
    ) values (
      v_id,
      (v_participant ->> 'member_id')::uuid,
      null,
      coalesce((v_participant ->> 'items_cents')::bigint, 0),
      coalesce((v_participant ->> 'discount_cents')::bigint, 0),
      coalesce((v_participant ->> 'tax_cents')::bigint, 0),
      coalesce((v_participant ->> 'tip_cents')::bigint, 0),
      (v_participant ->> 'amount_cents')::bigint
    );
  end loop;

  return v_id;
end;
$$;
