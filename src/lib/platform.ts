import { Alert, Platform, Share } from 'react-native';

/** The public address of the website, used for invite links. */
export function siteUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return process.env.EXPO_PUBLIC_SITE_URL ?? 'https://shareplate-app.vercel.app';
}

/** Asks "are you sure?" and resolves to the answer. Works on web and phones. */
export function confirmAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

/** Opens the share sheet on phones; copies to the clipboard on the web. */
export async function shareLink(message: string, url: string): Promise<'shared' | 'copied'> {
  if (Platform.OS === 'web') {
    await navigator.clipboard.writeText(url);
    return 'copied';
  }
  await Share.share({ message: `${message} ${url}`, url });
  return 'shared';
}
