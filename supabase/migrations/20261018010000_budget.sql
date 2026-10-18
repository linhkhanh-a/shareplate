-- Phase 7: budgets.
--
-- The trip's total budget (groups.total_budget_cents) and each person's daily
-- allowance (group_members.daily_allowance_cents) were created in the first
-- migration. Admins can already change the trip. This lets people set their
-- own daily allowance, and admins set anyone's (for example a guest's), without
-- opening up the rest of the member row (roles, names) to regular members.

create function public.set_daily_allowance(p_member uuid, p_cents bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_member public.group_members;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN: sign in first' using errcode = 'P0001';
  end if;
  if p_cents is null or p_cents < 0 or p_cents > 100000000 then
    raise exception 'BAD_ALLOWANCE: enter an allowance between $0 and $1,000,000' using errcode = 'P0001';
  end if;

  select * into v_member from public.group_members where id = p_member;
  if not found or v_member.left_at is not null or not public.is_group_member(v_member.group_id) then
    raise exception 'NOT_MEMBER: that person is not in your trip' using errcode = 'P0001';
  end if;
  if v_member.user_id is distinct from auth.uid() and not public.is_group_admin(v_member.group_id) then
    raise exception 'NOT_ADMIN: only trip admins can set someone else''s allowance' using errcode = 'P0001';
  end if;

  update public.group_members set daily_allowance_cents = p_cents where id = p_member;
end;
$$;

revoke execute on function public.set_daily_allowance(uuid, bigint) from public, anon, authenticated;
grant execute on function public.set_daily_allowance(uuid, bigint) to authenticated;

-- A sensible ceiling for the trip budget, matching the allowance's.
alter table public.groups
  add constraint groups_total_budget_limit check (total_budget_cents <= 10000000000);
