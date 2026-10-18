import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Screen } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The one way into adding a bill: a receipt, or by hand (one total or item by item). */
export default function AddBillScreen() {
  const { id: tripId, pin } = useLocalSearchParams<{ id: string; pin?: string }>();
  const params = pin ? { id: tripId, pin } : { id: tripId };
  const go = (pathname: '/trips/[id]/scan' | '/trips/[id]/bill', extra: Record<string, string> = {}) =>
    router.replace({ pathname, params: { ...params, ...extra } });

  return (
    <Screen>
      <TopBar />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="title" accessibilityRole="header">
          Add a bill
        </ThemedText>
        <ThemedText themeColor="textSecondary">Upload the receipt, or type it in yourself.</ThemedText>
      </View>

      <Option
        title="Upload a receipt"
        detail="Take or choose a photo. Shareplate reads the items, discount, tax and tip; you check everything before it's saved."
        onPress={() => go('/trips/[id]/scan')}
        highlight
      />

      <ThemedText type="strong">Or enter it by hand</ThemedText>
      <Option
        title="One total"
        detail="Just the amount, split equally, by percent, or by exact amounts."
        onPress={() => go('/trips/[id]/bill')}
      />
      <Option
        title="By item"
        detail="Each dish or item, who had it, then discount, tax and tip as $ or %."
        onPress={() => go('/trips/[id]/scan', { manual: '1' })}
      />
    </Screen>
  );
}

function Option({ title, detail, onPress, highlight }: { title: string; detail: string; onPress: () => void; highlight?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: pressed ? theme.surfaceMuted : theme.surface,
          borderColor: highlight ? theme.primary : theme.border,
          borderWidth: highlight ? 2 : 1,
        },
      ]}>
      <ThemedText type="heading">{title}</ThemedText>
      <ThemedText themeColor="textSecondary">{detail}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: { borderRadius: Radius.medium, padding: Spacing.four, gap: Spacing.one },
});
