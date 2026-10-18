import { Redirect, router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BillEndActions, returnToTrip } from '@/components/bill-end-actions';
import { DateField } from '@/components/date-field';
import { FormerOnBillNotice } from '@/components/former-on-bill';
import { PlanPicker } from '@/components/plan-picker';
import { TopBar } from '@/components/top-bar';
import {
  Avatar,
  Button,
  Checkbox,
  Chip,
  ChipGroup,
  Loading,
  Notice,
  Screen,
  Section,
  Segmented,
  TextField,
} from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import {
  CATEGORIES,
  computeSplit,
  isValidIsoDate,
  shareInputText,
  todayIso,
  type ManualMode,
  type SplitRow,
} from '@/lib/ledger';
import { useTripLive } from '@/lib/live';
import { dateChoices } from '@/lib/dates';
import { withShares } from '@/lib/impact';
import { useBillImpact } from '@/lib/use-bill-impact';
import { formerOnBill } from '@/lib/people';
import { confirmAction } from '@/lib/platform';
import { describeEditors } from '@/lib/presence';
import { useBills, useMembers, usePinBill, useSaveBill, useTrip, type Bill, type Member } from '@/lib/queries';
import { centsToText, currencySymbol, formatCents, normalizeMoneyText, normalizePercentText } from '@/money';

/** Back to the trip, even when the bill was opened directly from a link. */
const MODES: { value: ManualMode; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'percent', label: 'By percent' },
  { value: 'exact', label: 'Exact amounts' },
];

export default function BillScreen() {
  const { id: tripId, billId, pin } = useLocalSearchParams<{ id: string; billId?: string; pin?: string }>();
  const members = useMembers(tripId);
  const bills = useBills(tripId);
  const uid = useAuth().session?.user.id;

  const existing = billId ? bills.data?.find((b) => b.id === billId) : undefined;
  // Bumped to reload the form with the latest saved version.
  const [formKey, setFormKey] = useState(0);

  if (members.isPending || (billId && bills.isPending)) {
    return (
      <Screen>
        <TopBar />
        <Loading />
      </Screen>
    );
  }
  if (members.isError || bills.isError) {
    return (
      <Screen>
        <TopBar />
        <Notice tone="error">{friendlyError(members.error ?? bills.error)}</Notice>
      </Screen>
    );
  }
  if (existing?.split_mode === 'itemized') {
    // Scanned bills are edited item by item in the scan screen.
    return <Redirect href={{ pathname: '/trips/[id]/scan', params: { id: tripId, billId: existing.id } }} />;
  }
  if (billId && !existing) {
    return (
      <Screen>
        <TopBar />
        <Notice tone="error">This bill was deleted.</Notice>
      </Screen>
    );
  }

  return (
    <BillForm
      key={`${existing?.id ?? 'new'}-${formKey}`}
      onReload={() => setFormKey((k) => k + 1)}
      tripId={tripId}
      members={members.data ?? []}
      existing={existing}
      myMemberId={members.data?.find((m) => m.user_id === uid)?.id}
      pinTo={pin}
    />
  );
}

function BillForm({
  tripId,
  members,
  existing,
  myMemberId,
  onReload,
  pinTo,
}: {
  tripId: string;
  members: Member[];
  existing?: Bill;
  myMemberId?: string;
  onReload: () => void;
  /** Pins a new bill to this plan activity (when added from the activity). */
  pinTo?: string;
}) {
  const theme = useTheme();
  const { setEditing, editorsOf } = useTripLive();
  // The version this form started from. If someone saves a newer one meanwhile,
  // saving refuses rather than overwriting their change.
  const [openedVersion] = useState(existing?.version);
  const newerVersionSaved = !!existing && openedVersion !== undefined && existing.version > openedVersion;
  const existingId = existing?.id;
  useEffect(() => {
    if (!existingId) return;
    setEditing(existingId);
    return () => setEditing(null);
  }, [existingId, setEditing]);
  const otherEditors = existingId ? editorsOf(existingId) : [];
  const isAdmin = members.some((m) => m.id === myMemberId && m.role === 'admin' && !m.left_at);
  // People on this bill who have left the trip: their share is locked until they're brought back.
  const former = existing ? formerOnBill(members, existing) : [];
  const save = useSaveBill(tripId);
  const impact = useBillImpact(tripId, myMemberId);
  const pin = usePinBill(tripId);
  const [activityId, setActivityId] = useState<string | null>(existing ? existing.itinerary_item_id : (pinTo ?? null));
  const editable = !existing || existing.split_mode !== 'itemized';

  // People who can be on the bill: everyone still in the trip, plus anyone already on it.
  const people = useMemo(() => {
    const onBill = new Set([
      ...(existing?.shares.map((s) => s.group_member_id) ?? []),
      ...(existing ? [existing.paid_by_member_id] : []),
    ]);
    return members.filter((m) => !m.left_at || onBill.has(m.id));
  }, [members, existing]);

  const initialMode: ManualMode =
    existing && existing.split_mode !== 'itemized' ? (existing.split_mode as ManualMode) : 'equal';

  const [title, setTitle] = useState(existing?.title ?? '');
  const [amount, setAmount] = useState(existing ? centsToText(existing.total_cents) : '');
  const [payer, setPayer] = useState(existing?.paid_by_member_id ?? myMemberId ?? people[0]?.id ?? '');
  const [date, setDate] = useState(existing?.bill_date ?? todayIso());
  const [category, setCategory] = useState(existing?.category ?? 'Food');
  const [mode, setMode] = useState<ManualMode>(initialMode);
  const [rows, setRows] = useState<SplitRow[]>(() =>
    people.map((m) => {
      const share = existing?.shares.find((s) => s.group_member_id === m.id);
      return {
        memberId: m.id,
        included: existing ? !!share : !m.left_at,
        input: share ? shareInputText(initialMode, share.share_input) : '',
      };
    }),
  );
  const [attempted, setAttempted] = useState(false);
  const trip = useTrip(tripId);
  const dateOptions = dateChoices(trip.data?.start_date ?? null, trip.data?.end_date ?? null);

  // Ask before leaving with unsaved changes.
  const [startState] = useState(() => JSON.stringify({ title, amount, payer, date, category, mode, rows }));
  const dirty = JSON.stringify({ title, amount, payer, date, category, mode, rows }) !== startState;
  const [left, setLeft] = useState(false);
  const allowLeave = usePreventRemove(dirty && !left, ({ repeat }) => {
    confirmAction('Leave this bill?', "What you typed won't be saved.", 'Leave').then((ok) => {
      if (!ok) return;
      setLeft(true);
      repeat();
    });
  });
  function leaving() {
    setLeft(true);
    allowLeave();
  }

  const split = computeSplit(mode, amount, rows);
  const dateOk = isValidIsoDate(date);
  const shareFor = (memberId: string) => (split.ok ? split.shares.find((s) => s.memberId === memberId) : undefined);
  const nameOf = (memberId: string) => people.find((m) => m.id === memberId)?.display_name ?? 'Someone';

  function updateRow(memberId: string, change: Partial<SplitRow>) {
    setRows((prev) => prev.map((r) => (r.memberId === memberId ? { ...r, ...change } : r)));
  }

  function changeMode(next: ManualMode) {
    // Inputs mean different things in each mode, so start them fresh.
    setMode(next);
    setRows((prev) => prev.map((r) => ({ ...r, input: '' })));
  }

  async function onSave() {
    setAttempted(true);
    if (!split.ok || !dateOk || !payer) return;
    // Once people have paid, an edit can mean money going back: say so first.
    if (existing && impact.hasPayments) {
      const preview = impact.describe(existing.id, withShares(existing, payer, split.shares));
      if (preview && preview.changes > 0 && !(await confirmAction('Save these changes?', preview.text, 'Save changes'))) return;
    }
    let savedId: string;
    try {
      savedId = await save.mutateAsync({
        id: existing?.id,
        expected_version: openedVersion,
        group_id: tripId,
        paid_by_member_id: payer,
        title: title.trim(),
        category,
        split_mode: mode,
        total_cents: split.shares.reduce((sum, s) => sum + s.amountCents, 0),
        bill_date: date,
        participants: split.shares.map((s) => ({
          member_id: s.memberId,
          share_input: s.shareInput,
          amount_cents: s.amountCents,
        })),
      });
    } catch {
      // Shown below from save.error.
      return;
    }
    leaving();
    try {
      if (activityId !== (existing?.itinerary_item_id ?? null)) await pin.mutateAsync({ billId: savedId, activityId });
      returnToTrip(tripId);
    } catch {
      // Shown below from pin.error; the bill itself is saved.
    }
  }

  const footer = editable ? (
    <View style={{ gap: Spacing.two }}>
      {save.isError ? <Notice tone="error">{friendlyError(save.error)}</Notice> : null}
      {pin.isError ? (
        <Notice tone="error">{`The bill is saved, but pinning it to the plan didn't work. ${friendlyError(pin.error)}`}</Notice>
      ) : null}
      {attempted && !split.ok ? <Notice tone="error">{split.message}</Notice> : null}
      <Button label={existing ? 'Save changes' : 'Add bill'} onPress={onSave} loading={save.isPending} />
    </View>
  ) : undefined;

  return (
    <Screen footer={footer}>
      <TopBar />
      <ThemedText type="title" accessibilityRole="header">
        {existing ? 'Edit bill' : 'New bill'}
      </ThemedText>

      {!existing ? (
        <Segmented
          label="How to enter it"
          options={[
            { value: 'total', label: 'One total' },
            { value: 'items', label: 'By item' },
          ]}
          value="total"
          onChange={async (v) => {
            if (v !== 'items') return;
            if (dirty && !(await confirmAction('Switch to by item?', "What you typed here won't be kept.", 'Switch'))) return;
            leaving();
            router.replace({
              pathname: '/trips/[id]/scan',
              params: pinTo ? { id: tripId, pin: pinTo, manual: '1' } : { id: tripId, manual: '1' },
            });
          }}
        />
      ) : null}

      <FormerOnBillNotice tripId={tripId} people={former} canManage={isAdmin} />

      {!editable ? <Notice>Scanned bills will be editable from the receipt screen in a later update.</Notice> : null}

      {newerVersionSaved ? (
        <Notice tone="error">
          <ThemedText type="strong">Someone just saved changes to this bill</ThemedText>
          <ThemedText type="small">
            Your edits are based on the older version, so saving them won&apos;t work. Load the latest version to
            see their changes, then edit again.
          </ThemedText>
          <Button label="Load latest version" variant="secondary" onPress={onReload} />
        </Notice>
      ) : otherEditors.length > 0 ? (
        <Notice>
          {`${describeEditors(otherEditors)} also editing this bill. If they save first, you'll be asked to load their version.`}
        </Notice>
      ) : null}

      <TextField
        label="What was it for?"
        placeholder="Dinner at Phở 24"
        value={title}
        onChangeText={setTitle}
        maxLength={120}
        editable={editable}
      />

      <View style={styles.amountBlock}>
        <ThemedText type="strong">Amount</ThemedText>
        <View style={[styles.amountBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ThemedText style={[styles.amountText, { color: theme.textSecondary }]}>{currencySymbol().trim()}</ThemedText>
          <TextInput
            accessibilityLabel="Amount"
            value={amount}
            onChangeText={(t) => setAmount(t.replace(/[^0-9.,]/g, ''))}
            // Rounded to the cent as soon as you leave the box, so what you see is what's saved.
            onBlur={() => setAmount((a) => normalizeMoneyText(a) ?? a)}
            placeholder="0.00"
            placeholderTextColor={theme.textSecondary}
            keyboardType="decimal-pad"
            inputMode="decimal"
            editable={editable}
            style={[styles.amountText, styles.amountInput, { color: theme.text }]}
          />
        </View>
      </View>

      <ChipGroup label="Paid by">
        {people
          .filter((m) => !m.left_at || m.id === payer)
          .map((m) => (
            <Chip
              key={m.id}
              label={m.id === myMemberId ? 'You' : m.display_name}
              selected={payer === m.id}
              onPress={() => editable && setPayer(m.id)}
            />
          ))}
      </ChipGroup>

      <DateField label="Date" value={date} onChange={setDate} choices={dateOptions} editable={editable} />

      <ChipGroup label="Category">
        {CATEGORIES.map((c) => (
          <Chip key={c} label={c} selected={category === c} onPress={() => editable && setCategory(c)} />
        ))}
      </ChipGroup>

      <PlanPicker tripId={tripId} billDate={date} value={activityId} onChange={(v) => editable && setActivityId(v)} />

      <Section title="Split">
        {editable ? <Segmented label="How to split" options={MODES} value={mode} onChange={changeMode} /> : null}
        <View style={styles.people}>
          {people.map((m) => {
            const row = rows.find((r) => r.memberId === m.id)!;
            const share = shareFor(m.id);
            return (
              <View key={m.id} style={[styles.person, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: row.included }}
                  aria-checked={row.included}
                  accessibilityLabel={`Include ${m.display_name}`}
                  disabled={!editable}
                  onPress={() => updateRow(m.id, { included: !row.included })}
                  style={styles.personMain}>
                  <Checkbox checked={row.included} label={m.display_name} />
                  {mode === 'equal' ? <Avatar name={m.display_name} size={32} /> : null}
                  <ThemedText style={styles.personName} numberOfLines={1}>
                    {m.id === myMemberId ? `${m.display_name} (you)` : m.display_name}
                  </ThemedText>
                </Pressable>
                {mode !== 'equal' && row.included ? (
                  <View style={[styles.shareInput, { borderColor: theme.border, backgroundColor: theme.background }]}>
                    {mode === 'exact' ? <ThemedText themeColor="textSecondary">{currencySymbol().trim()}</ThemedText> : null}
                    <TextInput
                      accessibilityLabel={`${m.display_name}'s ${mode === 'percent' ? 'percentage' : 'amount'}`}
                      value={row.input}
                      onChangeText={(t) => updateRow(m.id, { input: t.replace(/[^0-9.,]/g, '') })}
                      onBlur={() => {
                        const normal = mode === 'percent' ? normalizePercentText(row.input) : normalizeMoneyText(row.input);
                        if (normal !== null && normal !== row.input) updateRow(m.id, { input: normal });
                      }}
                      // Left blank, it shows the rest of the bill in grey: that's filled in automatically.
                      placeholder={split.auto[m.id] ?? (mode === 'percent' ? '0' : '0.00')}
                      placeholderTextColor={theme.textSecondary}
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      editable={editable}
                      style={[styles.shareInputText, { color: theme.text }]}
                    />
                    {mode === 'percent' ? <ThemedText themeColor="textSecondary">%</ThemedText> : null}
                  </View>
                ) : null}
                {mode !== 'equal' && row.included && split.auto[m.id] !== undefined ? (
                  <ThemedText type="small" themeColor="textSecondary" accessibilityLabel={`${m.display_name}'s share is filled in automatically`}>
                    auto
                  </ThemedText>
                ) : null}
                <ThemedText type="money" style={styles.shareAmount}>
                  {row.included && share ? formatCents(share.amountCents) : ''}
                </ThemedText>
              </View>
            );
          })}
        </View>
        <ThemedText
          type="small"
          themeColor={split.ok ? 'textSecondary' : 'danger'}
          accessibilityLiveRegion="polite">
          {split.ok ? split.status : [split.status, split.message].filter(Boolean).join('. ')}
        </ThemedText>
        {mode !== 'equal' ? (
          <ThemedText type="small" themeColor="textSecondary">
            Leave someone blank and they get whatever is left, shown in grey.
          </ThemedText>
        ) : null}
      </Section>

      {existing ? (
        <ThemedText type="small" themeColor="textSecondary">
          Paid by {nameOf(existing.paid_by_member_id)}. Changes update everyone&apos;s balances right away.
        </ThemedText>
      ) : null}
      <BillEndActions
        tripId={tripId}
        existing={existing}
        former={former}
        dirty={dirty}
        beforeLeave={leaving}
        myMemberId={myMemberId}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  amountBlock: { gap: Spacing.two },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    gap: Spacing.one,
  },
  amountText: { fontFamily: Fonts.bold, fontSize: 36, lineHeight: 44, fontVariant: ['tabular-nums'] },
  amountInput: { flex: 1, paddingVertical: Spacing.two, minWidth: 0 },
  people: { gap: Spacing.two },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.medium,
    paddingRight: Spacing.three,
    minHeight: 56,
  },
  personMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingLeft: Spacing.three,
    minWidth: 0,
  },
  personName: { flexShrink: 1 },
  shareInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.small,
    paddingHorizontal: Spacing.two,
    width: 96,
    gap: Spacing.half,
  },
  shareInputText: {
    flex: 1,
    minWidth: 0,
    paddingVertical: Spacing.two,
    fontFamily: Fonts.medium,
    fontSize: 16,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  shareAmount: { width: 76, textAlign: 'right' },
});
