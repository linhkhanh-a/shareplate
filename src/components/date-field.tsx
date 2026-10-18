import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PickerButton } from '@/components/picker-button';
import { Chip, ChipGroup, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { longDate, parseDateText, type DateChoice } from '@/lib/dates';
import { isValidIsoDate } from '@/lib/ledger';

/**
 * A date: quick picks (trip days, or Today and Yesterday), a box that reads
 * what people type ("10/23", "Oct 23", "tomorrow"), and a calendar button.
 *
 * `onChange` gets "YYYY-MM-DD" once the date can be read, the raw text while
 * it can't (so the form knows it isn't valid yet), and "" when cleared.
 */
export function DateField({
  label,
  value,
  onChange,
  choices = [],
  editable = true,
  hint,
  allowEmpty = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  choices?: DateChoice[];
  editable?: boolean;
  hint?: string;
  allowEmpty?: boolean;
}) {
  const shown = (v: string) => (isValidIsoDate(v) ? longDate(v) : v);
  const [text, setText] = useState(shown(value));
  const [synced, setSynced] = useState(value);
  // A chip or the calendar changed the date: show it in the box.
  if (value !== synced) {
    setSynced(value);
    if (parseDateText(text) !== value) setText(shown(value));
  }

  const parsed = parseDateText(text);
  const error = text.trim() && !parsed ? 'Couldn’t read that date. Try 10/23, Oct 23 or 2026-10-23.' : !text.trim() && !allowEmpty ? 'Pick or type a date.' : null;

  function onType(next: string) {
    setText(next);
    const iso = parseDateText(next);
    const out = iso ?? (next.trim() ? next : '');
    setSynced(out);
    onChange(out);
  }

  return (
    <View style={styles.wrap}>
      {choices.length > 0 ? (
        <ChipGroup label={label}>
          {choices.map((c) => (
            <Chip key={c.date} label={c.label} selected={value === c.date} onPress={() => editable && onChange(c.date)} />
          ))}
        </ChipGroup>
      ) : null}
      <View style={styles.row}>
        <View style={styles.grow}>
          <TextField
            label={choices.length > 0 ? 'Or type a date' : label}
            hint={hint ?? 'Like 10/23, Oct 23 or tomorrow'}
            value={text}
            onChangeText={onType}
            onBlur={() => parsed && setText(longDate(parsed))}
            error={error}
            editable={editable}
            maxLength={40}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.button}>
          <PickerButton
            mode="date"
            value={isValidIsoDate(value) ? value : null}
            onPick={(iso) => onChange(iso)}
            label="Calendar"
            accessibilityLabel={`Pick ${label.toLowerCase()} from a calendar`}
            disabled={!editable}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  grow: { flex: 1, minWidth: 0 },
  button: { paddingTop: 26 },
});
