-- Phase 3: saving manual bills (equal, percent, exact) in one step.
--
-- A bill and everyone's shares must be written together: the integrity checks
-- reject a bill whose shares don't add up to its total. This function does
-- both in a single transaction. It runs with the caller's permissions, so the
-- usual row level security applies (only trip members can save bills).

create function public.save_bill(p jsonb)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_total bigint := (p ->> 'total_cents')::bigint;
  v_mode text := p ->> 'split_mode';
  v_existing public.bills;
  v_participant jsonb;
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
      subtotal_cents, total_cents, bill_date
    ) values (
      (p ->> 'group_id')::uuid,
      (p ->> 'paid_by_member_id')::uuid,
      nullif(trim(p ->> 'title'), ''),
      coalesce(nullif(trim(p ->> 'category'), ''), 'General'),
      v_mode,
      v_total,
      v_total,
      coalesce(nullif(p ->> 'bill_date', '')::date, current_date)
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
      bill_date = coalesce(nullif(p ->> 'bill_date', '')::date, v_existing.bill_date)
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

revoke execute on function public.save_bill(jsonb) from public, anon, authenticated;
grant execute on function public.save_bill(jsonb) to authenticated;
