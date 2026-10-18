import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { installState, onInstallChange, promptInstall, type InstallState } from '@/lib/install';

const DISMISSED = 'shareplate.install-hint-dismissed';

function wasDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

/** On the website: a one-time hint to add Shareplate to the home screen. */
export function InstallHint() {
  const theme = useTheme();
  const [state, setState] = useState<InstallState>(() => (Platform.OS === 'web' ? installState() : 'installed'));
  const [hidden, setHidden] = useState(wasDismissed);

  useEffect(() => onInstallChange(() => setState(installState())), []);

  if (hidden || (state !== 'prompt' && state !== 'ios')) return null;

  function dismiss() {
    setHidden(true);
    try {
      globalThis.localStorage?.setItem(DISMISSED, '1');
    } catch {
      // Private browsing: it just shows again next time.
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
      <ThemedText type="strong">Use Shareplate like an app</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {state === 'ios'
          ? 'In Safari, tap the Share button, then “Add to Home Screen”. It opens full screen, straight to your trips.'
          : 'Install it to open it from your home screen or dock, full screen, straight to your trips.'}
      </ThemedText>
      <View style={styles.buttons}>
        {state === 'prompt' ? (
          <Button
            label="Install"
            onPress={() => {
              void promptInstall().then((ok) => (ok ? dismiss() : setState(installState())));
            }}
          />
        ) : null}
        <Button variant="quiet" label={state === 'ios' ? 'Got it' : 'Not now'} onPress={dismiss} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.one },
  buttons: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
});
