import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { DragList } from '@/components/drag-list';
import { LiveBadge } from '@/components/live-badge';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Button, Loading, Notice, Screen, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { confirmAction } from '@/lib/platform';
import {
  budgetLine,
  budgetTotals,
  dayLabel,
  daysBetween,
  mapsUrl,
  MAX_DAYS,
  moveInList,
  outOfTimeOrder,
  placementsFor,
  planDays,
  shortDate,
  sortByTime,
  spentByActivity,
  timeRange,
  type Activity,
  type PlanDay,
} from '@/lib/itinerary';
import { isValidIsoDate } from '@/lib/ledger';
import { useTripLive } from '@/lib/live';
import { describeEditors } from '@/lib/presence';
import {
  useArrangeItinerary,
  useBills,
  useItinerary,
  useMembers,
  useSetTripDates,
  useTrip,
  type TripDetails,
} from '@/lib/queries';

export default function PlanScreen() {
  const { id: tripId } = useLocalSearchParams<{ id: string }>();
  const uid = useAuth().session?.user.id;
  const trip = useTrip(tripId);
  const plan = useItinerary(tripId);
  const bills = useBills(tripId);
  const members = useMembers(tripId);
  const arrange = useArrangeItinerary(tripId);
  const isAdmin = members.data?.some((m) => m.user_id === uid && !m.left_at && m.role === 'admin') ?? false;

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

  const activities = plan.data ?? [];
  const days = planDays(activities, trip.data.start_date, trip.data.end_date);
  const spent = spentByActivity(bills.data ?? []);
  const pinnedCount = new Map<string, number>();
  for (const b of bills.data ?? []) {
    if (b.itinerary_item_id) pinnedCount.set(b.itinerary_item_id, (pinnedCount.get(b.itinerary_item_id) ?? 0) + 1);
  }
  const whole = budgetTotals(activities, spent);

  const reorder = (day: PlanDay, ordered: Activity[]) => arrange.mutate(placementsFor(day.day, ordered));
  const addTo = (day: number) => router.push({ pathname: '/trips/[id]/activity', params: { id: tripId, day: String(day) } });

  return (
    <Screen>
      <TopBar right={<LiveBadge />} />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="title" accessibilityRole="header">
          Trip plan
        </ThemedText>
        <ThemedText themeColor="textSecondary">{trip.data.name}</ThemedText>
      </View>

      <TripDates trip={trip.data} canEdit={isAdmin} />

      {whole.planned > 0 || whole.spent > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Whole trip: {budgetLine(whole.planned, whole.spent)}
        </ThemedText>
      ) : null}

      {arrange.isError ? <Notice tone="error">{`Couldn't save the new order. ${friendlyError(arrange.error)}`}</Notice> : null}

      {activities.length === 0 ? (
        <Notice>
          <ThemedText type="strong">Plan the trip together</ThemedText>
          <ThemedText type="small">
            Add activities to each day, like a food tour or a hike, with times, places and a planned budget. Everyone in
            the trip sees changes live. Later, pin bills to activities to see what each one really cost.
          </ThemedText>
        </Notice>
      ) : null}

      {days.map((day) => {
        const totals = budgetTotals(day.activities, spent);
        const line = budgetLine(totals.planned, totals.spent);
        return (
          <View key={day.day} style={styles.day}>
            <View style={styles.dayHeader}>
              <View style={styles.grow}>
                <ThemedText type="heading" accessibilityRole="header">
                  {dayLabel(day.day, trip.data.start_date)}
                </ThemedText>
                {line ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {line}
                  </ThemedText>
                ) : null}
              </View>
              {outOfTimeOrder(day.activities) ? (
                <Button variant="quiet" label="Sort by time" onPress={() => reorder(day, sortByTime(day.activities))} />
              ) : null}
            </View>

            {day.activities.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing planned yet.
              </ThemedText>
            ) : (
              <DragList
                items={day.activities}
                keyOf={(a) => a.id}
                labelOf={(a) => a.title}
                onMove={(from, to) => reorder(day, moveInList(day.activities, from, to))}
                renderItem={(a, handle, dragging) => (
                  <ActivityCard
                    tripId={tripId}
                    activity={a}
                    handle={day.activities.length > 1 ? handle : null}
                    dragging={dragging}
                    spentCents={spent.get(a.id) ?? 0}
                    bills={pinnedCount.get(a.id) ?? 0}
                  />
                )}
              />
            )}
            <Button variant="secondary" label={`Add to day ${day.day}`} onPress={() => addTo(day.day)} />
          </View>
        );
      })}

      {days.length < MAX_DAYS ? (
        <Button variant="quiet" label="Plan another day" onPress={() => addTo(days.length + 1)} />
      ) : null}
    </Screen>
  );
}

function ActivityCard({
  tripId,
  activity: a,
  handle,
  dragging,
  spentCents,
  bills,
}: {
  tripId: string;
  activity: Activity;
  handle: ReactNode;
  dragging: boolean;
  spentCents: number;
  bills: number;
}) {
  const theme = useTheme();
  const editors = useTripLive().editorsOf(a.id);
  const when = timeRange(a.start_time, a.end_time);
  const money = budgetLine(a.proposed_budget_cents, spentCents);
  const over = a.proposed_budget_cents > 0 && spentCents > a.proposed_budget_cents;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: dragging ? theme.primary : theme.border },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the activity to see details, pinned bills, or edit it"
        onPress={() => router.push({ pathname: '/trips/[id]/activity', params: { id: tripId, activityId: a.id } })}
        style={({ pressed }) => [styles.cardMain, pressed && { backgroundColor: theme.surfaceMuted }]}>
        {when ? (
          <ThemedText type="small" style={{ color: theme.primary }}>
            {when}
          </ThemedText>
        ) : null}
        <ThemedText type="strong">{a.title}</ThemedText>
        {a.location ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {a.location}
          </ThemedText>
        ) : null}
        {money || bills > 0 ? (
          <ThemedText type="small" themeColor={over ? 'danger' : 'textSecondary'} style={styles.tabular}>
            {[money, bills > 0 ? `${bills} ${bills === 1 ? 'bill' : 'bills'}` : ''].filter(Boolean).join(' · ')}
          </ThemedText>
        ) : null}
        {editors.length > 0 ? (
          <ThemedText type="small" style={{ color: theme.primary }}>
            {describeEditors(editors)} editing
          </ThemedText>
        ) : null}
      </Pressable>
      {a.location ? (
        <Button
          variant="quiet"
          label="Map"
          accessibilityLabel={`Open ${a.location} in maps`}
          onPress={() => void Linking.openURL(mapsUrl(a.location!, Platform.OS))}
        />
      ) : null}
      {handle}
    </View>
  );
}

/** The trip's dates. Admins can set them; each day then shows its date. */
function TripDates({ trip, canEdit }: { trip: TripDetails; canEdit: boolean }) {
  const theme = useTheme();
  const setDates = useSetTripDates(trip.id);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(trip.start_date ?? '');
  const [end, setEnd] = useState(trip.end_date ?? '');
  const [attempted, setAttempted] = useState(false);

  const has = trip.start_date && trip.end_date;
  const summary = has
    ? `${shortDate(trip.start_date!)} to ${shortDate(trip.end_date!)} · ${daysBetween(trip.start_date, trip.end_date)} days`
    : 'No dates yet';

  const startError = start && !isValidIsoDate(start) ? 'Use year-month-day, like 2026-10-23.' : null;
  const endError =
    end && !isValidIsoDate(end)
      ? 'Use year-month-day, like 2026-10-26.'
      : start && end && !startError && end < start
        ? 'The last day comes after the first day.'
        : start && end && daysBetween(start, end) > MAX_DAYS
          ? `Plans can be up to ${MAX_DAYS} days.`
          : null;
  const missing = attempted && (!start || !end) ? 'Enter both dates, or clear them.' : null;

  async function onSave() {
    setAttempted(true);
    if (!start || !end || startError || endError) return;
    try {
      await setDates.mutateAsync({ start_date: start, end_date: end });
      setOpen(false);
    } catch {
      // Shown below.
    }
  }

  async function onClear() {
    const ok = await confirmAction(
      'Clear the trip dates?',
      'The plan keeps its days and activities. Bills keep their dates too.',
      'Clear dates',
    );
    if (!ok) return;
    try {
      await setDates.mutateAsync({ start_date: null, end_date: null });
      setStart('');
      setEnd('');
      setOpen(false);
    } catch {
      // Shown below.
    }
  }

  return (
    <View style={[styles.dates, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.dayHeader}>
        <View style={styles.grow}>
          <ThemedText type="strong">Dates</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {summary}
          </ThemedText>
        </View>
        {canEdit && !open ? (
          <Button variant="quiet" label={has ? 'Change' : 'Set dates'} onPress={() => setOpen(true)} />
        ) : null}
      </View>
      {open ? (
        <View style={{ gap: Spacing.three }}>
          <View style={styles.dateRow}>
            <View style={styles.grow}>
              <TextField
                label="First day"
                placeholder="2026-10-23"
                value={start}
                onChangeText={setStart}
                error={startError}
                maxLength={10}
                autoCapitalize="none"
              />
            </View>
            <View style={styles.grow}>
              <TextField
                label="Last day"
                placeholder="2026-10-26"
                value={end}
                onChangeText={setEnd}
                error={endError}
                maxLength={10}
                autoCapitalize="none"
              />
            </View>
          </View>
          {missing ? <Notice tone="error">{missing}</Notice> : null}
          {setDates.isError ? <Notice tone="error">{friendlyError(setDates.error)}</Notice> : null}
          <View style={styles.dateRow}>
            <Button label="Save dates" onPress={onSave} loading={setDates.isPending} style={styles.grow} />
            {has ? <Button variant="secondary" label="Clear" onPress={onClear} /> : null}
            <Button variant="quiet" label="Cancel" onPress={() => setOpen(false)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
  tabular: { fontVariant: ['tabular-nums'] },
  day: { gap: Spacing.two },
  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  card: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Radius.medium, overflow: 'hidden' },
  cardMain: { flex: 1, padding: Spacing.three, gap: Spacing.half },
  dates: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.three },
  dateRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
});
