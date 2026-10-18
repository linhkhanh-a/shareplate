import { useState } from 'react';
import { View } from 'react-native';

import { Button, Chip, ChipGroup } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { daysBetween, sortActivities } from '@/lib/itinerary';
import { isValidIsoDate } from '@/lib/ledger';
import { useItinerary, useTrip } from '@/lib/queries';

/**
 * "Part of the plan": pins a bill to an activity. Shows the activities on the
 * bill's day when the trip has dates, with a way to see every day.
 * Shows nothing until the trip has a plan.
 */
export function PlanPicker({
  tripId,
  billDate,
  value,
  onChange,
}: {
  tripId: string;
  billDate: string;
  value: string | null;
  onChange: (activityId: string | null) => void;
}) {
  const plan = useItinerary(tripId);
  const trip = useTrip(tripId);
  const [showAll, setShowAll] = useState(false);

  const activities = sortActivities(plan.data ?? []);
  if (activities.length === 0) return null;

  const start = trip.data?.start_date ?? null;
  const day = start && isValidIsoDate(billDate) && billDate >= start ? daysBetween(start, billDate) : 0;
  const onDay = activities.filter((a) => a.day_number === day);
  const filtering = !showAll && onDay.length > 0;
  const shown = filtering ? activities.filter((a) => a.day_number === day || a.id === value) : activities;

  return (
    <View style={{ gap: Spacing.one }}>
      <ChipGroup label={filtering ? `Part of the plan (day ${day})` : 'Part of the plan'}>
        <Chip label="Not pinned" selected={value === null} onPress={() => onChange(null)} />
        {shown.map((a) => (
          <Chip
            key={a.id}
            label={filtering ? a.title : `Day ${a.day_number}: ${a.title}`}
            selected={value === a.id}
            onPress={() => onChange(a.id)}
          />
        ))}
      </ChipGroup>
      {onDay.length > 0 && onDay.length < activities.length ? (
        <Button
          variant="quiet"
          label={showAll ? `Only day ${day}` : 'Show every day'}
          onPress={() => setShowAll((v) => !v)}
          style={{ alignSelf: 'flex-start' }}
        />
      ) : null}
    </View>
  );
}
