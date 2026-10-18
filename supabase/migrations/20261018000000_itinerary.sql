-- Phase 6: the trip plan (itinerary) and pinning bills to it.
--
-- The itinerary table and the bill pin column were created in the first
-- migration. This adds what the screens need on top:
--   1. Live updates for the plan, like bills and payments.
--   2. Rearranging (dragging) activities in one step.
--   3. Moving or pinning things doesn't count as "editing" them, so someone
--      who is editing an activity or a bill doesn't get a false "someone else
--      changed this" warning just because another person dragged it or pinned it.
--   4. Sensible length limits for the free-text fields.

-- 1. Live updates ----------------------------------------------------------

create trigger itinerary_items_activity after insert or update or delete on public.itinerary_items
  for each row execute function public.touch_trip_activity();

-- 2. Rearranging -----------------------------------------------------------

-- p_layout: [{ "id": "...", "day_number": 2, "position": 0 }, ...]
-- Everything moves together or not at all. Runs with the caller's permissions,
-- so only trip members can rearrange their own trip.
create function public.arrange_itinerary(p_group uuid, p_layout jsonb)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_expected int;
  v_updated int;
begin
  if jsonb_typeof(p_layout) <> 'array' then
    raise exception 'BAD_LAYOUT: expected a list of activities' using errcode = 'P0001';
  end if;
  v_expected := jsonb_array_length(p_layout);
  if v_expected = 0 then
    return;
  end if;

  update public.itinerary_items i
  set day_number = l.day_number, position = l.position
  from jsonb_to_recordset(p_layout) as l(id uuid, day_number int, position int)
  where i.id = l.id and i.group_id = p_group;
  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception 'ACTIVITY_NOT_FOUND: an activity was deleted or is not in this trip' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.arrange_itinerary(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.arrange_itinerary(uuid, jsonb) to authenticated;

-- 3. Versions only change for real edits -----------------------------------

-- Like bump_version, but changes to the listed columns alone keep the version.
create function public.bump_version_ignoring()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - tg_argv - 'version' - 'updated_at') = (to_jsonb(old) - tg_argv - 'version' - 'updated_at') then
    new.version := old.version;
  else
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger itinerary_items_version on public.itinerary_items;
create trigger itinerary_items_version before update on public.itinerary_items
  for each row execute function public.bump_version_ignoring('day_number', 'position');

drop trigger bills_version on public.bills;
create trigger bills_version before update on public.bills
  for each row execute function public.bump_version_ignoring('itinerary_item_id');

-- 4. Limits ----------------------------------------------------------------

alter table public.itinerary_items
  add constraint itinerary_items_location_length check (location is null or length(location) <= 300),
  add constraint itinerary_items_notes_length check (notes is null or length(notes) <= 2000),
  add constraint itinerary_items_day_limit check (day_number <= 60);
