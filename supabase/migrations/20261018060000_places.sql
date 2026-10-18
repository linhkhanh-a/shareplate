-- A plan activity can point at an exact place found with place search: its
-- name stays in `location`, plus the address and coordinates for the map link.

alter table public.itinerary_items
  add column location_address text check (location_address is null or length(location_address) <= 500),
  add column location_lat double precision check (location_lat is null or location_lat between -90 and 90),
  add column location_lng double precision check (location_lng is null or location_lng between -180 and 180),
  -- Coordinates come in pairs.
  add constraint itinerary_items_location_pair check ((location_lat is null) = (location_lng is null));
