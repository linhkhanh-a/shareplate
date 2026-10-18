import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fraction } from '@/lib/budget';

/**
 * A bullet bar: the colored fill is what was spent; the thin tick is the
 * target (budget or allowance). Over the target, the fill turns the warning
 * color. The numbers are always written next to it, so color is never the only
 * way to read it; the bar itself is hidden from screen readers.
 */
export function BudgetBar({ value, target, max }: { value: number; target: number | null; max: number }) {
  const theme = useTheme();
  const over = target !== null && target > 0 && value > target;
  const fill = fraction(value, max);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.track, { backgroundColor: theme.surfaceMuted }]}>
      {fill > 0 ? (
        <View
          style={[
            styles.fill,
            { width: `${Math.max(fill * 100, 1.5)}%`, backgroundColor: over ? theme.danger : theme.primary },
          ]}
        />
      ) : null}
      {target !== null && target > 0 ? (
        <View style={[styles.tick, { left: `${fraction(target, max) * 100}%`, backgroundColor: theme.text }]} />
      ) : null}
    </View>
  );
}

/** The key for a chart of BudgetBars. */
export function BudgetLegend({ targetLabel }: { targetLabel: string | null }) {
  const theme = useTheme();
  return (
    <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.legendItem}>
        <View style={[styles.swatch, { backgroundColor: theme.primary }]} />
        <ThemedText type="small" themeColor="textSecondary">
          Spent
        </ThemedText>
      </View>
      {targetLabel ? (
        <View style={styles.legendItem}>
          <View style={[styles.legendTick, { backgroundColor: theme.text }]} />
          <ThemedText type="small" themeColor="textSecondary">
            {targetLabel}
          </ThemedText>
        </View>
      ) : null}
      {targetLabel ? (
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: theme.danger }]} />
          <ThemedText type="small" themeColor="textSecondary">
            Over
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 12, borderRadius: Radius.small / 2, justifyContent: 'center', marginVertical: Spacing.one },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
  },
  tick: { position: 'absolute', width: 2, top: -4, bottom: -4, marginLeft: -1, borderRadius: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  legendTick: { width: 2, height: 14, borderRadius: 1, marginHorizontal: 5 },
});
