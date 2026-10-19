import { useState } from 'react';
import { View } from 'react-native';

import { PayAppFields, payTexts, readPayTexts, type PayTexts } from '@/components/pay-app-fields';
import { Button, Notice, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { friendlyError } from '@/lib/errors';
import { useUpdateProfile, type Profile } from '@/lib/queries';

/** Name + where to be paid (Zelle, Venmo, PayPal, Cash App), used on first-time setup and on the profile screen. */
export function ProfileForm({
  profile,
  submitLabel,
  onSaved,
  onSkip,
}: {
  profile: Profile;
  submitLabel: string;
  onSaved?: () => void;
  onSkip?: () => void;
}) {
  const update = useUpdateProfile();
  const [name, setName] = useState(profile.full_name ?? '');
  const [zelle, setZelle] = useState(profile.zelle_identifier ?? '');
  const [apps, setApps] = useState<PayTexts>(() => payTexts(profile));
  const [appErrors, setAppErrors] = useState<Partial<Record<keyof PayTexts, string>>>({});
  const [nameError, setNameError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(skip = false) {
    setSaved(false);
    const trimmed = name.trim();
    if (!skip && trimmed.length === 0) {
      setNameError('Enter the name your friends know you by.');
      return;
    }
    setNameError(null);
    const read = readPayTexts(apps);
    if (!skip && !read.ok) {
      setAppErrors(read.errors);
      return;
    }
    setAppErrors({});
    const onboarded_at = profile.onboarded_at ?? new Date().toISOString();
    try {
      await update.mutateAsync(
        skip
          ? { onboarded_at }
          : { full_name: trimmed, zelle_identifier: zelle.trim() || null, ...(read.ok ? read.fields : {}), onboarded_at },
      );
      setSaved(true);
      if (skip) onSkip?.();
      else onSaved?.();
    } catch {
      // The error is shown below from update.error.
    }
  }

  return (
    <View style={{ gap: Spacing.four }}>
      <TextField
        label="Your name"
        hint="This is how you appear in trips and on bills."
        value={name}
        onChangeText={setName}
        error={nameError}
        autoComplete="name"
        textContentType="name"
        maxLength={60}
        returnKeyType="next"
      />
      <TextField
        label="Zelle email or phone (optional)"
        hint="People in your trips see these so they can pay you back. The app never moves money."
        value={zelle}
        onChangeText={setZelle}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        maxLength={254}
        onSubmitEditing={() => save()}
      />
      <PayAppFields value={apps} onChange={setApps} errors={appErrors} />
      {Object.keys(appErrors).length > 0 ? <Notice tone="error">Check the payment apps above.</Notice> : null}
      {update.isError ? <Notice tone="error">{friendlyError(update.error)}</Notice> : null}
      {saved && !onSaved ? <Notice tone="success">Saved.</Notice> : null}
      <View style={{ gap: Spacing.two }}>
        <Button label={submitLabel} onPress={() => save()} loading={update.isPending} />
        {onSkip ? <Button label="Skip for now" variant="quiet" onPress={() => save(true)} /> : null}
      </View>
    </View>
  );
}
