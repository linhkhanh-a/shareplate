import { useState } from 'react';
import { View } from 'react-native';

import { ProfileForm } from '@/components/profile-form';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Button, Divider, Loading, Notice, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { useProfile } from '@/lib/queries';

export default function ProfileScreen() {
  const profile = useProfile();
  const { signOut } = useAuth();
  const [signOutError, setSignOutError] = useState<string | null>(null);

  return (
    <Screen>
      <TopBar />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="title" accessibilityRole="header">
          Your profile
        </ThemedText>
        {profile.data ? (
          <ThemedText themeColor="textSecondary">Signed in as {profile.data.email}</ThemedText>
        ) : null}
      </View>

      {profile.isError ? <Notice tone="error">{friendlyError(profile.error)}</Notice> : null}
      {profile.data ? <ProfileForm profile={profile.data} submitLabel="Save changes" /> : <Loading />}

      <Divider />
      <Section>
        {signOutError ? <Notice tone="error">{signOutError}</Notice> : null}
        <Button
          label="Sign out"
          variant="secondary"
          onPress={() => signOut().catch((e) => setSignOutError(friendlyError(e)))}
        />
      </Section>
    </Screen>
  );
}
