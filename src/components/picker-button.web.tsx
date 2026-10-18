import { useRef } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui';

/**
 * Opens the browser's own calendar or clock. `value` and `onPick` use
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
  const input = useRef<HTMLInputElement>(null);

  function open() {
    const el = input.current;
    if (!el) return;
    el.value = value ?? '';
    try {
      // Chrome, Edge and Safari 16+ open the picker directly.
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  }

  return (
    <View>
      <Button variant="secondary" label={label} accessibilityLabel={accessibilityLabel} onPress={open} disabled={disabled} />
      <input
        ref={input}
        type={mode}
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.currentTarget.value) onPick(e.currentTarget.value);
        }}
        style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 0, padding: 0 }}
      />
    </View>
  );
}
