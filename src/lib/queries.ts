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

export function useMembers(tripId: string) {
  return useQuery({
    queryKey: keys.members(tripId),
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await supabase
        .from('group_members')
        .select('id, user_id, display_name, role, joined_at, profile:profiles(zelle_identifier)')
        .eq('group_id', tripId)
        .is('left_at', null)
        .order('joined_at');
      if (error) throw error;
      return data as unknown as Member[];
    },
  });
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
