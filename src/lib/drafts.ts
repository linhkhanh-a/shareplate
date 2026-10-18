import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Unsaved bills kept on this device, so leaving the screen or reloading the
 * page doesn't lose what was typed. Best effort: storage can be unavailable
 * (private browsing, full storage), and then drafts simply aren't kept.
 */

export interface SavedDraft<T> {
  value: T;
  savedAt: string;
}

const PREFIX = 'shareplate:bill-draft:';

export const draftKey = (tripId: string, billId?: string) => `${PREFIX}${tripId}:${billId ?? 'new'}`;

export async function loadDraft<T>(key: string): Promise<SavedDraft<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedDraft<T>;
    return parsed && typeof parsed.savedAt === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export async function storeDraft<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ value, savedAt: new Date().toISOString() }));
  } catch {
    // Not kept this time; nothing else to do.
  }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}
