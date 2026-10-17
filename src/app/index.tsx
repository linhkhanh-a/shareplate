import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatCents, splitEqual } from '@/money';

// Placeholder home screen until Phase 3 builds the real app.
// It runs one real split through the money engine as a smoke test.
const demo = splitEqual(1000, ['Linh', 'An', 'Minh']);

export default function HomeScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.center}>
          Shareplate
        </ThemedText>
        <ThemedText style={styles.center} themeColor="textSecondary">
          Split trip bills fairly, down to the last cent.
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">$10.00 split three ways</ThemedText>
          {demo.map((s) => (
            <ThemedText key={s.memberId} type="small">
              {s.memberId}: {formatCents(s.amountCents)}
            </ThemedText>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          Under construction. The full app arrives phase by phase.
        </ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
    gap: Spacing.four,
  },
  center: {
    textAlign: 'center',
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Spacing.four,
  },
});
