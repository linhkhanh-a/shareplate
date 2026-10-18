-- Phase 5: receipt photos and itemized (scanned) bills.

-- ---------------------------------------------------------------------------
-- Private storage for receipt photos. Files live at "<trip id>/<file name>",
-- and only members of that trip can upload, view or delete them.
-- ---------------------------------------------------------------------------

create function public.can_use_receipt_path(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_name is null
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,100}$' then
    return false;
  end if;
  return public.is_group_member(split_part(p_name, '/', 1)::uuid);
end;
$$;

revoke execute on function public.can_use_receipt_path(text) from public, anon, authenticated;
grant execute on function public.can_use_receipt_path(text) to authenticated;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $policy$
      create policy "trip members can view receipts" on storage.objects
      for select to authenticated
      using (bucket_id = 'receipts' and public.can_use_receipt_path(name))
    $policy$;
    execute $policy$
      create policy "trip members can upload receipts" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'receipts' and public.can_use_receipt_path(name))
    $policy$;
    execute $policy$
      create policy "trip members can delete receipts" on storage.objects
      for delete to authenticated
      using (bucket_id = 'receipts' and public.can_use_receipt_path(name))
    $policy$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Saving an itemized bill: the bill, its items, who had each item, and each
-- person's breakdown (items, discount, tax, tip), all in one step. The
-- amounts come from the app's money engine; the database checks they add up.
-- ---------------------------------------------------------------------------

create function public.save_itemized_bill(p jsonb)
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
      subtotal_cents, discount_cents, tax_cents, tip_cents, total_cents, bill_image_path, bill_date
    ) values (
      (p ->> 'group_id')::uuid,
      (p ->> 'paid_by_member_id')::uuid,
      nullif(trim(p ->> 'title'), ''),
      nullif(trim(p ->> 'vendor'), ''),
      coalesce(nullif(trim(p ->> 'category'), ''), 'General'),
      'itemized',
      v_subtotal, v_discount, v_tax, v_tip, v_subtotal - v_discount + v_tax + v_tip,
      nullif(p ->> 'image_path', ''),
      coalesce(nullif(p ->> 'bill_date', '')::date, current_date)
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
      bill_date = coalesce(nullif(p ->> 'bill_date', '')::date, v_existing.bill_date)
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

revoke execute on function public.save_itemized_bill(jsonb) from public, anon, authenticated;
grant execute on function public.save_itemized_bill(jsonb) to authenticated;
