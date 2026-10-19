import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Avatar, Button, Loading, Notice, Screen, Section } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { billsCsv, exportSheets, fileSlug } from '@/lib/export';
import { deliverFile, deliverImage } from '@/lib/files';
import { shortDate } from '@/lib/itinerary';
import { hasPayInfo } from '@/lib/pay-apps';
import { payHandlesOf, zelleOf } from '@/lib/people';
import { shareText } from '@/lib/platform';
import { fetchBillItems, useBills, useItinerary, useMembers, usePayments, useTrip } from '@/lib/queries';
import { personMessage, summaryText, tripSummary, type TripSummary } from '@/lib/summary';
import { buildXlsx } from '@/lib/xlsx';
import { currencySymbol, formatCents } from '@/money';

export default function ShareScreen() {
  const { id: tripId } = useLocalSearchParams<{ id: string }>();
  const uid = useAuth().session?.user.id;
  const trip = useTrip(tripId);
  const members = useMembers(tripId);
  const bills = useBills(tripId);
  const payments = usePayments(tripId);
  const plan = useItinerary(tripId);
  const card = useRef<ComponentRef<typeof View>>(null);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loading = trip.isPending || members.isPending || bills.isPending || payments.isPending;
  const error = trip.error ?? members.error ?? bills.error ?? payments.error;
  if (loading || error || !trip.data || !members.data || !bills.data || !payments.data) {
    return (
      <Screen>
        <TopBar />
        {loading ? <Loading /> : <Notice tone="error">{friendlyError(error)}</Notice>}
      </Screen>
    );
  }

  const input = { tripName: trip.data.name, members: members.data, bills: bills.data, payments: payments.data, currency: trip.data.currency };
  const summary = tripSummary(input);
  const me = members.data.find((m) => m.user_id === uid && !m.left_at);
  const myPayInfo = hasPayInfo(zelleOf(me), payHandlesOf(me));
  const owedToMe = summary.transfers.filter((t) => t.toId === me?.id).reduce((sum, t) => sum + t.amount, 0);
  const quick = trip.data.mode === 'quick';
  const slug = fileSlug(trip.data.name);
  const dates =
    trip.data.start_date && trip.data.end_date
      ? `${shortDate(trip.data.start_date)} to ${shortDate(trip.data.end_date)}`
      : null;
  // Guests first in a quick split: they're the ones who need a message.
  const people = [...summary.people].sort((a, b) => Number(b.isGuest) - Number(a.isGuest));

  async function run(label: string, action: () => Promise<string | null>) {
    setBusy(label);
    setStatus(null);
    try {
      const done = await action();
      if (done) setStatus({ tone: 'success', text: done });
    } catch (e) {
      setStatus({ tone: 'error', text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  const shareImage = () =>
    run('image', async () => {
      const uri = await captureRef(card, {
        format: 'png',
        quality: 1,
        result: Platform.OS === 'web' ? 'data-uri' : 'tmpfile',
      });
      await deliverImage(uri, `${slug}-summary.png`);
      return Platform.OS === 'web' ? 'Image ready. If it downloaded, attach it to your group chat.' : null;
    });

  const shareMessage = (text: string, label: string) =>
    run(label, async () => ((await shareText(text)) === 'copied' ? 'Copied. Paste it into your group chat.' : null));

  const exportXlsx = () =>
    run('xlsx', async () => {
      const items = await fetchBillItems(bills.data!.filter((b) => b.split_mode === 'itemized').map((b) => b.id));
      const bytes = buildXlsx(exportSheets({ ...input, activities: plan.data ?? [], items }), currencySymbol());
      await deliverFile(
        `${slug}.xlsx`,
        bytes,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'org.openxmlformats.spreadsheetml.sheet',
      );
      return Platform.OS === 'web' ? 'Downloaded. Open it in Excel or Numbers, or import it into Google Sheets.' : null;
    });

  const exportCsv = () =>
    run('csv', async () => {
      const csv = billsCsv({ ...input, activities: plan.data ?? [], items: new Map() });
      await deliverFile(`${slug}-bills.csv`, csv, 'text/csv', 'public.comma-separated-values-text');
      return Platform.OS === 'web' ? 'Downloaded.' : null;
    });

  return (
    <Screen>
      <TopBar />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="title" accessibilityRole="header">
          Share and export
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          {quick
            ? 'Send each guest what they owe, or share the whole trip.'
            : 'Send the trip summary to your group chat, or download a spreadsheet.'}
        </ThemedText>
      </View>

      {status ? <Notice tone={status.tone}>{status.text}</Notice> : null}

      {owedToMe > 0 && !myPayInfo ? (
        <Notice>
          <ThemedText type="strong">Add how to pay you first</ThemedText>
          <ThemedText type="small">
            {`People owe you ${formatCents(owedToMe)}. Add your Zelle, Venmo, PayPal or Cash App so the messages tell them where to send it.`}
          </ThemedText>
          <Button variant="secondary" label="Add payment info" onPress={() => router.push('/profile')} />
        </Notice>
      ) : null}

      <Section title="Summary">
        <View ref={card} collapsable={false}>
          <SummaryCard summary={summary} dates={dates} />
        </View>
        <View style={styles.row}>
          <Button label="Share image" onPress={shareImage} loading={busy === 'image'} style={styles.grow} />
          <Button
            variant="secondary"
            label={Platform.OS === 'web' ? 'Copy as text' : 'Share as text'}
            onPress={() => shareMessage(summaryText(summary), 'text')}
            loading={busy === 'text'}
            style={styles.grow}
          />
        </View>
      </Section>

      <Section title="Message each person">
        <ThemedText type="small" themeColor="textSecondary">
          A short note with their share and who to pay, with Zelle info and one-tap Venmo, PayPal or Cash App links when there are some.
        </ThemedText>
        <View style={{ gap: Spacing.two }}>
          {people.map((p) => {
            const pays = summary.transfers.filter((t) => t.fromId === p.id).reduce((s, t) => s + t.amount, 0);
            const gets = summary.transfers.filter((t) => t.toId === p.id).reduce((s, t) => s + t.amount, 0);
            const line = pays > 0 ? `Owes ${formatCents(pays)}` : gets > 0 ? `Is owed ${formatCents(gets)}` : 'Settled up, nothing to pay';
            const name = p.id === me?.id ? `${p.name} (you)` : p.isGuest ? `${p.name} (guest)` : p.name;
            return (
              <PersonRow
                key={p.id}
                name={name}
                avatarName={p.name}
                line={`Share ${formatCents(p.share)} · ${line}`}
                onSend={() => shareMessage(personMessage(summary, p.id, me?.id), `person-${p.id}`)}
                loading={busy === `person-${p.id}`}
                webCopy={Platform.OS === 'web'}
              />
            );
          })}
        </View>
      </Section>

      <Section title="Spreadsheet">
        <ThemedText type="small" themeColor="textSecondary">
          The Excel file has every bill with each person&apos;s share, scanned items, people, payments and how to settle
          up. It opens in Excel and Numbers, and Google Sheets can import it (File, Import). The CSV has just the bills.
        </ThemedText>
        <View style={styles.row}>
          <Button label="Excel file" onPress={exportXlsx} loading={busy === 'xlsx'} style={styles.grow} />
          <Button variant="secondary" label="CSV" onPress={exportCsv} loading={busy === 'csv'} style={styles.grow} />
        </View>
      </Section>
    </Screen>
  );
}

/** The card people screenshot into the group chat. */
function SummaryCard({ summary: s, dates }: { summary: TripSummary; dates: string | null }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.cardTop, { backgroundColor: theme.primary }]}>
        <ThemedText type="small" style={{ color: theme.onPrimary, opacity: 0.85, fontFamily: Fonts.semibold }}>
          SHAREPLATE
        </ThemedText>
        <ThemedText type="heading" style={{ color: theme.onPrimary }}>
          {s.tripName}
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.onPrimary, opacity: 0.85 }}>
          {[dates, `${s.billCount} ${s.billCount === 1 ? 'bill' : 'bills'}`].filter(Boolean).join(' · ')}
        </ThemedText>
        <ThemedText type="display" style={[styles.tabular, { color: theme.onPrimary }]}>
          {formatCents(s.total)}
        </ThemedText>
      </View>

      <View style={styles.cardBody}>
        <ThemedText type="strong">Each person&apos;s share</ThemedText>
        {s.people.map((p) => (
          <View key={p.id} style={styles.line}>
            <ThemedText style={styles.grow} numberOfLines={1}>
              {p.name}
            </ThemedText>
            <ThemedText style={styles.tabular}>{formatCents(p.share)}</ThemedText>
          </View>
        ))}

        <View style={[styles.rule, { backgroundColor: theme.border }]} />

        <ThemedText type="strong">To settle up</ThemedText>
        {s.transfers.length === 0 ? (
          <ThemedText themeColor="textSecondary">Everyone&apos;s settled up.</ThemedText>
        ) : (
          s.transfers.map((t) => (
            <View key={`${t.fromId}-${t.toId}`} style={{ gap: Spacing.half }}>
              <View style={styles.line}>
                <ThemedText style={styles.grow}>
                  {t.fromName} → {t.toName}
                </ThemedText>
                <ThemedText type="strong" style={styles.tabular}>
                  {formatCents(t.amount)}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                Zelle: {t.toZelle ?? 'not added yet'}
              </ThemedText>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function PersonRow({
  name,
  avatarName,
  line,
  onSend,
  loading,
  webCopy,
}: {
  name: string;
  avatarName: string;
  line: string;
  onSend: () => void;
  loading: boolean;
  webCopy: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.person, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Avatar name={avatarName} size={36} />
      <View style={styles.grow}>
        <ThemedText type="strong" numberOfLines={1}>
          {name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.tabular}>
          {line}
        </ThemedText>
      </View>
      <Button
        variant="quiet"
        label={webCopy ? 'Copy message' : 'Send'}
        accessibilityLabel={`${webCopy ? 'Copy message for' : 'Send message to'} ${avatarName}`}
        onPress={onSend}
        loading={loading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
  tabular: { fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  card: { borderWidth: 1, borderRadius: Radius.medium, overflow: 'hidden' },
  cardTop: { padding: Spacing.four, gap: Spacing.one },
  cardBody: { padding: Spacing.four, gap: Spacing.two },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rule: { height: 1, marginVertical: Spacing.two },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.medium,
  },
});
