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
import { friendlyDate, tripMoney } from '@/lib/ledger';
import { confirmAction, copyText } from '@/lib/platform';
import {
  useBills,
  useDeletePayment,
  useMembers,
  usePayments,
  useRecordPayment,
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
  const me = all.find((m) => m.user_id === uid);
  const money = tripMoney(bills.data ?? [], payments.data ?? [], all.filter((m) => !m.left_at).map((m) => m.id));
  const name = (id: string) => (id === me?.id ? 'You' : (byId.get(id)?.display_name ?? 'Someone'));

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
            <View style={styles.list}>
              {payments.data.map((p) => (
                <PaymentRow key={p.id} tripId={tripId} payment={p} fromName={name(p.from_member_id)} toName={name(p.to_member_id)} />
              ))}
            </View>
          </Section>
        </>
      ) : null}
    </Screen>
  );
}

function TransferCard({
  tripId,
  transfer,
  fromName,
  toName,
  recipient,
  mine,
}: {
  tripId: string;
  transfer: Transfer;
  fromName: string;
  toName: string;
  recipient?: Member;
  mine: boolean;
}) {
  const theme = useTheme();
  const record = useRecordPayment(tripId);
  const [copied, setCopied] = useState(false);
  const zelle = recipient?.profile?.zelle_identifier;
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
            : `${toName} is a guest, so pay them however you usually do.`}
        </ThemedText>
      )}

      <Button label="Mark as paid" variant="secondary" onPress={onPaid} loading={record.isPending} />
      {record.isError ? <Notice tone="error">{friendlyError(record.error)}</Notice> : null}
    </View>
  );
}

function PaymentRow({
  tripId,
  payment,
  fromName,
  toName,
}: {
  tripId: string;
  payment: Payment;
  fromName: string;
  toName: string;
}) {
  const undo = useDeletePayment(tripId);

  async function onUndo() {
    const ok = await confirmAction(
      'Undo this payment?',
      `Removes the record of ${fromName === 'You' ? 'you' : fromName} paying ${toName === 'You' ? 'you' : toName} ${formatCents(payment.amount_cents)}. Balances go back to before it.`,
      'Undo payment',
    );
    if (ok) undo.mutate(payment.id);
  }

  return (
    <View style={{ gap: Spacing.one }}>
      <View style={styles.balanceRow}>
        <View style={styles.grow}>
          <ThemedText numberOfLines={1}>
            {fromName} paid {toName === 'You' ? 'you' : toName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {friendlyDate(payment.settled_on)}
          </ThemedText>
        </View>
        <ThemedText type="money">{formatCents(payment.amount_cents)}</ThemedText>
        <Button variant="quiet" label="Undo" onPress={onUndo} loading={undo.isPending} />
      </View>
      {undo.isError ? <Notice tone="error">{friendlyError(undo.error)}</Notice> : null}
    </View>
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
});
