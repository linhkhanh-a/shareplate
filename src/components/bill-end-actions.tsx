import { router } from 'expo-router';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Divider, Notice } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { friendlyError } from '@/lib/errors';
import { confirmAction } from '@/lib/platform';
import { useDeleteBill, type Bill, type Member } from '@/lib/queries';

export function returnToTrip(tripId: string) {
  if (router.canGoBack()) router.back();
  else router.replace({ pathname: '/trips/[id]', params: { id: tripId } });
}

/**
 * The last thing on a bill screen: "Delete bill" for a saved bill, or
 * "Discard" for a new one. Both always ask first.
 */
export function BillEndActions({
  tripId,
  existing,
  former,
  dirty,
  onDiscard,
}: {
  tripId: string;
  existing?: Bill;
  /** People on the bill who have left the trip: deleting waits until they're back. */
  former: Member[];
  /** Whether a new bill has anything typed in it yet. */
  dirty: boolean;
  /** Runs before leaving after a discard, e.g. to clear a saved draft. */
  onDiscard?: () => void;
}) {
  const del = useDeleteBill(tripId);

  async function onDelete() {
    if (!existing) return;
    const ok = await confirmAction(
      'Delete this bill?',
      'Balances will update for everyone on it. This can’t be undone.',
      'Delete bill',
    );
    if (!ok) return;
    try {
      await del.mutateAsync(existing.id);
      returnToTrip(tripId);
    } catch {
      // Shown below.
    }
  }

  async function onDiscardPress() {
    if (dirty) {
      const ok = await confirmAction('Discard this bill?', 'Nothing you typed will be saved.', 'Discard');
      if (!ok) return;
    }
    onDiscard?.();
    returnToTrip(tripId);
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <Divider />
      {existing ? (
        <>
          <Button label="Delete bill" variant="danger" onPress={onDelete} loading={del.isPending} disabled={former.length > 0} />
          {former.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              To delete this bill, bring {former.map((m) => m.display_name).join(' and ')} back first.
            </ThemedText>
          ) : null}
          {del.isError ? <Notice tone="error">{friendlyError(del.error)}</Notice> : null}
        </>
      ) : (
        <Button label="Discard this bill" variant="secondary" onPress={onDiscardPress} />
      )}
    </View>
  );
}
