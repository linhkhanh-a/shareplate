import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Button, Chip, ChipGroup, Loading, Notice, Screen, Section, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import {
  budgetLine,
  checkActivity,
  dayLabel,
  draftFromActivity,
  mapsUrl,
  MAX_DAYS,
  nextPosition,
  planDays,
  type Activity,
  type ActivityDraft,
} from '@/lib/itinerary';
import { friendlyDate } from '@/lib/ledger';
import { useTripLive } from '@/lib/live';
import { confirmAction } from '@/lib/platform';
import { describeEditors } from '@/lib/presence';
import {
  useBills,
  useDeleteActivity,
  useItinerary,
  useMembers,
  usePinBill,
  useSaveActivity,
  useTrip,
  type Bill,
  type TripDetails,
} from '@/lib/queries';
import { formatCents } from '@/money';

/** Back to the plan, even when the activity was opened directly from a link. */
function returnToPlan(tripId: string) {
  if (router.canGoBack()) router.back();
  else router.replace({ pathname: '/trips/[id]/plan', params: { id: tripId } });
}

export default function ActivityScreen() {
  const { id: tripId, activityId, day } = useLocalSearchParams<{ id: string; activityId?: string; day?: string }>();
  const trip = useTrip(tripId);
  const plan = useItinerary(tripId);
  const [formKey, setFormKey] = useState(0);
  const existing = activityId ? plan.data?.find((a) => a.id === activityId) : undefined;

  if (trip.isPending || plan.isPending) {
    return (
      <Screen>
        <TopBar />
        <Loading />
      </Screen>
    );
  }
  if (trip.isError || plan.isError) {
    return (
      <Screen>
        <TopBar />
        <Notice tone="error">{friendlyError(trip.error ?? plan.error)}</Notice>
      </Screen>
    );
  }
  if (activityId && !existing) {
    return (
      <Screen>
        <TopBar />
        <Notice tone="error">This activity was deleted.</Notice>
      </Screen>
    );
  }

  const startDay = Math.min(MAX_DAYS, Math.max(1, Number(day) || 1));
  return (
    <ActivityForm
      key={`${existing?.id ?? 'new'}-${formKey}`}
      tripId={tripId}
      trip={trip.data}
      activities={plan.data ?? []}
      existing={existing}
      startDay={startDay}
      onReload={() => setFormKey((k) => k + 1)}
    />
  );
}

const EMPTY: Omit<ActivityDraft, 'day'> = { title: '', start: '', end: '', location: '', notes: '', budget: '' };

function ActivityForm({
  tripId,
  trip,
  activities,
  existing,
  startDay,
  onReload,
}: {
  tripId: string;
  trip: TripDetails;
  activities: Activity[];
  existing?: Activity;
  startDay: number;
  onReload: () => void;
}) {
  const save = useSaveActivity(tripId);
  const del = useDeleteActivity(tripId);
  const { setEditing, editorsOf } = useTripLive();
  const [draft, setDraft] = useState<ActivityDraft>(() =>
    existing ? draftFromActivity(existing) : { ...EMPTY, day: startDay },
  );
  const [attempted, setAttempted] = useState(false);
  const [openedVersion] = useState(existing?.version);

  const existingId = existing?.id;
  useEffect(() => {
    if (!existingId) return;
    setEditing(existingId);
    return () => setEditing(null);
  }, [existingId, setEditing]);
  const otherEditors = existingId ? editorsOf(existingId) : [];
  const newerVersionSaved = !!existing && openedVersion !== undefined && existing.version > openedVersion;

  const check = checkActivity(draft);
  const errors = attempted && !check.ok ? check.errors : {};
  const update = (changes: Partial<ActivityDraft>) => setDraft((d) => ({ ...d, ...changes }));

  // Days to choose from: the trip's days, plus one more to start a new day.
  const dayCount = planDays(activities, trip.start_date, trip.end_date).length;
  const dayChoices = Array.from({ length: Math.min(MAX_DAYS, Math.max(dayCount + 1, draft.day)) }, (_, i) => i + 1);

  async function onSave() {
    setAttempted(true);
    if (!check.ok) return;
    const others = activities.filter((a) => a.id !== existing?.id);
    const movedDay = !existing || existing.day_number !== check.fields.day_number;
    try {
      await save.mutateAsync({
        id: existing?.id,
        expectedVersion: openedVersion,
        fields: check.fields,
        // New activities, and ones moved to another day, go at the end of that day.
        position: movedDay ? nextPosition(others, check.fields.day_number) : undefined,
      });
      returnToPlan(tripId);
    } catch {
      // Shown in the footer.
    }
  }

  async function onDelete() {
    if (!existing) return;
    const ok = await confirmAction(
      `Delete "${existing.title}"?`,
      'It’s removed from the plan for everyone. Bills pinned to it stay in the trip, just unpinned.',
      'Delete activity',
    );
    if (!ok) return;
    try {
      await del.mutateAsync(existing.id);
      returnToPlan(tripId);
    } catch {
      // Shown below.
    }
  }

  const footer = (
    <View style={{ gap: Spacing.two }}>
      {save.isError ? <Notice tone="error">{friendlyError(save.error)}</Notice> : null}
      {attempted && !check.ok ? <Notice tone="error">Check the fields marked above.</Notice> : null}
      <Button label={existing ? 'Save changes' : 'Add to plan'} onPress={onSave} loading={save.isPending} />
    </View>
  );

  return (
    <Screen footer={footer}>
      <TopBar />
      <ThemedText type="title" accessibilityRole="header">
        {existing ? 'Activity' : 'New activity'}
      </ThemedText>

      {newerVersionSaved ? (
        <Notice tone="error">
          <ThemedText type="strong">Someone just saved changes to this activity</ThemedText>
          <ThemedText type="small">
            Your edits are based on the older version, so saving them won&apos;t work. Load the latest version to see
            their changes, then edit again.
          </ThemedText>
          <Button label="Load latest version" variant="secondary" onPress={onReload} />
        </Notice>
      ) : otherEditors.length > 0 ? (
        <Notice>
          {`${describeEditors(otherEditors)} also editing this activity. If they save first, you'll be asked to load their version.`}
        </Notice>
      ) : null}

      <TextField
        label="What's the plan?"
        placeholder="Night market food tour"
        value={draft.title}
        onChangeText={(title) => update({ title })}
        maxLength={200}
        error={errors.title}
      />

      <ChipGroup label="Day">
        {dayChoices.map((d) => (
          <Chip key={d} label={dayLabel(d, trip.start_date)} selected={draft.day === d} onPress={() => update({ day: d })} />
        ))}
      </ChipGroup>

      <View style={styles.row}>
        <View style={styles.grow}>
          <TextField
            label="Starts"
            placeholder="7:00 PM"
            value={draft.start}
            onChangeText={(start) => update({ start })}
            error={errors.start}
            hint="Optional"
            autoCapitalize="none"
            maxLength={12}
          />
        </View>
        <View style={styles.grow}>
          <TextField
            label="Ends"
            placeholder="9:30 PM"
            value={draft.end}
            onChangeText={(end) => update({ end })}
            error={errors.end}
            hint="Optional"
            autoCapitalize="none"
            maxLength={12}
          />
        </View>
      </View>

      <View style={{ gap: Spacing.two }}>
        <TextField
          label="Where"
          placeholder="Đà Lạt Night Market"
          value={draft.location}
          onChangeText={(location) => update({ location })}
          maxLength={300}
          hint="A place name or address. Opens in your maps app."
        />
        {draft.location.trim() ? (
          <Button
            variant="secondary"
            label="Open in Maps"
            onPress={() => void Linking.openURL(mapsUrl(draft.location, Platform.OS))}
          />
        ) : null}
      </View>

      <TextField
        label="Planned budget"
        placeholder="0.00"
        value={draft.budget}
        onChangeText={(budget) => update({ budget: budget.replace(/[^0-9.,]/g, '') })}
        keyboardType="decimal-pad"
        inputMode="decimal"
        maxLength={12}
        error={errors.budget}
        hint="Roughly what the group expects to spend, in dollars. Optional."
      />

      <TextField
        label="Notes"
        placeholder="Bring cash. Meet at the hotel lobby."
        value={draft.notes}
        onChangeText={(notes) => update({ notes })}
        maxLength={2000}
        multiline
        style={styles.notes}
      />

      {existing ? <PinnedBills tripId={tripId} activity={existing} /> : null}

      {existing ? (
        <View style={{ gap: Spacing.two }}>
          <Button variant="danger" label="Delete activity" onPress={onDelete} loading={del.isPending} />
          {del.isError ? <Notice tone="error">{friendlyError(del.error)}</Notice> : null}
        </View>
      ) : null}
    </Screen>
  );
}

/** Bills pinned to this activity, and a way to pin more. */
function PinnedBills({ tripId, activity }: { tripId: string; activity: Activity }) {
  const bills = useBills(tripId);
  const members = useMembers(tripId);
  const plan = useItinerary(tripId);
  const pin = usePinBill(tripId);
  const uid = useAuth().session?.user.id;
  const [choosing, setChoosing] = useState(false);

  const all = bills.data ?? [];
  const pinned = all.filter((b) => b.itinerary_item_id === activity.id);
  const others = all.filter((b) => b.itinerary_item_id !== activity.id);
  const spent = pinned.reduce((s, b) => s + b.total_cents, 0);
  const line = budgetLine(activity.proposed_budget_cents, spent);
  const titleOf = (id: string) => plan.data?.find((a) => a.id === id)?.title;
  const payerOf = (b: Bill) => {
    const m = members.data?.find((x) => x.id === b.paid_by_member_id);
    return !m ? 'Someone' : m.user_id === uid ? 'You' : m.display_name;
  };
  const addBill = (pathname: '/trips/[id]/bill' | '/trips/[id]/scan') =>
    router.push({ pathname, params: { id: tripId, pin: activity.id } });

  return (
    <Section title="Bills">
      {line ? (
        <ThemedText
          themeColor={activity.proposed_budget_cents > 0 && spent > activity.proposed_budget_cents ? 'danger' : 'textSecondary'}>
          {line}
        </ThemedText>
      ) : null}
      {bills.isPending ? <Loading /> : null}
      {pinned.length === 0 && !bills.isPending ? (
        <ThemedText type="small" themeColor="textSecondary">
          Pin the bills for this activity to see what it really cost.
        </ThemedText>
      ) : null}
      <View style={{ gap: Spacing.two }}>
        {pinned.map((b) => (
          <BillLine
            key={b.id}
            tripId={tripId}
            bill={b}
            detail={`${payerOf(b) === 'You' ? 'You paid' : `${payerOf(b)} paid`}, ${friendlyDate(b.bill_date)}`}
            action={
              <Button
                variant="quiet"
                label="Unpin"
                accessibilityLabel={`Unpin ${b.title || b.category}`}
                onPress={() => pin.mutate({ billId: b.id, activityId: null })}
              />
            }
          />
        ))}
      </View>
      {pin.isError ? <Notice tone="error">{friendlyError(pin.error)}</Notice> : null}

      <View style={styles.row}>
        <Button variant="secondary" label="Add a bill" onPress={() => addBill('/trips/[id]/bill')} style={styles.grow} />
        <Button variant="secondary" label="Scan a receipt" onPress={() => addBill('/trips/[id]/scan')} style={styles.grow} />
      </View>
      {others.length > 0 ? (
        <Button
          variant="quiet"
          label={choosing ? 'Done choosing' : 'Pin a bill already in the trip'}
          onPress={() => setChoosing((v) => !v)}
        />
      ) : null}
      {choosing ? (
        <View style={{ gap: Spacing.two }}>
          {others.map((b) => {
            const elsewhere = b.itinerary_item_id ? titleOf(b.itinerary_item_id) : undefined;
            return (
              <BillLine
                key={b.id}
                tripId={tripId}
                bill={b}
                detail={elsewhere ? `Pinned to ${elsewhere}` : friendlyDate(b.bill_date)}
                action={
                  <Button
                    variant="quiet"
                    label={elsewhere ? 'Move here' : 'Pin'}
                    accessibilityLabel={`Pin ${b.title || b.category} to ${activity.title}`}
                    onPress={() => pin.mutate({ billId: b.id, activityId: activity.id })}
                  />
                }
              />
            );
          })}
        </View>
      ) : null}
    </Section>
  );
}

function BillLine({
  tripId,
  bill,
  detail,
  action,
}: {
  tripId: string;
  bill: Bill;
  detail: string;
  action: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.bill, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the bill"
        onPress={() =>
          router.push({
            pathname: bill.split_mode === 'itemized' ? '/trips/[id]/scan' : '/trips/[id]/bill',
            params: { id: tripId, billId: bill.id },
          })
        }
        style={({ pressed }) => [styles.billMain, pressed && { backgroundColor: theme.surfaceMuted }]}>
        <View style={styles.grow}>
          <ThemedText type="strong" numberOfLines={2}>
            {bill.title || bill.category}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {detail}
          </ThemedText>
        </View>
        <ThemedText type="money">{formatCents(bill.total_cents)}</ThemedText>
      </Pressable>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  notes: { minHeight: 96, textAlignVertical: 'top', paddingTop: Spacing.three },
  bill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Radius.medium, overflow: 'hidden' },
  billMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
});
