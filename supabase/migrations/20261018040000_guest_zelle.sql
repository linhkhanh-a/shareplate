-- Guests have no account, so their Zelle info lives on their place in the trip.
-- Trip admins fill it in; people with an account keep theirs on their profile.

alter table public.group_members
  add column zelle_identifier text
  check (zelle_identifier is null or length(zelle_identifier) <= 254);

comment on column public.group_members.zelle_identifier is
  'Zelle email or phone for a guest, set by a trip admin. Display only; people with an account use profiles.zelle_identifier.';

-- Only guests carry it here, so there's one place to look for each person.
create function public.guest_zelle_only()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.user_id is not null then
    new.zelle_identifier := null;
  elsif new.zelle_identifier is not null then
    new.zelle_identifier := nullif(btrim(new.zelle_identifier), '');
  end if;
  return new;
end;
$$;

create trigger group_members_guest_zelle
  before insert or update of zelle_identifier, user_id on public.group_members
  for each row execute function public.guest_zelle_only();
