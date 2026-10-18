import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Avatar, Button, Divider, Loading, Notice, Screen, Section } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { describeEvent, timeAgo } from '@/lib/activity';
import { friendlyDate, todayIso, tripMoney } from '@/lib/ledger';
import { canRemovePayment, formerWithBalance, settleTiming, zelleOf } from '@/lib/people';
import { confirmAction, copyText } from '@/lib/platform';
import {
  useBills,
  useBringBack,
  useDeletePayment,
  useMembers,
  usePayments,
  useRecordPayment,
  useRemovedPayments,
  useTrip,
  type Member,
  type Payment,
} from '@/lib/queries';
import { formatCents, type Transfer } from '@/money';

export default function SettleScreen() {
  const { id: tripId } = useLocalSearchParams<{ id: string }>();
  const uid = useAuth().session?.user.id;
  const members = useMembers(tripId);
  const bills = useBills(tripId);
  const payments = usePayments(tripId);
  const trip = useTrip(tripId);
  const removed = useRemovedPayments(tripId);
  // Kept here rather than in each row: the row disappears while removing, and
  // if the database refuses, the reason still needs somewhere to show.
  const removePayment = useDeletePayment(tripId);

  const loading = members.isPending || bills.isPending || payments.isPending;
  const error = members.error ?? bills.error ?? payments.error;

  if (loading || error) {
    return (
      <Screen>
        <TopBar />
        {loading ? <Loading /> : <Notice tone="error">{friendlyError(error)}</Notice>}
      </Screen>
    );
  }

  const all = members.data ?? [];
  const byId = new Map(all.map((m) => [m.id, m]));
  const me = all.find((m) => m.user_id === uid && !m.left_at);
  const isAdmin = me?.role === 'admin';
  const money = tripMoney(bills.data ?? [], payments.data ?? [], all.filter((m) => !m.left_at).map((m) => m.id));
  const name = (id: string) => (id === me?.id ? 'You' : (byId.get(id)?.display_name ?? 'Someone'));
  const left = (id: string) => !!byId.get(id)?.left_at;
  // Only trips from before former members were locked at $0 can have these.
  const stranded = formerWithBalance(all, money.balances);
  const timing = settleTiming(trip.data?.end_date ?? null, todayIso());

  // Your own payments first, then the rest.
  const transfers = [...money.transfers].sort(
    (a, b) => Number(b.fromId === me?.id || b.toId === me?.id) - Number(a.fromId === me?.id || a.toId === me?.id),
  );

  return (
    <Screen>
      <TopBar />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="title" accessibilityRole="header">
          Settle up
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          The fewest payments that get everyone back to $0.00.
        </ThemedText>
      </View>

      {timing === 'during' && transfers.length > 0 ? (
        <Notice>
          <ThemedText type="strong">The trip isn&apos;t over yet</ThemedText>
          <ThemedText type="small">
            Amounts change as bills are added. Settling now is fine: any later bills just add new, smaller payments.
          </ThemedText>
        </Notice>
      ) : timing === 'over' && transfers.length > 0 ? (
        <Notice tone="success">
          <ThemedText type="strong">The trip&apos;s over, time to settle up</ThemedText>
          <ThemedText type="small">Here are the fewest payments that clear everything.</ThemedText>
        </Notice>
      ) : null}

      {stranded.length > 0 ? (
        <StrandedNotice tripId={tripId} people={stranded} canManage={isAdmin} />
      ) : null}

      {transfers.length === 0 ? (
        <Notice tone="success">
          <ThemedText type="strong">Everyone&apos;s settled up</ThemedText>
          <ThemedText type="small">Nobody owes anybody anything right now.</ThemedText>
        </Notice>
      ) : (
        <View style={styles.list}>
          {transfers.map((t) => (
            <TransferCard
              key={`${t.fromId}-${t.toId}`}
              tripId={tripId}
              transfer={t}
              fromName={name(t.fromId)}
              toName={name(t.toId)}
              leftNote={[t.fromId, t.toId].filter(left).map(name)}
              recipient={byId.get(t.toId)}
              mine={t.fromId === me?.id || t.toId === me?.id}
            />
          ))}
        </View>
      )}

      <Section title="Balances">
        <View style={styles.list}>
          {[...money.balances.entries()]
            // People who left (always at $0.00) don't need a row.
            .filter(([memberId, cents]) => cents !== 0 || !byId.get(memberId)?.left_at)
            .sort((a, b) => b[1] - a[1])
            .map(([memberId, cents]) => (
              <View key={memberId} style={styles.balanceRow}>
                <Avatar name={byId.get(memberId)?.display_name ?? '?'} size={32} />
                <ThemedText style={styles.grow} numberOfLines={1}>
                  {name(memberId)}
                  {left(memberId) ? <ThemedText type="small" themeColor="textSecondary"> (left the trip)</ThemedText> : null}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {cents > 0 ? (memberId === me?.id ? 'are owed' : 'is owed') : cents < 0 ? (memberId === me?.id ? 'owe' : 'owes') : 'settled'}
                </ThemedText>
                <ThemedText type="money" style={styles.amount}>
                  {formatCents(Math.abs(cents))}
                </ThemedText>
              </View>
            ))}
        </View>
      </Section>

      {payments.data && payments.data.length > 0 ? (
        <>
          <Divider />
          <Section title="Payments recorded">
            {removePayment.isError ? <Notice tone="error">{friendlyError(removePayment.error)}</Notice> : null}
            <View style={styles.list}>
              {payments.data.map((p) => (
                <PaymentRow
                  key={p.id}
                  payment={p}
                  fromName={name(p.from_member_id)}
                  toName={name(p.to_member_id)}
                  canRemove={canRemovePayment(p, me, uid)}
                  onRemove={() => removePayment.mutate(p.id)}
                  removing={removePayment.isPending && removePayment.variables === p.id}
                />
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Only the payer, the receiver, whoever recorded a payment, or an admin can remove it.
            </ThemedText>
          </Section>
        </>
      ) : null}

      {removed.data && removed.data.length > 0 ? (
        <Section title="Removed payments">
          <View style={styles.list}>
            {removed.data.map((e) => (
              <View key={e.id} style={styles.removedRow}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
                  {describeEvent(e, (memberId) => byId.get(memberId)?.display_name ?? 'Someone', me?.id)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {timeAgo(e.created_at)}
                </ThemedText>
              </View>
            ))}
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}

function TransferCard({
  tripId,
  transfer,
  fromName,
  toName,
  leftNote,
  recipient,
  mine,
}: {
  tripId: string;
  transfer: Transfer;
  fromName: string;
  toName: string;
  /** Names of people in this payment who have left the trip. */
  leftNote: string[];
  recipient?: Member;
  mine: boolean;
}) {
  const theme = useTheme();
  const record = useRecordPayment(tripId);
  const [copied, setCopied] = useState(false);
  const zelle = zelleOf(recipient);
  const verb = fromName === 'You' ? 'pay' : 'pays';

  async function onPaid() {
    const ok = await confirmAction(
      'Mark as paid?',
      `This records that ${fromName === 'You' ? 'you' : fromName} paid ${toName === 'You' ? 'you' : toName} ${formatCents(transfer.amountCents)}. Balances update for everyone.`,
      'Mark as paid',
    );
    if (ok) {
      record.mutate({
        from_member_id: transfer.fromId,
        to_member_id: transfer.toId,
        amount_cents: transfer.amountCents,
      });
    }
  }

  async function onCopy() {
    if (!zelle) return;
    try {
      if ((await copyText(zelle)) === 'copied') setCopied(true);
    } catch {
      // Copying is a convenience; the number is still shown on screen.
    }
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: mine ? theme.primary : theme.border, borderWidth: mine ? 2 : 1 },
      ]}>
      <View style={styles.cardTop}>
        <ThemedText style={styles.grow}>
          <ThemedText type="strong">{fromName}</ThemedText> {verb} <ThemedText type="strong">{toName}</ThemedText>
        </ThemedText>
        <ThemedText type="money" style={styles.bigAmount}>
          {formatCents(transfer.amountCents)}
        </ThemedText>
      </View>

      {zelle ? (
        <View style={[styles.zelle, { backgroundColor: theme.surfaceMuted }]}>
          <View style={styles.grow}>
            <ThemedText type="small" themeColor="textSecondary">
              {toName === 'You' ? 'Your' : `${toName}'s`} Zelle
            </ThemedText>
            <ThemedText type="strong" selectable>
              {zelle}
            </ThemedText>
          </View>
          <Button variant="quiet" label={copied ? 'Copied' : 'Copy'} onPress={onCopy} />
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {recipient?.user_id
            ? `${toName} hasn't added Zelle info yet. Pay them however you usually do.`
            : `${toName} is a guest with no Zelle info yet. A trip admin can add it under People, or pay them however you usually do.`}
        </ThemedText>
      )}

      {leftNote.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {leftNote.join(' and ')} left the trip. Bring them back above before recording this.
        </ThemedText>
      ) : null}
      <Button label="Mark as paid" variant="secondary" onPress={onPaid} loading={record.isPending} />
      {record.isError ? <Notice tone="error">{friendlyError(record.error)}</Notice> : null}
    </View>
  );
}

function PaymentRow({
  payment,
  fromName,
  toName,
  canRemove,
  onRemove: remove,
  removing,
}: {
  payment: Payment;
  fromName: string;
  toName: string;
  canRemove: boolean;
  onRemove: () => void;
  removing: boolean;
}) {
  const from = fromName === 'You' ? 'you' : fromName;
  const to = toName === 'You' ? 'you' : toName;

  async function onRemove() {
    const ok = await confirmAction(
      'Remove this payment?',
      `This removes the record of ${from} paying ${to} ${formatCents(payment.amount_cents)}. Balances go back to before it, and the removal is listed under Removed payments.`,
      'Remove payment',
    );
    if (ok) remove();
  }

  return (
    <View style={{ gap: Spacing.one }}>
      <View style={styles.balanceRow}>
        <View style={styles.grow}>
          <ThemedText numberOfLines={1}>
            {fromName} paid {to}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {friendlyDate(payment.settled_on)}
          </ThemedText>
        </View>
        <ThemedText type="money">{formatCents(payment.amount_cents)}</ThemedText>
        {payment.id.startsWith('pending-') ? (
          <ThemedText type="small" themeColor="textSecondary">
            Saving
          </ThemedText>
        ) : canRemove ? (
          <Button
            variant="quiet"
            label="Remove"
            accessibilityLabel={`Remove the payment of ${fromName} paying ${toName}`}
            onPress={onRemove}
            loading={removing}
          />
        ) : null}
      </View>
    </View>
  );
}

/** People who left the trip with money still on them (older trips only), and a way to fix it. */
function StrandedNotice({
  tripId,
  people,
  canManage,
}: {
  tripId: string;
  people: { member: Member; balance: number }[];
  canManage: boolean;
}) {
  const bringBack = useBringBack(tripId);
  const names = people.map((p) => p.member.display_name);
  return (
    <Notice tone="error">
      <ThemedText type="strong">
        {names.join(' and ')} left the trip but {people.length === 1 ? 'still has' : 'still have'} money on them
      </ThemedText>
      <ThemedText type="small">
        {canManage
          ? 'Bring them back to settle up. You can remove them again once they are at $0.00.'
          : 'Ask a trip admin to bring them back so everyone can settle up.'}
      </ThemedText>
      {people.map(({ member, balance }) => (
        <View key={member.id} style={styles.balanceRow}>
          <ThemedText style={styles.grow} numberOfLines={1}>
            {member.display_name} {balance > 0 ? 'is owed' : 'owes'} {formatCents(Math.abs(balance))}
          </ThemedText>
          {canManage ? (
            <Button
              variant="secondary"
              label="Bring back"
              accessibilityLabel={`Bring ${member.display_name} back`}
              loading={bringBack.isPending && bringBack.variables === member.id}
              onPress={() => bringBack.mutate(member.id)}
            />
          ) : null}
        </View>
      ))}
      {bringBack.isError ? <ThemedText type="small">{friendlyError(bringBack.error)}</ThemedText> : null}
    </Notice>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  grow: { flex: 1, minWidth: 0 },
  card: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.three },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  bigAmount: { fontSize: 22, lineHeight: 28 },
  zelle: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.small,
    paddingLeft: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 40 },
  amount: { minWidth: 72, textAlign: 'right' },
  removedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
