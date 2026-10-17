import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Loading, Notice, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { useInvitePreview, useJoinTrip } from '@/lib/queries';

export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { session, signInWithGoogle } = useAuth();
  const preview = useInvitePreview(code);
  const join = useJoinTrip();
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const openTrip = (id: string) => router.replace({ pathname: '/trips/[id]', params: { id } });

  async function onJoin() {
    if (!code) return;
    try {
      openTrip(await join.mutateAsync(code));
    } catch {
      // Shown below.
    }
  }

  async function onSignIn() {
    setSigningIn(true);
    setSignInError(null);
    try {
      // Come straight back to this invite after Google.
      await signInWithGoogle(`/join?code=${encodeURIComponent(code ?? '')}`);
    } catch (e) {
      setSignInError(friendlyError(e));
    } finally {
      setSigningIn(false);
    }
  }

  let body: React.ReactNode;
  if (!code) {
    body = <Notice tone="error">This link is missing its invite code. Ask for the link again.</Notice>;
  } else if (!session) {
    body = (
      <>
        <ThemedText>Sign in with Google to see the trip and join it.</ThemedText>
        {signInError ? <Notice tone="error">{signInError}</Notice> : null}
        <Button label="Continue with Google" onPress={onSignIn} loading={signingIn} />
      </>
    );
  } else if (preview.isPending) {
    body = <Loading />;
  } else if (preview.isError) {
    body = <Notice tone="error">{friendlyError(preview.error)}</Notice>;
  } else if (!preview.data) {
    body = (
      <Notice tone="error">This invite link has expired or was reset. Ask a trip admin for a new one.</Notice>
    );
  } else {
    const p = preview.data;
    body = (
      <>
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="title">{p.group_name}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {p.invited_by ? `${p.invited_by} invited you. ` : ''}
            {p.member_count} {p.member_count === 1 ? 'person is' : 'people are'} on this trip.
          </ThemedText>
        </View>
        {join.isError ? <Notice tone="error">{friendlyError(join.error)}</Notice> : null}
        {p.already_member ? (
          <Button label="Open trip" onPress={() => openTrip(p.group_id)} />
        ) : (
          <Button label="Join trip" onPress={onJoin} loading={join.isPending} />
        )}
      </>
    );
  }

  return (
    <Screen>
      <ThemedText type="heading" themeColor="textSecondary">
        Trip invite
      </ThemedText>
      {body}
      {session ? <Button label="Go to your trips" variant="quiet" onPress={() => router.replace('/')} /> : null}
    </Screen>
  );
}
