import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

/**
 * Remembers on this device whether someone has seen the tour, and which
 * trips' "Getting started" lists they've hidden. Best effort: if storage
 * isn't available, the worst case is seeing the tour again.
 */

const tourKey = (uid: string) => `shareplate:tour-done:${uid}`;
const checklistKey = (tripId: string) => `shareplate:checklist-hidden:${tripId}`;

async function read(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === '1';
  } catch {
    return false;
  }
}

async function write(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, '1');
  } catch {
    // Not remembered this time.
  }
}

/** Whether to show the first-run tour for this person, and a way to mark it seen. */
export function useFirstRunTour(uid: string | undefined) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!uid) return;
    let live = true;
    read(tourKey(uid)).then((seen) => live && setShow(!seen));
    return () => {
      live = false;
    };
  }, [uid]);
  return {
    show,
    done: () => {
      setShow(false);
      if (uid) void write(tourKey(uid));
    },
  };
}

/** Whether the trip's "Getting started" list was hidden, and a way to hide it. */
export function useChecklistHidden(tripId: string) {
  const [hidden, setHidden] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    read(checklistKey(tripId)).then((h) => live && setHidden(h));
    return () => {
      live = false;
    };
  }, [tripId]);
  return {
    hidden,
    hide: () => {
      setHidden(true);
      void write(checklistKey(tripId));
    },
  };
}
