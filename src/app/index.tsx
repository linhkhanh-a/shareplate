import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { InstallHint } from '@/components/install-hint';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Button, Loading, Notice, Pill, Screen } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/errors';
import { useProfile, useTrips, useUnreadCounts, type TripSummary } from '@/lib/queries';

export default function TripsScreen() {
  const profile = useProfile();
  const trips = useTrips();
  const unread = useUnreadCounts();
  const refetchUnread = unread.refetch;
  // Coming back to this screen: check for news again.
  useFocusEffect(
    useCallback(() => {
      void refetchUnread();
    }, [refetchUnread]),
  );
  const name = profile.data?.full_name || profile.data?.email || '';

  return (
    <Screen footer={<Button label="New trip" onPress={() => router.push('/trips/new')} />}>
      <View style={styles.header}>
        <ThemedText type="title" accessibilityRole="header">
          Your trips
        </ThemedText>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Your profile"
          hitSlop={8}
          onPress={() => router.push('/profile')}>
          <Avatar name={name} size={40} />
        </Pressable>
      </View>

      {trips.isPending ? <Loading /> : null}
      {trips.isError ? <Notice tone="error">{friendlyError(trips.error)}</Notice> : null}

      {trips.data && trips.data.length === 0 ? (
        <Notice>
          <ThemedText type="strong">No trips yet</ThemedText>
          <ThemedText type="small">
            Create one for your next getaway, or open an invite link a friend sent you.
          </ThemedText>
        </Notice>
      ) : null}

      <View style={styles.list}>
        {trips.data?.map((t) => <TripRow key={t.trip.id} summary={t} unread={unread.data?.get(t.trip.id) ?? 0} />)}
      </View>

      <InstallHint />
    </Screen>
  );
}

function TripRow({ summary, unread }: { summary: TripSummary; unread: number }) {
  const theme = useTheme();
  const { trip, role } = summary;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${trip.name}${unread > 0 ? `, ${unread} new ${unread === 1 ? 'change' : 'changes'}` : ''}`}
      onPress={() => router.push({ pathname: '/trips/[id]', params: { id: trip.id } })}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.surfaceMuted : theme.surface, borderColor: theme.border },
      ]}>
      <View style={[styles.stripe, { backgroundColor: trip.mode === 'quick' ? theme.accent : theme.primary }]} />
      <View style={styles.rowText}>
        <ThemedText type="strong" numberOfLines={1}>
          {trip.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {trip.mode === 'quick' ? 'Quick split' : 'Group trip'}
        </ThemedText>
      </View>
      {unread > 0 ? <Pill label={`${unread > 99 ? '99+' : unread} new`} tone="accent" /> : null}
      {role === 'admin' ? <Pill label="Admin" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  list: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingRight: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.medium,
    overflow: 'hidden',
  },
  stripe: { width: 6, alignSelf: 'stretch', marginVertical: -Spacing.three },
  rowText: { flex: 1, gap: Spacing.half },
});
