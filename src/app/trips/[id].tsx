import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Avatar, Button, Divider, Loading, Notice, Pill, Screen, Section, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { confirmAction, shareLink, siteUrl } from '@/lib/platform';
import {
  inviteUrl,
  useAddGuest,
  useDeleteTrip,
  useInviteToken,
  useLeaveTrip,
  useMembers,
  useRemoveMember,
  useRenameTrip,
  useResetInvite,
  useSetRole,
  useTrip,
  type Member,
  type Trip,
} from '@/lib/queries';

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const uid = useAuth().session?.user.id;
  const trip = useTrip(id);
  const members = useMembers(id);

  const me = members.data?.find((m) => m.user_id === uid);
  const isAdmin = me?.role === 'admin';

  if (trip.isPending || members.isPending) {
    return (
      <Screen>
        <TopBar />
        <Loading />
      </Screen>
    );
  }

  if (trip.isError || members.isError || !trip.data) {
    return (
      <Screen>
        <TopBar />
        <Notice tone="error">
          {trip.isError || members.isError
            ? friendlyError(trip.error ?? members.error)
            : "This trip doesn't exist or you're not in it."}
        </Notice>
      </Screen>
    );
  }

  const quick = trip.data.mode === 'quick';

  return (
    <Screen>
      <TopBar />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="title" accessibilityRole="header">
          {trip.data.name}
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          {quick ? 'Quick split with guests' : 'Everyone signs in'}, {members.data.length}{' '}
          {members.data.length === 1 ? 'person' : 'people'}
        </ThemedText>
      </View>

      <Notice>Bills, balances and Settle Up are coming in the next update.</Notice>

      {!quick && isAdmin ? <InviteSection tripId={id} tripName={trip.data.name} /> : null}

      <Section title="People">
        <View style={styles.people}>
          {members.data.map((m) => (
            <MemberRow key={m.id} member={m} tripId={id} isMe={m.user_id === uid} canManage={isAdmin} />
          ))}
        </View>
        {isAdmin ? <AddGuest tripId={id} quick={quick} /> : null}
        {!quick && !isAdmin ? (
          <ThemedText type="small" themeColor="textSecondary">
            Want to bring someone? Ask a trip admin for the invite link.
          </ThemedText>
        ) : null}
      </Section>

      <Divider />
      {isAdmin ? <TripSettings trip={trip.data} /> : null}
      <LeaveTrip tripId={id} />
    </Screen>
  );
}

function InviteSection({ tripId, tripName }: { tripId: string; tripName: string }) {
  const theme = useTheme();
  const token = useInviteToken(tripId, true);
  const reset = useResetInvite(tripId);
  const [status, setStatus] = useState<string | null>(null);
  const url = token.data ? inviteUrl(siteUrl(), token.data) : null;

  async function onShare() {
    if (!url) return;
    try {
      const how = await shareLink(`Join "${tripName}" on Shareplate:`, url);
      setStatus(how === 'copied' ? 'Link copied. Paste it into your group chat.' : null);
    } catch (e) {
      setStatus(friendlyError(e));
    }
  }

  async function onReset() {
    const ok = await confirmAction(
      'Reset the invite link?',
      "The current link will stop working. People who already joined stay in the trip.",
      'Reset link',
    );
    if (!ok) return;
    try {
      await reset.mutateAsync();
      setStatus('New link ready. The old one no longer works.');
    } catch (e) {
      setStatus(friendlyError(e));
    }
  }

  return (
    <Section title="Invite friends">
      <ThemedText type="small" themeColor="textSecondary">
        Anyone with this link can sign in with Google and join the trip. It works for 30 days.
      </ThemedText>
      {token.isPending ? <Loading /> : null}
      {token.isError ? <Notice tone="error">{friendlyError(token.error)}</Notice> : null}
      {url ? (
        <View style={[styles.link, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
          <ThemedText type="small" selectable numberOfLines={2}>
            {url}
          </ThemedText>
        </View>
      ) : null}
      <View style={styles.buttonRow}>
        <Button
          label={Platform.OS === 'web' ? 'Copy link' : 'Share link'}
          onPress={onShare}
          disabled={!url}
          style={styles.grow}
        />
        <Button label="Reset link" variant="secondary" onPress={onReset} loading={reset.isPending} />
      </View>
      {status ? <Notice tone="success">{status}</Notice> : null}
    </Section>
  );
}

function MemberRow({
  member,
  tripId,
  isMe,
  canManage,
}: {
  member: Member;
  tripId: string;
  isMe: boolean;
  canManage: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const setRole = useSetRole(tripId);
  const remove = useRemoveMember(tripId);
  const isGuest = !member.user_id;
  const detail = isGuest
    ? 'Guest, no account'
    : member.profile?.zelle_identifier
      ? `Zelle: ${member.profile.zelle_identifier}`
      : 'No Zelle info yet';
  // Admins manage everyone else; your own role changes (stepping down) also live here.
  const manageable = canManage && !(isMe && member.role !== 'admin');
  const error = setRole.error ?? remove.error;

  async function onRemove() {
    const ok = await confirmAction(
      `Remove ${member.display_name}?`,
      'They will no longer see this trip. Bills they were on stay in the history.',
      'Remove',
    );
    if (ok) remove.mutate(member.id);
  }

  return (
    <View style={[styles.member, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        disabled={!manageable}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole={manageable ? 'button' : undefined}
        accessibilityState={manageable ? { expanded: open } : undefined}
        accessibilityHint={manageable ? 'Shows options for this person' : undefined}
        style={styles.memberMain}>
        <Avatar name={member.display_name} />
        <View style={styles.memberText}>
          <ThemedText type="strong" numberOfLines={1}>
            {member.display_name}
            {isMe ? ' (you)' : ''}
          </ThemedText>
          {detail ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} selectable>
              {detail}
            </ThemedText>
          ) : null}
        </View>
        {member.role === 'admin' ? <Pill label="Admin" tone="accent" /> : null}
      </Pressable>

      {open ? (
        <View style={styles.memberActions}>
          {!isGuest ? (
            <Button
              variant="secondary"
              label={member.role === 'admin' ? (isMe ? 'Step down as admin' : 'Remove admin') : 'Make admin'}
              loading={setRole.isPending}
              onPress={() =>
                setRole.mutate({ memberId: member.id, role: member.role === 'admin' ? 'member' : 'admin' })
              }
            />
          ) : null}
          {!isMe ? (
            <Button variant="danger" label="Remove from trip" loading={remove.isPending} onPress={onRemove} />
          ) : null}
          {error ? <Notice tone="error">{friendlyError(error)}</Notice> : null}
        </View>
      ) : null}
    </View>
  );
}

function AddGuest({ tripId, quick }: { tripId: string; quick: boolean }) {
  const add = useAddGuest(tripId);
  const [name, setName] = useState('');

  async function onAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await add.mutateAsync(trimmed);
      setName('');
    } catch {
      // Shown below.
    }
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <TextField
        label="Add a guest"
        hint={
          quick
            ? 'Guests don’t need an account. You track what they owe and send them a summary.'
            : 'For someone without an account. Friends who can sign in should use the invite link instead.'
        }
        placeholder="Their name"
        value={name}
        onChangeText={setName}
        maxLength={60}
        onSubmitEditing={onAdd}
      />
      <Button label="Add guest" variant="secondary" onPress={onAdd} loading={add.isPending} disabled={!name.trim()} />
      {add.isError ? <Notice tone="error">{friendlyError(add.error)}</Notice> : null}
    </View>
  );
}

function TripSettings({ trip }: { trip: Trip }) {
  const rename = useRenameTrip(trip.id);
  const del = useDeleteTrip();
  const [name, setName] = useState(trip.name);
  const [saved, setSaved] = useState(false);

  async function onRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === trip.name) return;
    setSaved(false);
    try {
      await rename.mutateAsync(trimmed);
      setSaved(true);
    } catch {
      // Shown below.
    }
  }

  async function onDelete() {
    const ok = await confirmAction(
      `Delete "${trip.name}"?`,
      'This deletes the trip for everyone, including all of its bills and payments. It can’t be undone.',
      'Delete trip',
    );
    if (!ok) return;
    try {
      await del.mutateAsync(trip.id);
      router.replace('/');
    } catch {
      // Shown below.
    }
  }

  return (
    <Section title="Trip settings">
      <TextField label="Trip name" value={name} onChangeText={setName} maxLength={100} onSubmitEditing={onRename} />
      <Button
        label="Save name"
        variant="secondary"
        onPress={onRename}
        loading={rename.isPending}
        disabled={!name.trim() || name.trim() === trip.name}
      />
      {saved ? <Notice tone="success">Trip renamed.</Notice> : null}
      {rename.isError ? <Notice tone="error">{friendlyError(rename.error)}</Notice> : null}
      <Button label="Delete trip" variant="danger" onPress={onDelete} loading={del.isPending} />
      {del.isError ? <Notice tone="error">{friendlyError(del.error)}</Notice> : null}
    </Section>
  );
}

function LeaveTrip({ tripId }: { tripId: string }) {
  const leave = useLeaveTrip();

  async function onLeave() {
    const ok = await confirmAction(
      'Leave this trip?',
      'You can only leave once you don’t owe or aren’t owed anything. You can rejoin with an invite link.',
      'Leave trip',
    );
    if (!ok) return;
    try {
      await leave.mutateAsync(tripId);
      router.replace('/');
    } catch {
      // Shown below.
    }
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <Button label="Leave trip" variant="danger" onPress={onLeave} loading={leave.isPending} />
      {leave.isError ? <Notice tone="error">{friendlyError(leave.error)}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  people: { gap: Spacing.two },
  member: { borderWidth: 1, borderRadius: Radius.medium, overflow: 'hidden' },
  memberMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  memberText: { flex: 1, gap: Spacing.half },
  memberActions: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  link: { borderWidth: 1, borderRadius: Radius.small, padding: Spacing.three },
  buttonRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  grow: { flexGrow: 1 },
});
