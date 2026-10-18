/** What each open copy of the app shares on a trip's live channel. */
export interface PresenceInfo {
  memberId: string;
  name: string;
  /** The bill this person has open in the editor, if any. */
  editingBillId: string | null;
}

/**
 * Turns Supabase's presence state ({ key: [info, info, ...] }) into
 * "who else is editing which bill". The same person with two tabs open counts
 * once, and you never see yourself.
 */
export function editorsByBill(
  state: Record<string, unknown[]>,
  myMemberId: string | undefined,
): Map<string, string[]> {
  const seen = new Map<string, Set<string>>();
  const names = new Map<string, string>();
  for (const entries of Object.values(state)) {
    for (const raw of entries) {
      const info = raw as Partial<PresenceInfo>;
      if (!info.memberId || !info.editingBillId || info.memberId === myMemberId) continue;
      names.set(info.memberId, info.name ?? 'Someone');
      const editors = seen.get(info.editingBillId) ?? new Set<string>();
      editors.add(info.memberId);
      seen.set(info.editingBillId, editors);
    }
  }
  const result = new Map<string, string[]>();
  for (const [billId, ids] of seen) {
    result.set(
      billId,
      [...ids].map((id) => names.get(id)!).sort((a, b) => a.localeCompare(b)),
    );
  }
  return result;
}

/** "Minh is", "Minh and An are", "Minh, An and 2 others are". */
export function describeEditors(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are`;
  const others = names.length - 2;
  return `${names[0]}, ${names[1]} and ${others} ${others === 1 ? 'other' : 'others'} are`;
}
