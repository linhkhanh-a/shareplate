import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Notice } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { friendlyError } from '@/lib/errors';
import { confirmAction } from '@/lib/platform';
import { useBringBack, type Member } from '@/lib/queries';

/**
 * Shown on a bill that has someone on it who has left the trip. Their
 * balance is locked at $0.00, so their share can't change until they're back.
 */
export function FormerOnBillNotice({ tripId, people, canManage }: { tripId: string; people: Member[]; canManage: boolean }) {
  const bringBack = useBringBack(tripId);
  if (people.length === 0) return null;
  const names = people.map((m) => m.display_name).join(' and ');
  const their = people.length === 1 ? `${people[0].display_name}'s` : 'their';

  async function onBringBack(member: Member) {
    const ok = await confirmAction(
      `Bring ${member.display_name} back?`,
      `${member.display_name} will be back on the list of people, and you can change their share on this bill.`,
      'Bring back',
    );
    if (ok) bringBack.mutate(member.id);
  }

  return (
    <Notice>
      <ThemedText type="strong">
        {names} left the trip
      </ThemedText>
      <ThemedText type="small">
        You can still change the title, date and category, or move money between people still on the trip. To change{' '}
        {their} share or delete this bill, {canManage ? 'bring them back first.' : 'ask a trip admin to bring them back first.'}
      </ThemedText>
      {canManage ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
          {people.map((m) => (
            <Button
              key={m.id}
              variant="secondary"
              label={`Bring ${m.display_name} back`}
              loading={bringBack.isPending && bringBack.variables === m.id}
              onPress={() => onBringBack(m)}
            />
          ))}
        </View>
      ) : null}
      {bringBack.isError ? <ThemedText type="small">{friendlyError(bringBack.error)}</ThemedText> : null}
    </Notice>
  );
}
