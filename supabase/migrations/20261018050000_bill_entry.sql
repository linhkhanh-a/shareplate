-- Bill entry: remember when discount, tax or tip was typed as a percentage,
-- and let each trip choose the currency its amounts are shown in.

-- ===========================================================================
-- 1. "10%" stays "10%" when you edit the bill again. The amounts in cents are
--    still what everything adds up from; the percentage is only what was typed.
-- ===========================================================================

alter table public.bills
  add column discount_rate_bp int check (discount_rate_bp between 0 and 10000),
  add column tax_rate_bp int check (tax_rate_bp between 0 and 100000),
  add column tip_rate_bp int check (tip_rate_bp between 0 and 100000);

comment on column public.bills.discount_rate_bp is 'Discount as typed, in hundredths of a percent (10% = 1000); null when typed as an amount.';
comment on column public.bills.tax_rate_bp is 'Tax as typed, in hundredths of a percent; null when typed as an amount.';
comment on column public.bills.tip_rate_bp is 'Tip as typed, in hundredths of a percent; null when typed as an amount.';

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
      discount_rate_bp, tax_rate_bp, tip_rate_bp
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
      v_discount_rate, v_tax_rate, v_tip_rate
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
      tip_rate_bp = v_tip_rate
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


-- ===========================================================================
-- 2. Each trip shows its amounts in one currency (display only, no conversion).
--    Only currencies with cents, since the app counts in hundredths.
-- ===========================================================================

-- The column has existed since the start (always 'USD'); now it's limited to
-- currencies the app can show.
alter table public.groups
  add constraint groups_currency_check
  check (currency in ('USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN', 'THB', 'PHP', 'MYR', 'CNY', 'INR'));
