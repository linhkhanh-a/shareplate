import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Screen } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CHANGELOG } from '@/lib/changelog';

/** Every release, newest first, in plain words. */
export default function WhatsNewScreen() {
  const theme = useTheme();
  return (
    <Screen>
      <TopBar />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="title" accessibilityRole="header">
          What&apos;s new
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          Shareplate updates by itself. Here&apos;s what changed lately.
        </ThemedText>
      </View>
      {CHANGELOG.map((r, i) => (
        <View key={r.id} style={[styles.release, { backgroundColor: theme.surface, borderColor: i === 0 ? theme.primary : theme.border }]}>
          <ThemedText type="small" themeColor="textSecondary">
            {i === 0 ? `Latest · ${r.date}` : r.date}
          </ThemedText>
          <ThemedText type="strong" accessibilityRole="header">
            {r.title}
          </ThemedText>
          {r.items.map((item) => (
            <View key={item} style={styles.item}>
              <ThemedText themeColor="textSecondary">•</ThemedText>
              <ThemedText style={styles.grow}>{item}</ThemedText>
            </View>
          ))}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  release: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  item: { flexDirection: 'row', gap: Spacing.two },
  grow: { flex: 1, minWidth: 0 },
});
