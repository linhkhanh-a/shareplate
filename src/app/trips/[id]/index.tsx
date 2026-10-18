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
import { friendlyDate, tripMoney } from '@/lib/ledger';
import { useTripLive } from '@/lib/live';
import { describeEditors } from '@/lib/presence';
import { confirmAction, shareLink, siteUrl } from '@/lib/platform';
import {
  activeMembers,
  inviteUrl,
  useBills,
  usePayments,
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
  type Bill,
  type Member,
  type Trip,
} from '@/lib/queries';
import { formatCents } from '@/money';

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const uid = useAuth().session?.user.id;
  const trip = useTrip(id);
  const members = useMembers(id);
  const bills = useBills(id);
  const payments = usePayments(id);

  const me = members.data?.find((m) => m.user_id === uid && !m.left_at);
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
  const active = activeMembers(members.data);
  const names = new Map((members.data ?? []).map((m) => [m.id, m.id === me?.id ? 'You' : m.display_name]));

  return (
    <Screen>
      <TopBar right={<LiveBadge />} />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="title" accessibilityRole="header">
          {trip.data.name}
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          {quick ? 'Quick split with guests' : 'Everyone signs in'}, {active.length}{' '}
          {active.length === 1 ? 'person' : 'people'}
        </ThemedText>
      </View>

      <MoneySummary tripId={id} myMemberId={me?.id} memberIds={active.map((m) => m.id)} />

      <Section title="Bills">
        {bills.isPending ? <Loading /> : null}
        {bills.isError ? <Notice tone="error">{friendlyError(bills.error)}</Notice> : null}
        {bills.data && bills.data.length === 0 ? (
          <Notice>
            <ThemedText type="strong">No bills yet</ThemedText>
            <ThemedText type="small">Add the first one, like a dinner, a taxi or the hotel.</ThemedText>
          </Notice>
        ) : null}
        <View style={styles.people}>
          {bills.data?.map((b) => (
            <BillRow key={b.id} tripId={id} bill={b} payerName={names.get(b.paid_by_member_id) ?? 'Someone'} myMemberId={me?.id} />
          ))}
        </View>
        {payments.data && payments.data.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {payments.data.length} {payments.data.length === 1 ? 'payment' : 'payments'} recorded. See them in Settle up.
          </ThemedText>
        ) : null}
      </Section>

      {!quick && isAdmin ? <InviteSection tripId={id} tripName={trip.data.name} /> : null}

      <Section title="People">
        <View style={styles.people}>
          {active.map((m) => (
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

/** A small dot while changes from other people arrive live. */
function LiveBadge() {
  const theme = useTheme();
  const { connected } = useTripLive();
  if (!connected) return null;
  return (
    <View style={styles.live} accessibilityLabel="Updating live">
      <View style={[styles.liveDot, { backgroundColor: theme.primary }]} />
      <ThemedText type="small" themeColor="textSecondary">
        Live
      </ThemedText>
    </View>
  );
}

function MoneySummary({
  tripId,
  myMemberId,
  memberIds,
}: {
  tripId: string;
  myMemberId?: string;
  memberIds: string[];
}) {
  const theme = useTheme();
  const bills = useBills(tripId);
  const payments = usePayments(tripId);
  if (!bills.data || !payments.data) return null;

  const money = tripMoney(bills.data, payments.data, memberIds);
  const mine = myMemberId ? (money.balances.get(myMemberId) ?? 0) : 0;
  const headline =
    mine > 0 ? "You're owed" : mine < 0 ? 'You owe' : bills.data.length === 0 ? 'Nothing spent yet' : "You're all settled";

  return (
    <View style={[styles.summary, { backgroundColor: theme.primary }]}>
      <ThemedText style={{ color: theme.onPrimary, opacity: 0.85 }}>{headline}</ThemedText>
      {mine !== 0 ? (
        <ThemedText type="display" style={[styles.summaryAmount, { color: theme.onPrimary }]}>
          {formatCents(Math.abs(mine))}
        </ThemedText>
      ) : null}
      <ThemedText type="small" style={{ color: theme.onPrimary, opacity: 0.85 }}>
        {formatCents(money.totalSpentCents)} spent on this trip
      </ThemedText>
      <View style={styles.summaryButtons}>
        <Button
          label="Scan receipt"
          onPress={() => router.push({ pathname: '/trips/[id]/scan', params: { id: tripId } })}
          style={{ ...styles.summaryButton, backgroundColor: theme.accent, borderColor: theme.accent }}
          textColor={theme.onAccent}
        />
        <Button
          label="Add bill"
          variant="secondary"
          onPress={() => router.push({ pathname: '/trips/[id]/bill', params: { id: tripId } })}
          style={styles.summaryButton}
        />
      </View>
      <Button
        label="Settle up"
        variant="secondary"
        onPress={() => router.push({ pathname: '/trips/[id]/settle', params: { id: tripId } })}
        style={styles.settleButton}
        textColor={theme.onPrimary}
      />
    </View>
  );
}

function BillRow({
  tripId,
  bill,
  payerName,
  myMemberId,
}: {
  tripId: string;
  bill: Bill;
  payerName: string;
  myMemberId?: string;
}) {
  const theme = useTheme();
  const editors = useTripLive().editorsOf(bill.id);
  const myShare = bill.shares.find((s) => s.group_member_id === myMemberId)?.amount_cents;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens the bill to view or edit it"
      onPress={() =>
        router.push({
          pathname: bill.split_mode === 'itemized' ? '/trips/[id]/scan' : '/trips/[id]/bill',
          params: { id: tripId, billId: bill.id },
        })
      }
      style={({ pressed }) => [
        styles.billRow,
        { backgroundColor: pressed ? theme.surfaceMuted : theme.surface, borderColor: theme.border },
      ]}>
      <View style={styles.grow}>
        <ThemedText type="strong" numberOfLines={1}>
          {bill.title || bill.category}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {payerName === 'You' ? 'You paid' : `${payerName} paid`}, {friendlyDate(bill.bill_date)}
        </ThemedText>
        {editors.length > 0 ? (
          <ThemedText type="small" style={{ color: theme.primary }} numberOfLines={1}>
            {describeEditors(editors)} editing
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.billAmounts}>
        <ThemedText type="money">{formatCents(bill.total_cents)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.tabular}>
          {myShare !== undefined ? `Your share ${formatCents(myShare)}` : 'Not on this bill'}
        </ThemedText>
      </View>
    </Pressable>
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
  live: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  grow: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
  tabular: { fontVariant: ['tabular-nums'] },
  summary: { borderRadius: Radius.medium, padding: Spacing.four, gap: Spacing.one },
  summaryAmount: { fontVariant: ['tabular-nums'] },
  summaryButtons: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  summaryButton: { flexGrow: 1, flexBasis: 0, paddingHorizontal: Spacing.two },
  settleButton: { marginTop: Spacing.two, backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.6)' },
  billRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.medium,
  },
  billAmounts: { alignItems: 'flex-end' },
  people: { gap: Spacing.two },
  member: { borderWidth: 1, borderRadius: Radius.medium, overflow: 'hidden' },
  memberMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  memberText: { flex: 1, gap: Spacing.half },
  memberActions: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  link: { borderWidth: 1, borderRadius: Radius.small, padding: Spacing.three },
  buttonRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
});
