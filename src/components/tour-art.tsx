import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TourArt as Art } from '@/lib/help';

/**
 * Small pictures of the real screens for the tour, drawn with the app's own
 * colors (so they follow light and dark mode) rather than screenshots that
 * would go out of date. Purely decorative: screen readers skip them, the
 * card's text says the same thing.
 */
export function TourArt({ art }: { art: Art }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={[styles.frame, { backgroundColor: theme.background, borderColor: theme.border }]}>
      {art === 'welcome' ? <Welcome /> : null}
      {art === 'bills' ? <Bills /> : null}
      {art === 'settle' ? <Settle /> : null}
      {art === 'plan' ? <Plan /> : null}
      {art === 'people' ? <People /> : null}
      {art === 'help' ? <Help /> : null}
    </View>
  );
}

function Tiny({ children, strong, muted, color }: { children: ReactNode; strong?: boolean; muted?: boolean; color?: string }) {
  const theme = useTheme();
  return (
    <ThemedText
      numberOfLines={1}
      style={{
        fontSize: 11,
        lineHeight: 14,
        fontFamily: strong ? Fonts.semibold : Fonts.regular,
        color: color ?? (muted ? theme.textSecondary : theme.text),
      }}>
      {children}
    </ThemedText>
  );
}

function Card({ children, highlight }: { children: ReactNode; highlight?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: highlight ? theme.primary : theme.border, borderWidth: highlight ? 2 : 1 },
      ]}>
      {children}
    </View>
  );
}

function Pill({ label, filled }: { label: string; filled?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: filled ? theme.primary : theme.surface, borderColor: filled ? theme.primary : theme.border }]}>
      <Tiny strong color={filled ? theme.onPrimary : undefined}>
        {label}
      </Tiny>
    </View>
  );
}

function Dot({ letter, color }: { letter: string; color: string }) {
  return (
    <View style={[styles.avatar, { backgroundColor: color }]}>
      <Tiny strong color="#ffffff">
        {letter}
      </Tiny>
    </View>
  );
}

function Welcome() {
  const theme = useTheme();
  return (
    <View style={styles.center}>
      <Image source={require('@/assets/images/icon.png')} style={styles.logo} contentFit="contain" />
      <View style={[styles.money, { backgroundColor: theme.primary }]}>
        <Tiny color={theme.onPrimary}>You&apos;re owed</Tiny>
        <ThemedText style={{ color: theme.onPrimary, fontFamily: Fonts.semibold, fontSize: 22, lineHeight: 26 }}>$42.50</ThemedText>
        <View style={[styles.moneyButton, { backgroundColor: theme.accent }]}>
          <Tiny strong color={theme.onAccent}>
            Add bill
          </Tiny>
        </View>
      </View>
    </View>
  );
}

function Bills() {
  const theme = useTheme();
  return (
    <View style={styles.stack}>
      <Tiny strong>Add a bill</Tiny>
      <Card highlight>
        <Tiny strong>Upload a receipt</Tiny>
        <Tiny muted>Shareplate reads the items</Tiny>
      </Card>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Card>
            <Tiny strong>One total</Tiny>
          </Card>
        </View>
        <View style={styles.grow}>
          <Card>
            <Tiny strong>By item</Tiny>
          </Card>
        </View>
      </View>
      <Card>
        <View style={styles.line}>
          <Tiny>An</Tiny>
          <Tiny strong>$25.00</Tiny>
        </View>
        <View style={styles.line}>
          <Tiny>Minh</Tiny>
          <Tiny strong>$20.00</Tiny>
        </View>
        <View style={styles.line}>
          <Tiny>You</Tiny>
          <Tiny muted color={theme.textSecondary}>
            $15.00 auto
          </Tiny>
        </View>
      </Card>
    </View>
  );
}

function Settle() {
  const theme = useTheme();
  return (
    <View style={styles.stack}>
      <Tiny strong>Settle up</Tiny>
      {[
        ['An', 'You', '$24.00'],
        ['Minh', 'An', '$8.50'],
      ].map(([from, to, amount], i) => (
        <Card key={from} highlight={i === 0}>
          <View style={styles.line}>
            <Tiny>
              {from} pays {to}
            </Tiny>
            <Tiny strong>{amount}</Tiny>
          </View>
          <View style={[styles.zelle, { backgroundColor: theme.surfaceMuted }]}>
            <Tiny muted>Zelle · (614) 555-0142</Tiny>
          </View>
          <View style={[styles.button, { borderColor: theme.border }]}>
            <Tiny strong>Mark as paid</Tiny>
          </View>
        </Card>
      ))}
    </View>
  );
}

function Plan() {
  const theme = useTheme();
  return (
    <View style={styles.stack}>
      <View style={styles.row}>
        <Pill label="Day 1 · Fri" filled />
        <Pill label="Day 2 · Sat" />
      </View>
      {[
        ['9:00 AM', 'Coffee at Mê Linh', 'Mê Linh Coffee Garden'],
        ['7:00 PM', 'Night market', 'Chợ Đêm Đà Lạt'],
      ].map(([time, title, place]) => (
        <Card key={title}>
          <View style={styles.row}>
            <Tiny muted>{time}</Tiny>
            <View style={styles.grow}>
              <Tiny strong>{title}</Tiny>
              <Tiny muted>📍 {place}</Tiny>
            </View>
          </View>
        </Card>
      ))}
      <View style={[styles.bar, { backgroundColor: theme.surfaceMuted }]}>
        <View style={[styles.barFill, { backgroundColor: theme.primary }]} />
      </View>
      <Tiny muted>Day 1: $38 of $60 budget</Tiny>
    </View>
  );
}

function People() {
  const theme = useTheme();
  return (
    <View style={styles.stack}>
      <Tiny strong>Invite friends</Tiny>
      <View style={[styles.zelle, { backgroundColor: theme.surfaceMuted }]}>
        <Tiny muted>shareplate-trips.vercel.app/join?code=…</Tiny>
      </View>
      <View style={[styles.copy, { backgroundColor: theme.primary }]}>
        <Tiny strong color={theme.onPrimary}>
          Copy link
        </Tiny>
      </View>
      <View style={styles.row}>
        <Dot letter="L" color="#8b2c4a" />
        <Dot letter="A" color="#2e5b8a" />
        <Dot letter="M" color="#8a4b2e" />
        <Dot letter="H" color="#6b4d8a" />
        <Pill label="+ Add a guest" />
      </View>
      <Card>
        <View style={styles.line}>
          <Tiny>An added Phở</Tiny>
          <Tiny muted>2 min ago</Tiny>
        </View>
      </Card>
    </View>
  );
}

function Help() {
  const theme = useTheme();
  return (
    <View style={styles.stack}>
      <View style={[styles.search, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <Tiny muted>Search help…</Tiny>
      </View>
      {['Add a bill from a receipt', 'Settle up', 'How does rounding work?'].map((t, i) => (
        <Card key={t}>
          <View style={styles.line}>
            <Tiny strong>{t}</Tiny>
            <Tiny muted>{i === 0 ? '−' : '+'}</Tiny>
          </View>
        </Card>
      ))}
      <View style={[styles.button, { borderColor: theme.border }]}>
        <Tiny strong>Send feedback</Tiny>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 210,
    borderWidth: 1,
    borderRadius: Radius.medium,
    padding: Spacing.three,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  center: { alignItems: 'center', gap: Spacing.three },
  logo: { width: 64, height: 64 },
  money: { borderRadius: Radius.small, padding: Spacing.three, width: '80%', gap: 2 },
  moneyButton: { borderRadius: 999, alignItems: 'center', paddingVertical: 4, marginTop: Spacing.one },
  stack: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.one },
  grow: { flex: 1, minWidth: 0 },
  card: { borderRadius: Radius.small, paddingHorizontal: Spacing.two, paddingVertical: 6, gap: 3 },
  pill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  avatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  zelle: { borderRadius: 6, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  button: { borderWidth: 1, borderRadius: 999, alignItems: 'center', paddingVertical: 3 },
  copy: { borderRadius: 999, alignItems: 'center', paddingVertical: 4 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, width: '63%' },
  search: { borderWidth: 1, borderRadius: 6, paddingHorizontal: Spacing.two, paddingVertical: 5 },
});
