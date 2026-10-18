import { Stack, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/lib/auth';
import { TripLiveProvider } from '@/lib/live';
import { useMembers } from '@/lib/queries';

/** Every screen inside a trip shares one live connection to that trip. */
export default function TripLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const uid = useAuth().session?.user.id;
  const members = useMembers(id);
  const me = members.data?.find((m) => m.user_id === uid && !m.left_at);

  return (
    <TripLiveProvider tripId={id} me={me ? { memberId: me.id, name: me.display_name } : undefined}>
      <Stack screenOptions={{ headerShown: false }} />
    </TripLiveProvider>
  );
}
