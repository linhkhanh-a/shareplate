import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ENTRY = /\/_expo\/static\/js\/web\/entry-[0-9a-f]+\.js/;
const EVERY = 10 * 60_000;

/**
 * Website only: a page left open keeps running the version it loaded. When a
 * newer version has been published, offer a reload instead of letting people
 * use the old one without knowing.
 */
export function UpdateBanner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const running = Array.from(document.scripts)
      .map((s) => s.getAttribute('src') ?? '')
      .find((src) => ENTRY.test(src));
    if (!running) return; // Development build: nothing to compare.
    let last = 0;
    const check = async () => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const latest = ENTRY.exec(html)?.[0];
        if (latest && !running.endsWith(latest)) setReady(true);
      } catch {
        // Offline: try again later.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, EVERY);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);

  if (!ready) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + Spacing.three }]}>
      <View
        accessibilityRole="alert"
        style={[styles.banner, { backgroundColor: theme.text, borderColor: theme.border }]}>
        <ThemedText style={[styles.grow, { color: theme.background }]}>A new version of Shareplate is ready.</ThemedText>
        <Button
          label="Reload"
          onPress={() => window.location.reload()}
          style={{ backgroundColor: theme.accent, borderColor: theme.accent }}
          textColor={theme.onAccent}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: Spacing.three },
  banner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  grow: { flex: 1 },
});
