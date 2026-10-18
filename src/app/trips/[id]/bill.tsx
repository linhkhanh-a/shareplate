import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
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
  friendlyDate,
  isValidIsoDate,
  shareInputText,
  todayIso,
  type ManualMode,
  type SplitRow,
} from '@/lib/ledger';
import { useTripLive } from '@/lib/live';
import { confirmAction } from '@/lib/platform';
import { formerOnBill } from '@/lib/people';
import { describeEditors } from '@/lib/presence';
import { useBills, useDeleteBill, useMembers, usePinBill, useSaveBill, type Bill, type Member } from '@/lib/queries';
import { formatCents } from '@/money';

/** Back to the trip, even when the bill was opened directly from a link. */
function returnToTrip(tripId: string) {
  if (router.canGoBack()) router.back();
  else router.replace({ pathname: '/trips/[id]', params: { id: tripId } });
}

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
  const del = useDeleteBill(tripId);
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
  const [amount, setAmount] = useState(existing ? formatCents(existing.total_cents).replace(/[$,]/g, '') : '');
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
  const [quickDates] = useState(() => [todayIso(), todayIso(new Date(Date.now() - 86_400_000))]);

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
    try {
      if (activityId !== (existing?.itinerary_item_id ?? null)) await pin.mutateAsync({ billId: savedId, activityId });
      returnToTrip(tripId);
    } catch {
      // Shown below from pin.error; the bill itself is saved.
    }
  }

  async function onDelete() {
    if (!existing) return;
    const ok = await confirmAction(
      'Delete this bill?',
      'Balances will update for everyone on it. This can’t be undone.',
      'Delete bill',
    );
    if (!ok) return;
    try {
      await del.mutateAsync(existing.id);
      returnToTrip(tripId);
    } catch {
      // Shown below.
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
          <ThemedText style={[styles.amountText, { color: theme.textSecondary }]}>$</ThemedText>
          <TextInput
            accessibilityLabel="Amount in dollars"
            value={amount}
            onChangeText={(t) => setAmount(t.replace(/[^0-9.,]/g, ''))}
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

      <View style={{ gap: Spacing.two }}>
        <ChipGroup label="Date">
          {quickDates.map((d) => (
            <Chip key={d} label={friendlyDate(d)} selected={date === d} onPress={() => editable && setDate(d)} />
          ))}
        </ChipGroup>
        <TextField
          label="Or type a date"
          hint="Year-month-day, like 2026-10-17"
          value={date}
          onChangeText={setDate}
          error={!dateOk ? 'Use year-month-day, like 2026-10-17.' : null}
          editable={editable}
          maxLength={10}
          autoCapitalize="none"
        />
      </View>

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
                    {mode === 'exact' ? <ThemedText themeColor="textSecondary">$</ThemedText> : null}
                    <TextInput
                      accessibilityLabel={`${m.display_name}'s ${mode === 'percent' ? 'percentage' : 'amount'}`}
                      value={row.input}
                      onChangeText={(t) => updateRow(m.id, { input: t.replace(/[^0-9.,]/g, '') })}
                      placeholder={mode === 'percent' ? '0' : '0.00'}
                      placeholderTextColor={theme.textSecondary}
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      editable={editable}
                      style={[styles.shareInputText, { color: theme.text }]}
                    />
                    {mode === 'percent' ? <ThemedText themeColor="textSecondary">%</ThemedText> : null}
                  </View>
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
      </Section>

      {existing ? (
        <View style={{ gap: Spacing.two }}>
          <Button
            label="Delete bill"
            variant="danger"
            onPress={onDelete}
            loading={del.isPending}
            disabled={former.length > 0}
          />
          {former.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              To delete this bill, bring {former.map((m) => m.display_name).join(' and ')} back first.
            </ThemedText>
          ) : null}
          {del.isError ? <Notice tone="error">{friendlyError(del.error)}</Notice> : null}
          <ThemedText type="small" themeColor="textSecondary">
            Paid by {nameOf(existing.paid_by_member_id)}. Changes update everyone&apos;s balances right away.
          </ThemedText>
        </View>
      ) : null}
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
