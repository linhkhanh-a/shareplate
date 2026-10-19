import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tripChecklist, type ChecklistInput, type ChecklistItem } from '@/lib/help';
import { useChecklistHidden } from '@/lib/tour';

/**
 * "Getting started" on a new trip: the few things to do, ticked off as they
 * happen, each one tap away. Shown until the first bill is settled or it's hidden.
 */
export function GettingStarted({
  tripId,
  input,
  onTab,
}: {
  tripId: string;
  input: ChecklistInput;
  /** Opens a tab of the trip page, e.g. People. */
  onTab: (tab: 'people' | 'plan') => void;
}) {
  const theme = useTheme();
  const { hidden, hide } = useChecklistHidden(tripId);
  const items = tripChecklist(input);
  const left = items.filter((i) => !i.done).length;
  if (hidden !== false || left === 0 || input.payments > 0) return null;

  function go(item: ChecklistItem) {
    if (item.id === 'people') onTab('people');
    else if (item.id === 'plan') onTab('plan');
    else if (item.id === 'zelle') router.push('/profile');
    else if (item.id === 'bill') router.push({ pathname: '/trips/[id]/add', params: { id: tripId } });
    else router.push({ pathname: '/trips/[id]/settle', params: { id: tripId } });
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.header}>
        <View style={styles.grow}>
          <ThemedText type="strong">Getting started</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {`${items.length - left} of ${items.length} done`}
          </ThemedText>
        </View>
        <Button variant="quiet" label="Hide" accessibilityLabel="Hide getting started" onPress={hide} />
      </View>
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}${item.done ? ', done' : ''}`}
          accessibilityHint={item.detail}
          onPress={() => go(item)}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}>
          <View
            style={[
              styles.tick,
              { borderColor: item.done ? theme.primary : theme.border, backgroundColor: item.done ? theme.primary : 'transparent' },
            ]}>
            {item.done ? <ThemedText style={{ color: theme.onPrimary, fontSize: 13, lineHeight: 16 }}>✓</ThemedText> : null}
          </View>
          <View style={styles.grow}>
            <ThemedText
              style={item.done ? { color: theme.textSecondary, textDecorationLine: 'line-through' } : undefined}
              numberOfLines={1}>
              {item.title}
            </ThemedText>
            {!item.done ? (
              <ThemedText type="small" themeColor="textSecondary">
                {item.detail}
              </ThemedText>
            ) : null}
          </View>
          {!item.done ? <ThemedText themeColor="textSecondary">›</ThemedText> : null}
        </Pressable>
      ))}
      <Button variant="quiet" label="Help and FAQ" onPress={() => router.push('/help')} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.one },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  grow: { flex: 1, minWidth: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.small,
    minHeight: 44,
  },
  tick: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
