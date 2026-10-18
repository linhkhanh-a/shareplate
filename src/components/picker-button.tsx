import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { Button } from '@/components/ui';

const pad = (n: number) => String(n).padStart(2, '0');

function toDate(mode: 'date' | 'time', value: string | null): Date {
  const now = new Date();
  if (!value) return now;
  if (mode === 'date') {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const [h, min] = value.split(':').map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min);
}

function fromDate(mode: 'date' | 'time', date: Date): string {
  return mode === 'date'
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Opens the phone's own calendar or clock. `value` and `onPick` use
 * "YYYY-MM-DD" for dates and "HH:MM" (24-hour) for times.
 */
export function PickerButton({
  mode,
  value,
  onPick,
  label,
  accessibilityLabel,
  disabled,
}: {
  mode: 'date' | 'time';
  value: string | null;
  onPick: (value: string) => void;
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  function onPress() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        mode,
        value: toDate(mode, value),
        onChange: (event: DateTimePickerEvent, date?: Date) => {
          if (event.type === 'set' && date) onPick(fromDate(mode, date));
        },
      });
      return;
    }
    setOpen((v) => !v);
  }

  return (
    <View>
      <Button
        variant="secondary"
        label={open ? 'Done' : label}
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        disabled={disabled}
      />
      {open && Platform.OS === 'ios' ? (
        <DateTimePicker
          mode={mode}
          display={mode === 'date' ? 'inline' : 'spinner'}
          value={toDate(mode, value)}
          onChange={(event: DateTimePickerEvent, date?: Date) => {
            if (event.type === 'set' && date) onPick(fromDate(mode, date));
          }}
        />
      ) : null}
    </View>
  );
}
