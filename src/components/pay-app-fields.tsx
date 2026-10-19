import { useState } from 'react';
import { View } from 'react-native';

import { Button, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { checkHandle, PAY_APPS, type PayApp } from '@/lib/pay-apps';
import type { PayFields } from '@/lib/queries';

export type PayTexts = Record<PayApp, string>;

export function payTexts(fields: Partial<PayFields> | null | undefined): PayTexts {
  return {
    venmo: fields?.venmo_username ?? '',
    paypal: fields?.paypal_username ?? '',
    cashapp: fields?.cashapp_cashtag ?? '',
  };
}

/** Checks what was typed: the cleaned-up usernames, or a message for each one that isn't right. */
export function readPayTexts(texts: PayTexts): { ok: true; fields: PayFields } | { ok: false; errors: Partial<Record<PayApp, string>> } {
  const errors: Partial<Record<PayApp, string>> = {};
  const fields: PayFields = { venmo_username: null, paypal_username: null, cashapp_cashtag: null };
  for (const a of PAY_APPS) {
    const c = checkHandle(a.app, texts[a.app]);
    if (c.ok) fields[a.field] = c.value;
    else errors[a.app] = c.message;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, fields };
}

const HINTS: Record<PayApp, { label: string; placeholder: string }> = {
  venmo: { label: 'Venmo username (optional)', placeholder: '@your-name' },
  paypal: { label: 'PayPal.Me name (optional)', placeholder: 'paypal.me/yourname' },
  cashapp: { label: 'Cash App $Cashtag (optional)', placeholder: '$yourname' },
};

/**
 * Venmo, PayPal and Cash App boxes. Folded away behind one button until
 * someone wants them, unless one is already filled in.
 */
export function PayAppFields({
  value,
  onChange,
  errors,
  whose = 'your',
}: {
  value: PayTexts;
  onChange: (next: PayTexts) => void;
  errors?: Partial<Record<PayApp, string>>;
  /** "your" or a guest's name, for the button. */
  whose?: string;
}) {
  const [open, setOpen] = useState(() => Object.values(value).some((v) => v.trim()));
  const showing = open || Object.values(errors ?? {}).some(Boolean);
  if (!showing) {
    return (
      <View style={{ alignItems: 'flex-start' }}>
        <Button variant="quiet" label={`Add ${whose} Venmo, PayPal or Cash App`} onPress={() => setOpen(true)} />
      </View>
    );
  }
  return (
    <View style={{ gap: Spacing.three }}>
      {PAY_APPS.map((a) => (
        <TextField
          key={a.app}
          label={HINTS[a.app].label}
          placeholder={HINTS[a.app].placeholder}
          value={value[a.app]}
          onChangeText={(t) => onChange({ ...value, [a.app]: t })}
          error={errors?.[a.app] ?? null}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={80}
        />
      ))}
    </View>
  );
}
