import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTripLive } from '@/lib/live';

/** A small dot while changes from other people arrive live. */
export function LiveBadge() {
  const theme = useTheme();
  const { connected } = useTripLive();
  if (!connected) return null;
  return (
    <View style={styles.live} accessibilityLabel="Updating live">
      <View style={[styles.liveDot, { backgroundColor: theme.primary }]} />
      <ThemedText type="small" themeColor="textSecondary">
        Live
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  live: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
});
