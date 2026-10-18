import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/lib/auth';
import { applyPlacements, type Activity, type ActivityFields, type Placement } from '@/lib/itinerary';
import type { TripEvent } from '@/lib/activity';
import { inviteUrl } from '@/lib/queries-helpers';
import type { ScanResult } from '@/lib/receipt';
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

/** A trip with its dates, for the trip and plan screens. */
export interface TripDetails extends Trip {
  start_date: string | null;
  end_date: string | null;
  /** The whole trip's budget, 0 when not set. */
  total_budget_cents: number;
  /** Which currency amounts are shown in ("USD", "CHF"…). Display only. */
  currency: string;
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
  /** Their own daily spending allowance for the trip, 0 when not set. */
  daily_allowance_cents: number;
  profile: { zelle_identifier: string | null } | null;
  /** A guest's Zelle info, recorded by an admin (null for people with an account). */
  zelle_identifier: string | null;
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
  itinerary: (id: string) => ['itinerary', id] as const,
  events: (id: string) => ['events', id] as const,
  removedPayments: (id: string) => ['removed-payments', id] as const,
  lastSeen: (id: string) => ['last-seen', id] as const,
  unread: (uid: string) => ['unread', uid] as const,
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
    mutationFn: async ({ guests = [], ...trip }: { name: string; mode: TripMode; guests?: string[] }): Promise<string> => {
      const { data, error } = await supabase.from('groups').insert(trip).select('id').single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      if (guests.length > 0) {
        // The trip exists either way; if this fails, guests can still be added on the trip screen.
        await supabase.from('group_members').insert(guests.map((display_name) => ({ group_id: id, display_name })));
      }
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips'] }),
  });
}

export function useTrip(id: string) {
  return useQuery({
    queryKey: keys.trip(id),
    queryFn: async (): Promise<TripDetails> => {
      const { data, error } = await supabase
        .from('groups')
        .select('id, name, mode, created_at, start_date, end_date, total_budget_cents, currency')
        .eq('id', id)
        .single();
      if (error) throw error;
      const trip = data as TripDetails;
      return { ...trip, total_budget_cents: Number(trip.total_budget_cents) };
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

export interface FoundPlace {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/** Finds places with free OpenStreetMap search (through the place-search function). */
export async function searchPlaces(query: string, near: { lat: number; lng: number } | null): Promise<FoundPlace[]> {
  const { data, error } = await supabase.functions.invoke('place-search', { body: { query, near } });
  if (error) {
    // The function explains itself in the body ("Type at least 2 letters…").
    const context = (error as { context?: Response }).context;
    const body = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null;
    throw new Error(body?.message ?? "Place search isn't answering right now. Type the place name instead.");
  }
  return (data as { places: FoundPlace[] }).places ?? [];
}

/** Admins choose the currency the trip's amounts are shown in (no conversion). */
export function useSetTripCurrency(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (currency: string) => {
      const { error } = await supabase.from('groups').update({ currency }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.trip(id) }),
  });
}

/** Admins set the trip's first and last day; the plan shows a date on each day. */
export function useSetTripDates(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dates: { start_date: string | null; end_date: string | null }) => {
      const { error } = await supabase.from('groups').update(dates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.trip(id) }),
  });
}

/** Admins set the whole trip's budget (0 to clear it). */
export function useSetTripBudget(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cents: number) => {
      const { error } = await supabase.from('groups').update({ total_budget_cents: cents }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.trip(id) }),
  });
}

/** Sets a daily allowance: your own, or anyone's if you're an admin. */
export function useSetAllowance(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, cents }: { memberId: string; cents: number }) => {
      const { error } = await supabase.rpc('set_daily_allowance', { p_member: memberId, p_cents: cents });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(tripId) }),
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
        .select('id, user_id, display_name, role, joined_at, left_at, daily_allowance_cents, zelle_identifier, profile:profiles(zelle_identifier)')
        .eq('group_id', tripId)
        .order('joined_at');
      if (error) throw error;
      return (data as unknown as Member[]).map((m) => ({ ...m, daily_allowance_cents: Number(m.daily_allowance_cents ?? 0) }));
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
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.members(tripId) }),
        qc.invalidateQueries({ queryKey: keys.events(tripId) }),
      ]),
  });
}

/** Records a guest's Zelle email or phone (admins only). */
export function useSetGuestZelle(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, zelle }: { memberId: string; zelle: string | null }) => {
      const { error } = await supabase.from('group_members').update({ zelle_identifier: zelle }).eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(tripId) }),
  });
}

/** Puts someone who left back on the trip (admins only). */
export function useBringBack(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.rpc('bring_back_member', { p_member_id: memberId });
      if (error) throw error;
    },
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.members(tripId) }),
        qc.invalidateQueries({ queryKey: keys.events(tripId) }),
      ]),
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
  items_cents: number;
  discount_cents: number;
  tax_cents: number;
  tip_cents: number;
}

export interface Bill {
  id: string;
  title: string | null;
  vendor: string | null;
  category: string;
  split_mode: SplitMode;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  tip_cents: number;
  /** Discount, tax and tip as typed percentages (basis points), null when typed as amounts. */
  discount_rate_bp?: number | null;
  tax_rate_bp?: number | null;
  tip_rate_bp?: number | null;
  total_cents: number;
  bill_date: string;
  bill_image_path: string | null;
  paid_by_member_id: string;
  /** The plan activity this bill is pinned to, if any. */
  itinerary_item_id: string | null;
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
  /** The account that recorded it (null for older payments or deleted accounts). */
  created_by: string | null;
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
          'id, title, vendor, category, split_mode, subtotal_cents, discount_cents, tax_cents, tip_cents, discount_rate_bp, tax_rate_bp, tip_rate_bp, total_cents, bill_date, bill_image_path, paid_by_member_id, itinerary_item_id, version, created_at, shares:bill_participants(group_member_id, share_input, amount_cents, items_cents, discount_cents, tax_cents, tip_cents)',
        )
        .eq('group_id', tripId)
        .order('bill_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as unknown as Bill[]).map((b) => ({
        ...b,
        subtotal_cents: n(b.subtotal_cents),
        discount_cents: n(b.discount_cents),
        tax_cents: n(b.tax_cents),
        tip_cents: n(b.tip_cents),
        total_cents: n(b.total_cents),
        shares: b.shares.map((s) => ({
          ...s,
          amount_cents: n(s.amount_cents),
          items_cents: n(s.items_cents),
          discount_cents: n(s.discount_cents),
          tax_cents: n(s.tax_cents),
          tip_cents: n(s.tip_cents),
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
        .select('id, from_member_id, to_member_id, amount_cents, settled_on, created_at, created_by')
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
      const photo = qc.getQueryData<Bill[]>(keys.bills(tripId))?.find((b) => b.id === billId)?.bill_image_path;
      const { error } = await supabase.from('bills').delete().eq('id', billId);
      if (error) throw error;
      // Tidy up the receipt photo too; the bill is gone either way.
      if (photo) await supabase.storage.from('receipts').remove([photo]);
    },
    // Not removed from the list ahead of time: the bill screen stays open while
    // deleting, so if the database refuses, the reason is shown right there.
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
        created_by: null,
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
      const { data, error } = await supabase.from('settlements').delete().eq('id', paymentId).select('id');
      if (error) throw error;
      // Row level security hides payments you can't remove instead of raising an error.
      if (!data || data.length === 0) throw new Error('PAYMENT_NOT_REMOVED');
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
    onSettled: () =>
      Promise.all([
        invalidateMoney(qc, tripId),
        qc.invalidateQueries({ queryKey: keys.removedPayments(tripId) }),
        qc.invalidateQueries({ queryKey: keys.events(tripId) }),
      ]),
  });
}

/** Payments someone removed, newest first, so a removal never goes unnoticed. */
export function useRemovedPayments(tripId: string) {
  return useQuery({
    queryKey: keys.removedPayments(tripId),
    queryFn: async (): Promise<TripEvent[]> => {
      const { data, error } = await supabase
        .from('trip_events')
        .select('id, actor_member_id, kind, subject, amount_cents, details, created_at')
        .eq('group_id', tripId)
        .eq('kind', 'payment_deleted')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as TripEvent[]).map((e) => ({ ...e, amount_cents: e.amount_cents === null ? null : n(e.amount_cents) }));
    },
  });
}

// ---------------------------------------------------------------------------
// Receipts (Phase 5)
// ---------------------------------------------------------------------------

export interface BillItem {
  id: string;
  name: string;
  price_cents: number;
  position: number;
  member_ids: string[];
}

export function useBillItems(billId: string | undefined) {
  return useQuery({
    queryKey: ['bill-items', billId ?? ''],
    enabled: !!billId,
    queryFn: async (): Promise<BillItem[]> => {
      const { data, error } = await supabase
        .from('bill_items')
        .select('id, name, price_cents, position, mappings:bill_item_mappings(group_member_id)')
        .eq('bill_id', billId!)
        .order('position');
      if (error) throw error;
      return (data as unknown as (Omit<BillItem, 'member_ids'> & { mappings: { group_member_id: string }[] })[]).map(
        (i) => ({
          id: i.id,
          name: i.name,
          price_cents: n(i.price_cents),
          position: i.position,
          member_ids: i.mappings.map((m) => m.group_member_id),
        }),
      );
    },
  });
}

export function useSaveItemizedBill(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>): Promise<string> => {
      const { data, error } = await supabase.rpc('save_itemized_bill', { p: payload });
      if (error) throw error;
      return data as string;
    },
    onSettled: (billId) => {
      void qc.invalidateQueries({ queryKey: ['bill-items', billId ?? ''] });
      return invalidateMoney(qc, tripId);
    },
  });
}

/** Uploads a (resized) receipt photo to the trip's private folder. Returns its storage path. */
export async function uploadReceipt(tripId: string, localUri: string): Promise<string> {
  const response = await fetch(localUri);
  const bytes = await response.arrayBuffer();
  const path = `${tripId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from('receipts').upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export class ReceiptReadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Asks the receipt reader (edge function) to read an uploaded photo. */
export async function readReceipt(path: string): Promise<ScanResult> {
  const { data, error } = await supabase.functions.invoke('scan-receipt', { body: { path } });
  if (error) {
    // The function replies with { code, message } that people can act on.
    const context = (error as { context?: Response }).context;
    let body: { code?: string; message?: string } | undefined;
    try {
      body = context ? await context.json() : undefined;
    } catch {
      body = undefined;
    }
    throw new ReceiptReadError(body?.code ?? 'READER_FAILED', body?.message ?? "Couldn't read the receipt. Enter the items by hand.");
  }
  return data as ScanResult;
}

/** A temporary link for showing a private receipt photo. */
export function useReceiptUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['receipt-url', path ?? ''],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path!, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

// ---------------------------------------------------------------------------
// Trip plan (itinerary)
// ---------------------------------------------------------------------------

export function useItinerary(tripId: string) {
  return useQuery({
    queryKey: keys.itinerary(tripId),
    queryFn: async (): Promise<Activity[]> => {
      const { data, error } = await supabase
        .from('itinerary_items')
        .select(
          'id, day_number, position, start_time, end_time, title, location, location_address, location_lat, location_lng, notes, proposed_budget_cents, version, created_at',
        )
        .eq('group_id', tripId)
        .order('day_number')
        .order('position')
        .order('created_at');
      if (error) throw error;
      return (data as Activity[]).map((a) => ({ ...a, proposed_budget_cents: n(a.proposed_budget_cents) }));
    },
  });
}

export class StaleActivityError extends Error {
  constructor() {
    super('STALE_ACTIVITY: someone else changed this activity while you were editing it');
  }
}

/** Adds a new activity, or saves changes if someone else hasn't changed it first. */
export function useSaveActivity(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      expectedVersion?: number;
      fields: ActivityFields;
      /** Where it goes in its day: set for new activities and moves to another day. */
      position?: number;
    }): Promise<string> => {
      const row = { ...input.fields, ...(input.position === undefined ? {} : { position: input.position }) };
      if (!input.id) {
        const { data, error } = await supabase
          .from('itinerary_items')
          .insert({ ...row, group_id: tripId })
          .select('id')
          .single();
        if (error) throw error;
        return (data as { id: string }).id;
      }
      let query = supabase.from('itinerary_items').update(row).eq('id', input.id);
      if (input.expectedVersion !== undefined) query = query.eq('version', input.expectedVersion);
      const { data, error } = await query.select('id');
      if (error) throw error;
      if ((data ?? []).length === 0) {
        const { data: still } = await supabase.from('itinerary_items').select('id').eq('id', input.id);
        throw (still ?? []).length > 0
          ? new StaleActivityError()
          : new Error('ACTIVITY_NOT_FOUND: this activity was deleted');
      }
      return input.id;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.itinerary(tripId) }),
  });
}

export function useDeleteActivity(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('itinerary_items').delete().eq('id', id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.itinerary(tripId) });
      const previous = qc.getQueryData<Activity[]>(keys.itinerary(tripId));
      qc.setQueryData<Activity[]>(keys.itinerary(tripId), (list) => list?.filter((a) => a.id !== id));
      return { previous };
    },
    onError: (_e, _id, context) => {
      if (context?.previous) qc.setQueryData(keys.itinerary(tripId), context.previous);
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.itinerary(tripId) }),
        // Bills pinned to it are unpinned by the database.
        qc.invalidateQueries({ queryKey: keys.bills(tripId) }),
      ]),
  });
}

/** Saves a new order (and days) for activities, showing it right away. */
export function useArrangeItinerary(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (layout: Placement[]) => {
      const { error } = await supabase.rpc('arrange_itinerary', { p_group: tripId, p_layout: layout });
      if (error) throw error;
    },
    onMutate: async (layout) => {
      await qc.cancelQueries({ queryKey: keys.itinerary(tripId) });
      const previous = qc.getQueryData<Activity[]>(keys.itinerary(tripId));
      qc.setQueryData<Activity[]>(keys.itinerary(tripId), (list) => (list ? applyPlacements(list, layout) : list));
      return { previous };
    },
    onError: (_e, _layout, context) => {
      if (context?.previous) qc.setQueryData(keys.itinerary(tripId), context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.itinerary(tripId) }),
  });
}

/** Pins a bill to an activity, or unpins it (activityId null). */
export function usePinBill(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ billId, activityId }: { billId: string; activityId: string | null }) => {
      const { error } = await supabase.from('bills').update({ itinerary_item_id: activityId }).eq('id', billId);
      if (error) throw error;
    },
    onMutate: async ({ billId, activityId }) => {
      await qc.cancelQueries({ queryKey: keys.bills(tripId) });
      const previous = qc.getQueryData<Bill[]>(keys.bills(tripId));
      qc.setQueryData<Bill[]>(keys.bills(tripId), (bills) =>
        bills?.map((b) => (b.id === billId ? { ...b, itinerary_item_id: activityId } : b)),
      );
      return { previous };
    },
    onError: (_e, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.bills(tripId), context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.bills(tripId) }),
  });
}

/** Items of the given scanned bills, for the spreadsheet export. */
export async function fetchBillItems(billIds: string[]): Promise<Map<string, BillItem[]>> {
  const result = new Map<string, BillItem[]>();
  if (billIds.length === 0) return result;
  const { data, error } = await supabase
    .from('bill_items')
    .select('id, bill_id, name, price_cents, position, mappings:bill_item_mappings(group_member_id)')
    .in('bill_id', billIds)
    .order('position');
  if (error) throw error;
  for (const row of data as unknown as (Omit<BillItem, 'member_ids'> & {
    bill_id: string;
    mappings: { group_member_id: string }[];
  })[]) {
    const list = result.get(row.bill_id) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      price_cents: n(row.price_cents),
      position: row.position,
      member_ids: row.mappings.map((m) => m.group_member_id),
    });
    result.set(row.bill_id, list);
  }
  return result;
}

// ---------------------------------------------------------------------------
// What's new
// ---------------------------------------------------------------------------

export function useTripEvents(tripId: string) {
  return useQuery({
    queryKey: keys.events(tripId),
    queryFn: async (): Promise<TripEvent[]> => {
      const { data, error } = await supabase
        .from('trip_events')
        .select('id, actor_member_id, kind, subject, amount_cents, details, created_at')
        .eq('group_id', tripId)
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data as TripEvent[]).map((e) => ({ ...e, amount_cents: e.amount_cents === null ? null : n(e.amount_cents) }));
    },
  });
}

/** When you last looked at this trip (null if never). Read once per visit. */
export function useLastSeen(tripId: string) {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.lastSeen(tripId),
    enabled: !!uid,
    // Kept for the whole visit (so "new" marks don't vanish), fetched fresh next visit.
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.from('trip_reads').select('seen_at').eq('group_id', tripId).maybeSingle();
      if (error) throw error;
      return (data as { seen_at: string } | null)?.seen_at ?? null;
    },
  });
}

/** Marks everything in the trip as seen, for the "new" badges on the home screen. */
export function useMarkSeen(tripId: string) {
  const uid = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('trip_reads')
        .upsert({ user_id: uid, group_id: tripId, seen_at: new Date().toISOString() }, { onConflict: 'user_id,group_id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['unread'] }),
  });
}

/** How many things changed in each of your trips since you last looked. */
export function useUnreadCounts() {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.unread(uid ?? 'signed-out'),
    enabled: !!uid,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase.rpc('my_unread_counts');
      if (error) throw error;
      return new Map((data as { group_id: string; unread: number }[]).map((r) => [r.group_id, n(r.unread)]));
    },
  });
}

// ---------------------------------------------------------------------------
// Deleting your account
// ---------------------------------------------------------------------------

export interface DeletionBlocker {
  group_id: string;
  trip_name: string;
  reason: 'balance' | 'last_admin';
  amount_cents: number;
}

export function useAccountBlockers(enabled: boolean) {
  const uid = useUserId();
  return useQuery({
    queryKey: ['account-blockers', uid ?? ''],
    enabled: enabled && !!uid,
    queryFn: async (): Promise<DeletionBlocker[]> => {
      const { data, error } = await supabase.rpc('account_deletion_blockers');
      if (error) throw error;
      return (data as DeletionBlocker[]).map((b) => ({ ...b, amount_cents: n(b.amount_cents) }));
    },
  });
}

/** Deletes your account, then signs out on this device. */
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('delete_my_account');
      if (error) throw error;
      // The account is gone, so the server may refuse this; clear this device either way.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      qc.clear();
    },
  });
}

