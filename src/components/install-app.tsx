import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Notice } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { installState, onInstallChange, promptInstall, type InstallState } from '@/lib/install';
import { siteUrl } from '@/lib/platform';

/**
 * "Install the app" on the website: the same Shareplate in its own window,
 * from the dock, taskbar or home screen. It always opens the latest version,
 * so there's never anything to download or update by hand.
 */
export function InstallApp() {
  const [state, setState] = useState<InstallState>(() => installState());
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => onInstallChange(() => setState(installState())), []);
  if (Platform.OS !== 'web') return null;

  const how: Record<InstallState, string> = {
    installed: 'You’re using the installed app. It updates by itself whenever there’s a new version.',
    prompt: 'Open Shareplate in its own window, from your dock, taskbar or home screen. It updates by itself.',
    ios: 'In Safari, tap the Share button, then “Add to Home Screen”. It opens full screen and updates by itself.',
    'mac-safari': 'In Safari, choose File, then “Add to Dock”. Shareplate gets its own window and updates by itself.',
    none: `To install it, open ${siteUrl().replace(/^https?:\/\//, '')} in Chrome or Edge on a computer or Android phone, or Safari on iPhone or Mac.`,
  };

  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="small" themeColor="textSecondary">
        {how[state]}
      </ThemedText>
      {state === 'prompt' ? (
        <Button
          label="Install the app"
          variant="secondary"
          onPress={() => {
            void promptInstall().then((ok) => {
              setState(installState());
              if (ok) setStatus('Installed. Look for Shareplate in your apps.');
            });
          }}
        />
      ) : null}
      {status ? <Notice tone="success">{status}</Notice> : null}
    </View>
  );
}
