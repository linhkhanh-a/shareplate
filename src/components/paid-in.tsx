import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Chip, ChipGroup, Loading } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { friendlyDate, isValidIsoDate, todayIso } from '@/lib/ledger';
import { fetchRate } from '@/lib/queries';
import { formatRate, PAID_CURRENCIES, paidCurrency } from '@/money';

/**
 * Which currency a bill was paid in. The trip's own is the default; another
 * one gets that day's exchange rate (the European Central Bank's, or an open
 * feed for currencies it doesn't publish), which can be changed to match
 * what a card actually charged.
 */
export function PaidIn({
  tripCurrency,
  paidIn,
  rate,
  date,
  onChange,
  editable = true,
}: {
  tripCurrency: string;
  /** null: the trip's currency. */
  paidIn: string | null;
  rate: string;
  /** The bill's date (YYYY-MM-DD), for that day's rate. */
  date: string;
  onChange: (next: { paidIn: string | null; rate: string }) => void;
  editable?: boolean;
}) {
  const theme = useTheme();
  const [choosing, setChoosing] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  // A failed fetch, for which currency and day.
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  // The currency and day the rate was last fetched for; a saved bill's rate counts as fetched.
  const [fetchedFor, setFetchedFor] = useState<string | null>(paidIn && rate ? `${paidIn}|${date}` : null);
  const [manual, setManual] = useState(false);
  const day = isValidIsoDate(date) ? date : null;
  const want = paidIn && day ? `${paidIn}|${day}` : null;

  const needed = !!want && !manual && want !== fetchedFor && failed?.key !== want;
  const loading = needed;
  const problem = failed && failed.key === want && !manual ? failed.message : null;

  useEffect(() => {
    if (!needed || !paidIn || !day || !want) return;
    let live = true;
    fetchRate(paidIn, tripCurrency, day)
      .then((r) => {
        if (!live) return;
        setFetchedFor(want);
        setInfo(r.date === todayIso() ? `Today’s ${r.source} rate` : `${r.source} rate from ${friendlyDate(r.date)}`);
        onChange({ paidIn, rate: String(Number(r.rate.toPrecision(10))) });
      })
      .catch((e) => live && setFailed({ key: want, message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
    // onChange is a new function each render; the rate only needs fetching when these change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed, paidIn, day, tripCurrency, want]);

  const current = paidCurrency(paidIn);
  const rateNumber = Number(rate.replace(',', '.'));
  const rateOk = rate.trim() !== '' && Number.isFinite(rateNumber) && rateNumber > 0;

  return (
    <View style={{ gap: Spacing.two }}>
      <ChipGroup label="Paid in">
        <Chip
          label={`${tripCurrency} (trip)`}
          selected={!paidIn}
          onPress={() => {
            if (!editable) return;
            setChoosing(false);
            setManual(false);
            onChange({ paidIn: null, rate: '' });
          }}
        />
        {paidIn ? <Chip label={chipLabel(paidIn, current?.symbol ?? '')} selected onPress={() => editable && setChoosing((v) => !v)} /> : null}
        {editable ? <Chip label={choosing ? 'Close' : 'Other currency…'} selected={false} onPress={() => setChoosing((v) => !v)} /> : null}
      </ChipGroup>

      {choosing ? (
        <View style={styles.list} accessibilityLabel="Currencies">
          {PAID_CURRENCIES.filter((c) => c.code !== tripCurrency).map((c) => (
            <Chip
              key={c.code}
              label={chipLabel(c.code, c.symbol)}
              selected={paidIn === c.code}
              onPress={() => {
                setChoosing(false);
                setManual(false);
                setInfo(null);
                setFetchedFor(null);
                onChange({ paidIn: c.code, rate: '' });
              }}
            />
          ))}
        </View>
      ) : null}

      {paidIn ? (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="strong">Exchange rate</ThemedText>
          <View style={styles.rateRow}>
            <ThemedText>{`1 ${paidIn} =`}</ThemedText>
            <TextInput
              accessibilityLabel={`Exchange rate, ${tripCurrency} per ${paidIn}`}
              value={rate}
              onChangeText={(text) => {
                setManual(true);
                onChange({ paidIn, rate: text.replace(/[^0-9.,]/g, '') });
              }}
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={20}
              editable={editable}
              placeholder="1.00"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.rateInput,
                { color: theme.text, backgroundColor: theme.surface, borderColor: !loading && !rateOk ? theme.danger : theme.border },
              ]}
            />
            <ThemedText>{tripCurrency}</ThemedText>
          </View>
          {!loading && !rateOk ? (
            <ThemedText type="small" themeColor="danger">
              Enter the rate, like 1.12
            </ThemedText>
          ) : null}
          {loading ? <Loading /> : null}
          <ThemedText type="small" themeColor="textSecondary">
            {problem ??
              (manual
                ? 'Your own rate, e.g. what your card charged.'
                : info
                  ? `${info}. Change it if your card charged a different rate.`
                  : rateOk
                    ? `Saved rate: 1 ${paidIn} = ${formatRate(rateNumber)} ${tripCurrency}.`
                    : '')}
          </ThemedText>
          {manual && editable ? (
            <Button
              variant="quiet"
              label="Use the day’s rate"
              onPress={() => {
                setManual(false);
                setFetchedFor(null);
                setFailed(null);
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** "JPY ¥", "EUR €", but just "CHF" when the sign is the code. */
function chipLabel(code: string, symbol: string): string {
  const sign = symbol.trim();
  return !sign || sign === code ? code : `${code} ${sign}`;
}

const styles = StyleSheet.create({
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rateInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.small,
    paddingHorizontal: Spacing.three,
    fontFamily: Fonts.regular,
    fontSize: 16,
  },
});
