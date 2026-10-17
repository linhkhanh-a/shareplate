import { router } from 'expo-router';
import { View } from 'react-native';

import { ProfileForm } from '@/components/profile-form';
import { ThemedText } from '@/components/themed-text';
import { Loading, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useProfile } from '@/lib/queries';

export default function OnboardingScreen() {
  const profile = useProfile();

  return (
    <Screen>
      <View style={{ gap: Spacing.two }}>
        <ThemedText type="title" accessibilityRole="header">
          Set up your profile
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          Two quick things so your friends know who you are and how to pay you back.
        </ThemedText>
      </View>
      {profile.data ? (
        <ProfileForm
          profile={profile.data}
          submitLabel="Save and continue"
          onSaved={() => router.replace('/')}
          onSkip={() => router.replace('/')}
        />
      ) : (
        <Loading />
      )}
    </Screen>
  );
}
