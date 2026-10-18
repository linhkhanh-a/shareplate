import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Button, Notice, Screen, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/errors';
import { confirmAction } from '@/lib/platform';
import { useCreateTrip, type TripMode } from '@/lib/queries';

const MODES: { value: TripMode; title: string; detail: string }[] = [
  {
    value: 'registered',
    title: 'Group trip',
    detail: 'Everyone signs in. Best for longer trips: friends join with an invite link and see the bills and balances themselves.',
  },
  {
    value: 'quick',
    title: 'Quick split',
    detail: 'No accounts needed. Best for one dinner or a weekend: you add people by name and send them a summary at the end.',
  },
];

export default function NewTripScreen() {
  const theme = useTheme();
  const create = useCreateTrip();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<TripMode>('registered');
  const [nameError, setNameError] = useState<string | null>(null);
  const [guests, setGuests] = useState<string[]>([]);
  const [guest, setGuest] = useState('');

  function addGuest() {
    const trimmed = guest.trim();
    if (!trimmed || guests.length >= 30) return;
    setGuests((g) => [...g, trimmed]);
    setGuest('');
  }

  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Give the trip a name, like "Đà Lạt spring break".');
      return;
    }
    setNameError(null);
    try {
      const pending = guest.trim() ? [...guests, guest.trim()] : guests;
      const id = await create.mutateAsync({ name: trimmed, mode, guests: mode === 'quick' ? pending : [] });
      router.replace({ pathname: '/trips/[id]', params: { id } });
    } catch {
      // Shown below from create.error.
    }
  }

  return (
    <Screen footer={<Button label="Create trip" onPress={onCreate} loading={create.isPending} />}>
      <TopBar />
      <ThemedText type="title" accessibilityRole="header">
        New trip
      </ThemedText>

      <TextField
        label="Trip name"
        placeholder="Đà Lạt spring break"
        value={name}
        onChangeText={setName}
        error={nameError}
        maxLength={100}
        autoFocus
        onSubmitEditing={onCreate}
      />

      <View style={styles.modes} accessibilityRole="radiogroup" accessibilityLabel="Who's on this trip?">
        <ThemedText type="strong">Who&apos;s on this trip?</ThemedText>
        {MODES.map((m) => {
          const selected = m.value === mode;
          return (
            <Pressable
              key={m.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => setMode(m.value)}
              style={[
                styles.mode,
                {
                  backgroundColor: theme.surface,
                  borderColor: selected ? theme.primary : theme.border,
                  borderWidth: selected ? 2 : 1,
                },
              ]}>
              <View style={[styles.radio, { borderColor: selected ? theme.primary : theme.border }]}>
                {selected ? <View style={[styles.radioDot, { backgroundColor: theme.primary }]} /> : null}
              </View>
              <View style={styles.modeText}>
                <ThemedText type="strong">{m.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {m.detail}
                </ThemedText>
              </View>
            </Pressable>
          );
        })}
      </View>

      {mode === 'quick' ? (
        <View style={styles.modes}>
          <TextField
            label="Who's splitting with you?"
            hint="Add people by name. They don't need the app; you'll send each of them their total at the end."
            placeholder="Their name"
            value={guest}
            onChangeText={setGuest}
            maxLength={60}
            onSubmitEditing={addGuest}
            submitBehavior="submit"
          />
          <Button label="Add person" variant="secondary" onPress={addGuest} disabled={!guest.trim()} />
          {guests.length > 0 ? (
            <View style={styles.guests} accessibilityLabel={`${guests.length} people added`}>
              {guests.map((g, i) => (
                <Pressable
                  key={`${g}-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${g}`}
                  onPress={async () => {
                    if (await confirmAction(`Remove ${g}?`, 'They won’t be added to the trip.', 'Remove')) {
                      setGuests((list) => list.filter((_, j) => j !== i));
                    }
                  }}
                  style={[styles.guest, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
                  <ThemedText type="small">{g}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    ×
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {create.isError ? <Notice tone="error">{friendlyError(create.error)}</Notice> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  modes: { gap: Spacing.two },
  mode: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
  },
  modeText: { flex: 1, gap: Spacing.one },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  guests: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  guest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 36,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
