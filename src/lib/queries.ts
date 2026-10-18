import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/lib/auth';
import { inviteUrl } from '@/lib/queries-helpers';
import { supabase } from '@/lib/supabase';

export { inviteUrl };

// ---------------------------------------------------------------------------
// Shapes of the data the screens use
// ---------------------------------------------------------------------------

export type TripMode = 'registered' | 'quick';
export type Role = 'admin' | 'member';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  zelle_identifier: string | null;
  onboarded_at: string | null;
}

export interface Trip {
  id: string;
  name: string;
  mode: TripMode;
  created_at: string;
}

export interface TripSummary {
  memberId: string;
  role: Role;
  trip: Trip;
}

export interface Member {
  id: string;
  user_id: string | null;
  display_name: string;
  role: Role;
  joined_at: string;
  /** Set when they left or were removed. Kept so old bills still show their name. */
  left_at: string | null;
  profile: { zelle_identifier: string | null } | null;
}

export interface InvitePreview {
  group_id: string;
  group_name: string;
  member_count: number;
  invited_by: string | null;
  already_member: boolean;
}

export const keys = {
  profile: (uid: string) => ['profile', uid] as const,
  trips: (uid: string) => ['trips', uid] as const,
  trip: (id: string) => ['trip', id] as const,
  members: (id: string) => ['members', id] as const,
  invite: (id: string) => ['invite', id] as const,
  bills: (id: string) => ['bills', id] as const,
  payments: (id: string) => ['payments', id] as const,
  invitePreview: (token: string) => ['invite-preview', token] as const,
};

function useUserId(): string | null {
  return useAuth().session?.user.id ?? null;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function useProfile() {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.profile(uid ?? 'signed-out'),
    enabled: !!uid,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url, zelle_identifier, onboarded_at')
        .eq('id', uid!)
        .single();
      if (error) throw error;
      return data as Profile;
    },
  });
}

export function useUpdateProfile() {
  const uid = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (changes: Partial<Pick<Profile, 'full_name' | 'zelle_identifier' | 'onboarded_at'>>) => {
      const { error } = await supabase.from('profiles').update(changes).eq('id', uid!);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export function useTrips() {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.trips(uid ?? 'signed-out'),
    enabled: !!uid,
    queryFn: async (): Promise<TripSummary[]> => {
      const { data, error } = await supabase
        .from('group_members')
        .select('id, role, trip:groups!inner(id, name, mode, created_at)')
        .eq('user_id', uid!)
        .is('left_at', null);
      if (error) throw error;
      return (data as unknown as { id: string; role: Role; trip: Trip }[])
        .map((row) => ({ memberId: row.id, role: row.role, trip: row.trip }))
        .sort((a, b) => b.trip.created_at.localeCompare(a.trip.created_at));
    },
  });
}

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; mode: TripMode }): Promise<string> => {
      const { data, error } = await supabase.from('groups').insert(input).select('id').single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips'] }),
  });
}

export function useTrip(id: string) {
  return useQuery({
    queryKey: keys.trip(id),
    queryFn: async (): Promise<Trip> => {
      const { data, error } = await supabase.from('groups').select('id, name, mode, created_at').eq('id', id).single();
      if (error) throw error;
      return data as Trip;
    },
  });
}

export function useRenameTrip(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('groups').update({ name }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useDeleteTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('groups').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips'] }),
  });
}

export function useLeaveTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('leave_group', { p_group_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips'] }),
  });
}

// ---------------------------------------------------------------------------
// Members and guests
// ---------------------------------------------------------------------------

/** Everyone who has ever been in the trip, including people who left. */
export function useMembers(tripId: string) {
  return useQuery({
    queryKey: keys.members(tripId),
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await supabase
        .from('group_members')
        .select('id, user_id, display_name, role, joined_at, left_at, profile:profiles(zelle_identifier)')
        .eq('group_id', tripId)
        .order('joined_at');
      if (error) throw error;
      return data as unknown as Member[];
    },
  });
}

export function activeMembers(members: Member[] | undefined): Member[] {
  return (members ?? []).filter((m) => !m.left_at);
}

export function useAddGuest(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('group_members').insert({ group_id: tripId, display_name: name });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(tripId) }),
  });
}

export function useSetRole(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: Role }) => {
      const { error } = await supabase.from('group_members').update({ role }).eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(tripId) }),
  });
}

/** Takes someone off the trip. Their past bills stay in the history. */
export function useRemoveMember(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('group_members')
        .update({ left_at: new Date().toISOString() })
        .eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(tripId) }),
  });
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

export function useInviteToken(tripId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.invite(tripId),
    enabled,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc('get_or_create_invite', { p_group_id: tripId });
      if (error) throw error;
      return data as string;
    },
  });
}

export function useResetInvite(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc('reset_invite', { p_group_id: tripId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (token) => qc.setQueryData(keys.invite(tripId), token),
  });
}

export function useInvitePreview(token: string | undefined) {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.invitePreview(token ?? ''),
    enabled: !!token && !!uid,
    queryFn: async (): Promise<InvitePreview | null> => {
      const { data, error } = await supabase.rpc('preview_invite', { p_token: token });
      if (error) throw error;
      const row = (data as InvitePreview[])[0];
      return row ? { ...row, member_count: Number(row.member_count) } : null;
    },
  });
}

export function useJoinTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string): Promise<string> => {
      const { data, error } = await supabase.rpc('join_group', { p_token: token });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips'] }),
  });
}

// ---------------------------------------------------------------------------
// Bills and payments
// ---------------------------------------------------------------------------

export type SplitMode = 'equal' | 'percent' | 'exact' | 'itemized';

export interface BillShare {
  group_member_id: string;
  share_input: number | null;
  amount_cents: number;
}

export interface Bill {
  id: string;
  title: string | null;
  vendor: string | null;
  category: string;
  split_mode: SplitMode;
  total_cents: number;
  bill_date: string;
  paid_by_member_id: string;
  version: number;
  created_at: string;
  shares: BillShare[];
}

export interface Payment {
  id: string;
  from_member_id: string;
  to_member_id: string;
  amount_cents: number;
  settled_on: string;
  created_at: string;
}

/** What the bill editor sends to the database. */
export interface BillDraft {
  id?: string;
  expected_version?: number;
  group_id: string;
  paid_by_member_id: string;
  title: string;
  category: string;
  split_mode: 'equal' | 'percent' | 'exact';
  total_cents: number;
  bill_date: string;
  participants: { member_id: string; share_input: number | null; amount_cents: number }[];
}

// Postgres bigint columns can arrive as strings; amounts are always whole cents.
const n = (v: unknown) => Number(v);

export function useBills(tripId: string) {
  return useQuery({
    queryKey: keys.bills(tripId),
    queryFn: async (): Promise<Bill[]> => {
      const { data, error } = await supabase
        .from('bills')
        .select(
          'id, title, vendor, category, split_mode, total_cents, bill_date, paid_by_member_id, version, created_at, shares:bill_participants(group_member_id, share_input, amount_cents)',
        )
        .eq('group_id', tripId)
        .order('bill_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as unknown as Bill[]).map((b) => ({
        ...b,
        total_cents: n(b.total_cents),
        shares: b.shares.map((s) => ({
          ...s,
          amount_cents: n(s.amount_cents),
          share_input: s.share_input === null ? null : n(s.share_input),
        })),
      }));
    },
  });
}

export function usePayments(tripId: string) {
  return useQuery({
    queryKey: keys.payments(tripId),
    queryFn: async (): Promise<Payment[]> => {
      const { data, error } = await supabase
        .from('settlements')
        .select('id, from_member_id, to_member_id, amount_cents, settled_on, created_at')
        .eq('group_id', tripId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as Payment[]).map((p) => ({ ...p, amount_cents: n(p.amount_cents) }));
    },
  });
}

function invalidateMoney(qc: ReturnType<typeof useQueryClient>, tripId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: keys.bills(tripId) }),
    qc.invalidateQueries({ queryKey: keys.payments(tripId) }),
  ]);
}

export function useSaveBill(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: BillDraft): Promise<string> => {
      const { data, error } = await supabase.rpc('save_bill', { p: draft });
      if (error) throw error;
      return data as string;
    },
    onSettled: () => invalidateMoney(qc, tripId),
  });
}

export function useDeleteBill(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (billId: string) => {
      const { error } = await supabase.from('bills').delete().eq('id', billId);
      if (error) throw error;
    },
    // Disappear right away; put it back if the delete fails.
    onMutate: async (billId) => {
      await qc.cancelQueries({ queryKey: keys.bills(tripId) });
      const previous = qc.getQueryData<Bill[]>(keys.bills(tripId));
      qc.setQueryData<Bill[]>(keys.bills(tripId), (bills) => bills?.filter((b) => b.id !== billId));
      return { previous };
    },
    onError: (_error, _billId, context) => {
      if (context?.previous) qc.setQueryData(keys.bills(tripId), context.previous);
    },
    onSettled: () => invalidateMoney(qc, tripId),
  });
}

export function useRecordPayment(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { from_member_id: string; to_member_id: string; amount_cents: number }) => {
      const { error } = await supabase.from('settlements').insert({ ...p, group_id: tripId, method: 'zelle' });
      if (error) throw error;
    },
    // Show the payment (and the new balances) right away; undo if saving fails.
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: keys.payments(tripId) });
      const previous = qc.getQueryData<Payment[]>(keys.payments(tripId));
      const now = new Date();
      const pending: Payment = {
        id: `pending-${now.getTime()}`,
        ...p,
        settled_on: now.toISOString().slice(0, 10),
        created_at: now.toISOString(),
      };
      qc.setQueryData<Payment[]>(keys.payments(tripId), (payments) => [pending, ...(payments ?? [])]);
      return { previous };
    },
    onError: (_error, _p, context) => {
      if (context?.previous) qc.setQueryData(keys.payments(tripId), context.previous);
    },
    onSettled: () => invalidateMoney(qc, tripId),
  });
}

export function useDeletePayment(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase.from('settlements').delete().eq('id', paymentId);
      if (error) throw error;
    },
    onMutate: async (paymentId) => {
      await qc.cancelQueries({ queryKey: keys.payments(tripId) });
      const previous = qc.getQueryData<Payment[]>(keys.payments(tripId));
      qc.setQueryData<Payment[]>(keys.payments(tripId), (payments) => payments?.filter((p) => p.id !== paymentId));
      return { previous };
    },
    onError: (_error, _paymentId, context) => {
      if (context?.previous) qc.setQueryData(keys.payments(tripId), context.previous);
    },
    onSettled: () => invalidateMoney(qc, tripId),
  });
}
