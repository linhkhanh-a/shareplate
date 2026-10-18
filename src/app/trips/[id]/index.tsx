import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BudgetBar } from '@/components/budget-bar';
import { LiveBadge } from '@/components/live-badge';
import { TopBar } from '@/components/top-bar';
import { Avatar, Button, Chip, ChipGroup, Divider, Loading, Notice, Pill, Screen, Section, TextField } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { describeEvent, timeAgo, type TripEvent } from '@/lib/activity';
import { leftOrOver } from '@/lib/budget';
import { planDays } from '@/lib/itinerary';
import { friendlyDate, tripMoney } from '@/lib/ledger';
import { useTripLive } from '@/lib/live';
import { peopleLine, removeMessage, zelleOf } from '@/lib/people';
import { describeEditors } from '@/lib/presence';
import { confirmAction, shareLink, siteUrl } from '@/lib/platform';
import {
  activeMembers,
  inviteUrl,
  useBills,
  usePayments,
  useAddGuest,
  useBringBack,
  useDeleteTrip,
  useInviteToken,
  useLastSeen,
  useMarkSeen,
  useTripEvents,
  useItinerary,
  useLeaveTrip,
  useMembers,
  useRemoveMember,
  useRenameTrip,
  useResetInvite,
  useSetGuestZelle,
  useSetRole,
  useSetTripCurrency,
  useTrip,
  type Bill,
  type Member,
  type Trip,
} from '@/lib/queries';
import { CURRENCIES, formatCents } from '@/money';

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const uid = useAuth().session?.user.id;
  const trip = useTrip(id);
  const members = useMembers(id);
  const bills = useBills(id);
  const payments = usePayments(id);
  const plan = useItinerary(id);

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
          {peopleLine(active)}
        </ThemedText>
      </View>

      <MoneySummary tripId={id} myMemberId={me?.id} memberIds={active.map((m) => m.id)} />

      <WhatsNew tripId={id} me={me} names={names} />

      <PlanTeaser tripId={id} />

      <BudgetTeaser tripId={id} />

      <Section title="Share">
        <ThemedText type="small" themeColor="textSecondary">
          {quick
            ? 'Send each guest their total, or share the whole summary.'
            : 'Send the summary to your group chat, or download a spreadsheet.'}
        </ThemedText>
        <Button
          variant="secondary"
          label="Share and export"
          onPress={() => router.push({ pathname: '/trips/[id]/share', params: { id } })}
        />
      </Section>

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
            <BillRow
              key={b.id}
              tripId={id}
              bill={b}
              payerName={names.get(b.paid_by_member_id) ?? 'Someone'}
              myMemberId={me?.id}
              pinnedTo={b.itinerary_item_id ? plan.data?.find((a) => a.id === b.itinerary_item_id)?.title : undefined}
            />
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
        <FormerMembers tripId={id} members={(members.data ?? []).filter((m) => m.left_at)} canManage={isAdmin} />
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
          label="Add bill"
          accessibilityHint="Upload a receipt or enter a bill by hand"
          onPress={() => router.push({ pathname: '/trips/[id]/add', params: { id: tripId } })}
          style={{ ...styles.summaryButton, backgroundColor: theme.accent, borderColor: theme.accent }}
          textColor={theme.onAccent}
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

/** Recent changes by others, with the ones since your last visit marked. */
function WhatsNew({ tripId, me, names }: { tripId: string; me?: Member; names: Map<string, string> }) {
  const theme = useTheme();
  const events = useTripEvents(tripId);
  const lastSeen = useLastSeen(tripId);
  const markSeen = useMarkSeen(tripId);
  const [showAll, setShowAll] = useState(false);
  const marked = useRef(false);

  // Once we know when you last looked, remember it for this visit and mark the trip as seen.
  const since = lastSeen.isSuccess ? (lastSeen.data ?? me?.joined_at ?? null) : null;
  const ready = lastSeen.isSuccess && !!me;
  const mark = markSeen.mutate;
  useEffect(() => {
    if (!ready || marked.current) return;
    marked.current = true;
    mark();
  }, [ready, mark]);

  // Your own changes aren't news to you, and your own "joined" isn't either.
  const list = (events.data ?? []).filter((e) => e.actor_member_id !== me?.id && e.details.member !== me?.id);
  if (list.length === 0) return null;
  const isNew = (e: TripEvent) => !!since && e.created_at > since;
  const newCount = list.filter(isNew).length;
  const shown = showAll ? list.slice(0, 20) : list.slice(0, Math.max(3, Math.min(newCount, 6)));
  const nameOf = (memberId: string) => names.get(memberId) ?? 'Someone';

  return (
    <Section title="What's new">
      {newCount > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {newCount} {newCount === 1 ? 'change' : 'changes'} since you last looked
        </ThemedText>
      ) : null}
      <View style={[styles.feed, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {shown.map((e, i) => (
          <View
            key={e.id}
            style={[styles.feedRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.border }]}
            accessible
            accessibilityLabel={`${isNew(e) ? 'New: ' : ''}${describeEvent(e, nameOf, me?.id)}, ${timeAgo(e.created_at)}`}>
            <View style={[styles.feedDot, { backgroundColor: isNew(e) ? theme.accent : 'transparent' }]} />
            <View style={styles.grow}>
              <ThemedText type="small" style={isNew(e) ? styles.feedNew : undefined}>
                {describeEvent(e, nameOf, me?.id)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {timeAgo(e.created_at)}
              </ThemedText>
            </View>
          </View>
        ))}
      </View>
      {list.length > shown.length || showAll ? (
        <Button variant="quiet" label={showAll ? 'Show less' : 'Show more'} onPress={() => setShowAll((v) => !v)} />
      ) : null}
    </Section>
  );
}

/** How the trip is tracking against its budget, with the way in. */
function BudgetTeaser({ tripId }: { tripId: string }) {
  const trip = useTrip(tripId);
  const bills = useBills(tripId);
  if (!trip.data || !bills.data) return null;
  const spent = bills.data.reduce((s, b) => s + b.total_cents, 0);
  const budget = trip.data.total_budget_cents;
  return (
    <Section title="Budget">
      {budget > 0 ? (
        <>
          <ThemedText style={styles.tabular}>
            {`${formatCents(spent)} of ${formatCents(budget)} spent. `}
            <ThemedText type="strong" themeColor={spent > budget ? 'danger' : 'text'}>
              {leftOrOver(budget - spent)}
            </ThemedText>
          </ThemedText>
          <BudgetBar value={spent} target={budget} max={Math.max(budget, spent)} />
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          No budget yet. See spending day by day and set daily allowances.
        </ThemedText>
      )}
      <Button
        variant="secondary"
        label="Open the budget"
        onPress={() => router.push({ pathname: '/trips/[id]/budget', params: { id: tripId } })}
      />
    </Section>
  );
}

/** A short look at the trip plan, with the way in. */
function PlanTeaser({ tripId }: { tripId: string }) {
  const trip = useTrip(tripId);
  const plan = useItinerary(tripId);
  if (!trip.data || !plan.data) return null;
  const count = plan.data.length;
  const days = planDays(plan.data, trip.data.start_date, trip.data.end_date).length;
  const summary =
    count === 0
      ? 'Nothing planned yet. Add activities with times, places and a planned budget.'
      : `${count} ${count === 1 ? 'activity' : 'activities'} over ${days} ${days === 1 ? 'day' : 'days'}`;
  return (
    <Section title="Plan">
      <ThemedText type="small" themeColor="textSecondary">
        {summary}
      </ThemedText>
      <Button
        variant="secondary"
        label={count === 0 ? 'Start the trip plan' : 'Open the trip plan'}
        onPress={() => router.push({ pathname: '/trips/[id]/plan', params: { id: tripId } })}
      />
    </Section>
  );
}

function BillRow({
  tripId,
  bill,
  payerName,
  myMemberId,
  pinnedTo,
}: {
  tripId: string;
  bill: Bill;
  payerName: string;
  myMemberId?: string;
  /** The plan activity this bill is pinned to. */
  pinnedTo?: string;
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
        {pinnedTo ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            Plan: {pinnedTo}
          </ThemedText>
        ) : null}
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
  const zelle = zelleOf(member);
  const detail = isGuest
    ? zelle
      ? `Guest · Zelle: ${zelle}`
      : 'Guest, no account'
    : zelle
      ? `Zelle: ${zelle}`
      : 'No Zelle info yet';
  // Admins manage everyone else; your own role changes (stepping down) also live here.
  const manageable = canManage && !(isMe && member.role !== 'admin');
  const error = setRole.error ?? remove.error;

  async function onRemove() {
    const { title, body } = removeMessage(member);
    const ok = await confirmAction(title, body, 'Remove');
    if (ok) remove.mutate(member.id);
  }

  return (
    <View style={[styles.member, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        disabled={!manageable}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole={manageable ? 'button' : undefined}
        accessibilityState={manageable ? { expanded: open } : undefined}
        aria-expanded={manageable ? open : undefined}
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
          {isGuest ? <GuestZelle tripId={tripId} member={member} /> : null}
          {!isMe ? (
            <Button variant="danger" label="Remove from trip" loading={remove.isPending} onPress={onRemove} />
          ) : null}
          {error ? <Notice tone="error">{friendlyError(error)}</Notice> : null}
        </View>
      ) : null}
    </View>
  );
}

/** A guest has no account, so an admin can note where to send them money. */
function GuestZelle({ tripId, member }: { tripId: string; member: Member }) {
  const save = useSetGuestZelle(tripId);
  const [value, setValue] = useState(member.zelle_identifier ?? '');
  const [saved, setSaved] = useState(false);
  const changed = value.trim() !== (member.zelle_identifier ?? '');

  async function onSave() {
    setSaved(false);
    try {
      await save.mutateAsync({ memberId: member.id, zelle: value.trim() || null });
      setSaved(true);
    } catch {
      // Shown below.
    }
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <TextField
        label={`${member.display_name}'s Zelle email or phone`}
        hint="Optional. Shown when someone needs to pay them back."
        value={value}
        onChangeText={(v) => {
          setValue(v);
          setSaved(false);
        }}
        maxLength={254}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Button variant="secondary" label="Save Zelle info" onPress={onSave} loading={save.isPending} disabled={!changed} />
      {saved ? <Notice tone="success">Saved.</Notice> : null}
      {save.isError ? <Notice tone="error">{friendlyError(save.error)}</Notice> : null}
    </View>
  );
}

/** People who left or were removed, so an admin can bring them back. */
function FormerMembers({ tripId, members, canManage }: { tripId: string; members: Member[]; canManage: boolean }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const bringBack = useBringBack(tripId);
  if (members.length === 0) return null;

  async function onBringBack(member: Member) {
    const ok = await confirmAction(
      `Bring ${member.display_name} back?`,
      member.user_id
        ? `${member.display_name} will see this trip again and be back on the list of people.`
        : `${member.display_name} will be back on the list of people.`,
      'Bring back',
    );
    if (ok) bringBack.mutate(member.id);
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <Button
        variant="quiet"
        label={`${open ? 'Hide' : 'Show'} people who left (${members.length})`}
        onPress={() => setOpen((v) => !v)}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
      />
      {open
        ? members.map((m) => (
            <View key={m.id} style={[styles.member, styles.memberMain, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
              <Avatar name={m.display_name} />
              <View style={styles.memberText}>
                <ThemedText type="strong" numberOfLines={1}>
                  {m.display_name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {m.user_id ? 'Left the trip' : 'Guest, removed from the trip'}
                </ThemedText>
              </View>
              {canManage ? (
                <Button
                  variant="secondary"
                  label="Bring back"
                  accessibilityLabel={`Bring ${m.display_name} back`}
                  loading={bringBack.isPending && bringBack.variables === m.id}
                  onPress={() => onBringBack(m)}
                />
              ) : null}
            </View>
          ))
        : null}
      {bringBack.isError ? <Notice tone="error">{friendlyError(bringBack.error)}</Notice> : null}
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
      <CurrencyPicker tripId={trip.id} />
      <Button label="Delete trip" variant="danger" onPress={onDelete} loading={del.isPending} />
      {del.isError ? <Notice tone="error">{friendlyError(del.error)}</Notice> : null}
    </Section>
  );
}

/** The currency amounts are shown in. Nothing is converted: it only changes the sign. */
function CurrencyPicker({ tripId }: { tripId: string }) {
  const trip = useTrip(tripId);
  const set = useSetTripCurrency(tripId);
  const [open, setOpen] = useState(false);
  const current = trip.data?.currency ?? 'USD';
  const name = CURRENCIES.find((c) => c.code === current)?.name ?? current;
  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="strong">Currency</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {`Amounts are shown in ${name} (${current}). Changing it only changes the sign; nothing is converted.`}
      </ThemedText>
      {open ? (
        <ChipGroup label="Show amounts in">
          {CURRENCIES.map((c) => (
            <Chip
              key={c.code}
              label={`${c.code} ${c.symbol.trim()}`}
              selected={current === c.code}
              onPress={() => {
                set.mutate(c.code);
                setOpen(false);
              }}
            />
          ))}
        </ChipGroup>
      ) : (
        <Button variant="secondary" label="Change currency" onPress={() => setOpen(true)} loading={set.isPending} />
      )}
      {set.isError ? <Notice tone="error">{friendlyError(set.error)}</Notice> : null}
    </View>
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
  feed: { borderWidth: 1, borderRadius: Radius.medium, overflow: 'hidden' },
  feedRow: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  feedDot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  feedNew: { fontFamily: Fonts.semibold },
  member: { borderWidth: 1, borderRadius: Radius.medium, overflow: 'hidden' },
  memberMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  memberText: { flex: 1, gap: Spacing.half },
  memberActions: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  link: { borderWidth: 1, borderRadius: Radius.small, padding: Spacing.three },
  buttonRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
});
