import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { InstallApp } from '@/components/install-app';
import { ProfileForm } from '@/components/profile-form';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Button, Divider, Loading, Notice, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { confirmAction } from '@/lib/platform';
import { useAccountBlockers, useDeleteAccount, useProfile } from '@/lib/queries';
import { formatCents } from '@/money';

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
      <Section title="Help">
        <ThemedText type="small" themeColor="textSecondary">
          A quick tour, step-by-step guides and answers to common questions.
        </ThemedText>
        <Button label="Help and FAQ" variant="secondary" onPress={() => router.push('/help')} />
        <Button
          label="Send feedback"
          variant="secondary"
          onPress={() => router.push({ pathname: '/feedback', params: { from: '/profile' } })}
        />
        <Button label="What’s new" variant="quiet" onPress={() => router.push('/whats-new')} />
      </Section>

      <Section title="Install the app">
        <InstallApp />
      </Section>

      <Divider />
      <Section>
        {signOutError ? <Notice tone="error">{signOutError}</Notice> : null}
        <Button
          label="Sign out"
          variant="secondary"
          onPress={() => signOut().catch((e) => setSignOutError(friendlyError(e)))}
        />
      </Section>

      <DeleteAccount />
    </Screen>
  );
}

/**
 * Deleting your account. Shared trips keep their history (you show up as a
 * former member); trips only you can see are deleted. It's blocked while you
 * owe or are owed money in a shared trip, or are its only admin.
 */
function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const blockers = useAccountBlockers(open);
  const del = useDeleteAccount();

  async function onDelete() {
    const ok = await confirmAction(
      'Delete your account?',
      'This can’t be undone. Trips only you can see are deleted. In shared trips, your past bills stay so everyone’s totals still add up.',
      'Delete account',
    );
    if (!ok) return;
    try {
      await del.mutateAsync();
      // Signed out now; the app goes back to the sign-in screen by itself.
    } catch {
      // Shown below.
    }
  }

  return (
    <Section title="Delete your account">
      {!open ? (
        <Button label="Delete account…" variant="secondary" onPress={() => setOpen(true)} />
      ) : (
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">
            Your profile, Zelle info and sign-in are removed. Trips that only you can see, like quick splits with guests,
            are deleted. In trips you share, your past bills and payments stay, so everyone else’s totals still add up,
            and you show as a former member.
          </ThemedText>
          {blockers.isPending ? <Loading /> : null}
          {blockers.isError ? <Notice tone="error">{friendlyError(blockers.error)}</Notice> : null}
          {blockers.data && blockers.data.length > 0 ? (
            <Notice tone="error">
              <ThemedText type="strong">First, sort these out:</ThemedText>
              {blockers.data.map((b) => (
                <ThemedText key={`${b.group_id}-${b.reason}`} type="small">
                  {b.reason === 'balance'
                    ? `• ${b.trip_name}: you ${b.amount_cents < 0 ? 'owe' : 'are owed'} ${formatCents(Math.abs(b.amount_cents))}. Settle up first.`
                    : `• ${b.trip_name}: you're the only admin. Make someone else an admin first.`}
                </ThemedText>
              ))}
            </Notice>
          ) : null}
          {del.isError ? <Notice tone="error">{friendlyError(del.error)}</Notice> : null}
          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            <Button
              label="Delete my account"
              variant="danger"
              onPress={onDelete}
              loading={del.isPending}
              disabled={!blockers.data || blockers.data.length > 0}
              style={{ flexGrow: 1 }}
            />
            <Button label="Cancel" variant="quiet" onPress={() => setOpen(false)} />
          </View>
        </View>
      )}
    </Section>
  );
}

