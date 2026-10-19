import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { APP_VERSION, unseenReleases, type Release } from '@/lib/changelog';

const KEY = 'shareplate:whats-new-seen';

/**
 * The releases this device hasn't seen yet, and a way to mark them seen.
 * Someone brand new gets the tour instead, which marks everything seen;
 * someone who used Shareplate before this page existed sees the latest release.
 */
export function useWhatsNew(uid: string | undefined) {
  const [unseen, setUnseen] = useState<Release[] | null>(null);
  useEffect(() => {
    if (!uid) return;
    let live = true;
    Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(`shareplate:tour-done:${uid}`)])
      .catch(() => [null, null] as const)
      .then(([seen, toured]) => {
        if (!live) return;
        if (seen) setUnseen(unseenReleases(seen));
        else setUnseen(toured === '1' ? unseenReleases(null).slice(0, 1) : []);
      });
    return () => {
      live = false;
    };
  }, [uid]);
  return {
    unseen: unseen ?? [],
    markSeen: () => {
      setUnseen([]);
      void markWhatsNewSeen();
    },
  };
}

export async function markWhatsNewSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, APP_VERSION);
  } catch {
    // Shown again next time; harmless.
  }
}
