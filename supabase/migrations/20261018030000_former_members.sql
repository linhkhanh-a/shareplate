-- Former members keep a $0 balance, admins can bring them back, and payments
-- can only be removed by the people they involve.

-- ===========================================================================
-- 1. Someone who has left a trip always stays at $0.
--
-- Leaving (or being removed) already requires a $0 balance. Without this
-- check, undoing one of their payments or editing a bill they're on could
-- quietly put money back on them after they were gone. The check runs at the
-- end of the transaction, so a bill saved in several steps is judged as a whole.
-- ===========================================================================

create function public._check_former_member(p_member_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
  v_left timestamptz;
  v_balance bigint;
begin
  if p_member_id is null then
    return;
  end if;
  select display_name, left_at into v_name, v_left from public.group_members where id = p_member_id;
  -- Gone entirely (the trip was deleted) or still on the trip: nothing to check.
  if not found or v_left is null then
    return;
  end if;
  v_balance := public._member_balance_cents(p_member_id);
  if v_balance <> 0 then
    raise exception 'FORMER_MEMBER: % has left the trip, and this would leave them with a balance of % cents', v_name, v_balance
      using errcode = 'P0001', hint = 'Bring them back to the trip first, then make the change.';
  end if;
end;
$$;
revoke execute on function public._check_former_member(uuid) from public, anon, authenticated;

create function public.check_former_members_trigger()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'bills' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform public._check_former_member(old.paid_by_member_id);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform public._check_former_member(new.paid_by_member_id);
    end if;
  elsif tg_table_name = 'bill_participants' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform public._check_former_member(old.group_member_id);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform public._check_former_member(new.group_member_id);
    end if;
  elsif tg_table_name = 'settlements' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform public._check_former_member(old.from_member_id);
      perform public._check_former_member(old.to_member_id);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform public._check_former_member(new.from_member_id);
      perform public._check_former_member(new.to_member_id);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.check_former_members_trigger() from public, anon, authenticated;

create constraint trigger bills_former_members
  after insert or update or delete on public.bills
  deferrable initially deferred
  for each row execute function public.check_former_members_trigger();

create constraint trigger bill_participants_former_members
  after insert or update or delete on public.bill_participants
  deferrable initially deferred
  for each row execute function public.check_former_members_trigger();

create constraint trigger settlements_former_members
  after insert or update or delete on public.settlements
  deferrable initially deferred
  for each row execute function public.check_former_members_trigger();

-- ===========================================================================
-- 2. Bring someone back to the trip (admins only).
-- ===========================================================================

create function public.bring_back_member(p_member_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_group uuid;
  v_left timestamptz;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN' using errcode = 'P0001';
  end if;
  select group_id, left_at into v_group, v_left from public.group_members where id = p_member_id;
  if not found or not public.is_group_member(v_group) then
    raise exception 'NOT_MEMBER' using errcode = 'P0001';
  end if;
  if not public.is_group_admin(v_group) then
    raise exception 'NOT_ADMIN: only trip admins can bring someone back' using errcode = 'P0001';
  end if;
  if v_left is null then
    return;
  end if;
  update public.group_members set left_at = null where id = p_member_id;
end;
$$;
revoke execute on function public.bring_back_member(uuid) from public, anon;
grant execute on function public.bring_back_member(uuid) to authenticated;

-- ===========================================================================
-- 3. Payments: anyone in the trip can record one, but only the payer, the
--    receiver, whoever recorded it, or an admin can remove it. Nobody edits
--    a payment; remove it and record it again instead.
-- ===========================================================================

drop policy "settlements: members all" on public.settlements;

create policy "settlements: members read" on public.settlements
  for select to authenticated
  using (public.is_group_member(group_id));

create policy "settlements: members record" on public.settlements
  for insert to authenticated
  with check (public.is_group_member(group_id));

create policy "settlements: involved remove" on public.settlements
  for delete to authenticated
  using (
    public.is_group_member(group_id)
    and (
      created_by = auth.uid()
      or public.is_group_admin(group_id)
      or exists (
        select 1 from public.group_members m
        where m.group_id = settlements.group_id
          and m.user_id = auth.uid()
          and m.id in (settlements.from_member_id, settlements.to_member_id)
      )
    )
  );

revoke update on public.settlements from authenticated;

-- ===========================================================================
-- 4. "What's new": tell apart leaving from being removed, and joining from
--    being brought back.
-- ===========================================================================

alter table public.trip_events drop constraint trip_events_kind_check;
alter table public.trip_events add constraint trip_events_kind_check check (kind in (
  'bill_added', 'bill_edited', 'bill_deleted',
  'payment_added', 'payment_deleted',
  'member_joined', 'guest_added', 'member_left', 'member_removed', 'member_returned',
  'activity_added', 'activity_deleted'
));

create or replace function public.log_member_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    perform public._log_trip_event(new.group_id, case when new.user_id is null then 'guest_added' else 'member_joined' end,
      new.display_name, null, jsonb_build_object('member', new.id));
    return null;
  end if;
  -- Someone else did it (an admin), rather than the person themselves.
  v_actor := public._my_member_id(new.group_id);
  if old.left_at is null and new.left_at is not null then
    perform public._log_trip_event(new.group_id,
      case when v_actor is not null and v_actor <> new.id then 'member_removed' else 'member_left' end,
      new.display_name, null, jsonb_build_object('member', new.id));
  elsif old.left_at is not null and new.left_at is null then
    perform public._log_trip_event(new.group_id,
      case when v_actor is not null and v_actor <> new.id then 'member_returned' else 'member_joined' end,
      new.display_name, null, jsonb_build_object('member', new.id));
  end if;
  return null;
end;
$$;
