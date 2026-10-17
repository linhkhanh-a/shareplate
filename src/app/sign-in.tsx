import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Notice } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { formatCents, splitItemizedBill } from '@/money';

// A real split from the money engine, shown as a preview of what the app does.
const example = splitItemizedBill({
  items: [
    { priceCents: 1500, memberIds: ['Linh'] },
    { priceCents: 900, memberIds: ['An'] },
    { priceCents: 1200, memberIds: ['Linh', 'An', 'Minh'] },
  ],
  discountCents: 600,
  taxCents: 240,
  tipCents: 900,
});

export default function SignInScreen() {
  const theme = useTheme();
  const { signInWithGoogle } = useAuth();
  const params = useLocalSearchParams<{ error_description?: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.error_description ?? null);

  async function onSignIn() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle('/');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.page, { backgroundColor: theme.background }]}>
      <View style={[styles.band, { backgroundColor: theme.primary }]}>
        <SafeAreaView edges={['top']} style={styles.bandInner}>
          <ThemedText type="display" style={{ color: theme.onPrimary }} accessibilityRole="header">
            Shareplate
          </ThemedText>
          <ThemedText style={{ color: theme.onPrimary, opacity: 0.9 }}>
            Split trip bills fairly, down to the last cent.
          </ThemedText>
        </SafeAreaView>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.body}>
        <View style={[styles.receipt, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.receiptHeader}>
            <ThemedText type="strong">Dinner in Hội An</ThemedText>
            <ThemedText type="money">{formatCents(example.totalCents)}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Shared spring rolls, a voucher, tax and tip, split by who ate what.
          </ThemedText>
          <View style={[styles.rule, { borderColor: theme.border }]} />
          {example.members.map((m) => (
            <View key={m.memberId} style={styles.receiptRow}>
              <ThemedText>{m.memberId}</ThemedText>
              <ThemedText type="money">{formatCents(m.totalCents)}</ThemedText>
            </View>
          ))}
        </View>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <Button label="Continue with Google" onPress={onSignIn} loading={busy} />
        <Link href="/privacy" style={styles.link}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.underline}>
            How Shareplate uses your information
          </ThemedText>
        </Link>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  band: { paddingBottom: Spacing.five },
  bandInner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.six,
    gap: Spacing.two,
  },
  body: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    marginTop: -Spacing.four,
    gap: Spacing.four,
  },
  receipt: {
    borderWidth: 1,
    borderRadius: Radius.medium,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  receiptHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between' },
  rule: { borderTopWidth: 1, borderStyle: 'dashed', marginVertical: Spacing.one },
  link: { alignSelf: 'center' },
  underline: { textDecorationLine: 'underline' },
});
