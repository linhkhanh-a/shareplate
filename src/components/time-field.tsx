import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PickerButton } from '@/components/picker-button';
import { Segmented, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { guessHalf, joinTime, parseTime, timeParts, type Half } from '@/lib/itinerary';

/**
 * A time: a box for the clock part ("7:30"), an AM | PM switch, and a clock
 * button. Typing "7:30pm" or "19:30" sets the switch by itself. `onChange`
 * gets the whole time as text, e.g. "7:30 PM", or "" when cleared.
 */
export function TimeField({
  label,
  value,
  onChange,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string;
}) {
  const start = timeParts(value);
  const [clock, setClock] = useState(start.clock);
  const [half, setHalf] = useState<Half>(start.half ?? guessHalf(start.clock));
  // Whether AM/PM was chosen (by tapping or typing), rather than guessed.
  const [chosen, setChosen] = useState(start.half !== null);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    const parts = timeParts(value);
    setClock(parts.clock);
    if (parts.half) setHalf(parts.half);
  }

  const send = (nextClock: string, nextHalf: Half) => {
    // A 24-hour time ("19:30") is complete on its own; the switch catches up when you leave the box.
    const hour = Number(/^(\d{1,2})/.exec(nextClock.trim())?.[1] ?? NaN);
    const out = hour === 0 || hour > 12 ? nextClock.trim() : joinTime(nextClock, nextHalf);
    setSynced(out);
    onChange(out);
  };

  function onType(text: string) {
    let nextHalf = half;
    let nextClock = text;
    if (/[apm]/i.test(text)) {
      // Typed "am"/"pm" (even one letter at a time): flip the switch, keep only the clock in the box.
      if (/a/i.test(text)) nextHalf = 'AM';
      else if (/p/i.test(text)) nextHalf = 'PM';
      nextClock = text.replace(/\s*[apm.]+\s*/gi, '').trim();
      setChosen(true);
    } else if (!chosen) {
      nextHalf = guessHalf(text);
    }
    setHalf(nextHalf);
    setClock(nextClock);
    send(nextClock, nextHalf);
  }

  function onBlur() {
    const parts = timeParts(clock);
    if (parts.half && parts.clock !== clock) {
      // "19:30" becomes 7:30 with PM.
      setClock(parts.clock);
      setHalf(parts.half);
      setChosen(true);
      send(parts.clock, parts.half);
    }
  }

  const time24 = parseTime(value);

  return (
    <View style={styles.wrap}>
      <TextField
        label={label}
        placeholder="7:30"
        value={clock}
        onChangeText={onType}
        onBlur={onBlur}
        error={error}
        hint={hint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        maxLength={12}
      />
      <View style={styles.row}>
        <View style={styles.switch}>
          <Segmented
            label={`${label}: AM or PM`}
            options={[
              { value: 'AM', label: 'AM' },
              { value: 'PM', label: 'PM' },
            ]}
            value={half}
            onChange={(h: Half) => {
              setHalf(h);
              setChosen(true);
              send(clock, h);
            }}
          />
        </View>
        <PickerButton
          mode="time"
          value={time24 ?? null}
          onPick={(hhmm) => {
            const parts = timeParts(hhmm);
            const h = parts.half ?? 'AM';
            setClock(parts.clock);
            setHalf(h);
            setChosen(true);
            send(parts.clock, h);
          }}
          label="Clock"
          accessibilityLabel={`Pick ${label.toLowerCase()} from a clock`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  switch: { width: 132 },
});
