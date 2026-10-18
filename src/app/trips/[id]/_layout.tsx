import { Stack, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/lib/auth';
import { TripLiveProvider } from '@/lib/live';
import { useMembers, useTrip } from '@/lib/queries';
import { currencySymbolFor, setCurrencySymbol } from '@/money';

/** Every screen inside a trip shares one live connection to that trip. */
export default function TripLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const uid = useAuth().session?.user.id;
  const members = useMembers(id);
  const me = members.data?.find((m) => m.user_id === uid && !m.left_at);
  const currency = useTrip(id).data?.currency ?? 'USD';
  // Every amount in this trip is shown in its currency (display only, nothing is converted).
  // Set before the screens render; a change of currency redraws them.
  setCurrencySymbol(currencySymbolFor(currency));

  return (
    <TripLiveProvider tripId={id} me={me ? { memberId: me.id, name: me.display_name } : undefined}>
      <Stack key={currency} screenOptions={{ headerShown: false }} />
    </TripLiveProvider>
  );
}
