-- "Start over": an admin clears every bill and payment in a trip in one step,
-- keeping the people and the plan. Useful for a test trip, or one that got
-- tangled. Everyone ends at $0.00, people who left included, so the
-- former-member rule is satisfied at the end of the transaction.

alter table public.trip_events drop constraint trip_events_kind_check;
alter table public.trip_events add constraint trip_events_kind_check check (kind in (
  'bill_added', 'bill_edited', 'bill_deleted',
  'payment_added', 'payment_deleted',
  'member_joined', 'guest_added', 'member_left', 'member_removed', 'member_returned',
  'activity_added', 'activity_deleted',
  'money_cleared'
));

-- Returns the receipt photo paths that belonged to the bills, so the app can
-- remove those files too.
create function public.clear_trip_money(p_group_id uuid)
returns text[]
language plpgsql security definer set search_path = public
as $$
declare
  v_photos text[];
  v_bills int;
  v_payments int;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN' using errcode = 'P0001';
  end if;
  if not public.is_group_admin(p_group_id) then
    raise exception 'NOT_ADMIN: only trip admins can start over' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(bill_image_path) filter (where bill_image_path is not null), '{}'), count(*)
    into v_photos, v_bills
    from public.bills where group_id = p_group_id;
  select count(*) into v_payments from public.settlements where group_id = p_group_id;

  delete from public.settlements where group_id = p_group_id;
  delete from public.bills where group_id = p_group_id;

  -- One line in "What's new" instead of one per bill and payment.
  delete from public.trip_events
  where group_id = p_group_id and created_at = now() and kind in ('bill_deleted', 'payment_deleted');
  perform public._log_trip_event(p_group_id, 'money_cleared', null, null,
    jsonb_build_object('bills', v_bills, 'payments', v_payments));

  return v_photos;
end;
$$;
revoke execute on function public.clear_trip_money(uuid) from public, anon;
grant execute on function public.clear_trip_money(uuid) to authenticated;
