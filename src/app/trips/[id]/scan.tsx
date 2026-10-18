import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FormerOnBillNotice } from '@/components/former-on-bill';
import { PlanPicker } from '@/components/plan-picker';
import { TopBar } from '@/components/top-bar';
import { Avatar, Button, Chip, ChipGroup, Loading, Notice, Screen, Section, TextField } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { CATEGORIES, friendlyDate, isValidIsoDate, todayIso } from '@/lib/ledger';
import { useTripLive } from '@/lib/live';
import { pickReceiptPhoto } from '@/lib/photo';
import { formerOnBill } from '@/lib/people';
import { describeEditors } from '@/lib/presence';
import {
  activeMembers,
  readReceipt,
  uploadReceipt,
  useBillItems,
  useBills,
  useMembers,
  useReceiptUrl,
  usePinBill,
  useSaveItemizedBill,
  type Bill,
  type Member,
} from '@/lib/queries';
import {
  checkDraft,
  draftFromBill,
  draftFromScan,
  emptyDraft,
  itemizedPayload,
  looksLikeDiscount,
  moveItemToDiscount,
  newItemKey,
  type DraftItem,
  type ReceiptDraft,
} from '@/lib/receipt';
import { formatCents } from '@/money';

type Step = 'photo' | 'items' | 'totals' | 'people';
const STEPS: { step: Step; label: string }[] = [
  { step: 'items', label: 'Check the items' },
  { step: 'totals', label: 'Check the totals' },
  { step: 'people', label: 'Who had what' },
];

function returnToTrip(tripId: string) {
  if (router.canGoBack()) router.back();
  else router.replace({ pathname: '/trips/[id]', params: { id: tripId } });
}

export default function ScanScreen() {
  const { id: tripId, billId, pin } = useLocalSearchParams<{ id: string; billId?: string; pin?: string }>();
  const uid = useAuth().session?.user.id;
  const members = useMembers(tripId);
  const bills = useBills(tripId);
  const items = useBillItems(billId);
  const [reloads, setReloads] = useState(0);

  const existing = billId ? bills.data?.find((b) => b.id === billId) : undefined;
  const loading = members.isPending || (billId && (bills.isPending || items.isPending));
  const error = members.error ?? bills.error ?? items.error;

  if (loading || error || (billId && !existing)) {
    return (
      <Screen>
        <TopBar />
        {loading ? <Loading /> : <Notice tone="error">{error ? friendlyError(error) : 'This bill was deleted.'}</Notice>}
      </Screen>
    );
  }

  const me = members.data?.find((m) => m.user_id === uid && !m.left_at);
  const initial: ReceiptDraft = existing
    ? draftFromBill({
        ...existing,
        items: (items.data ?? []).map((i) => ({ name: i.name, price_cents: i.price_cents, member_ids: i.member_ids })),
      })
    : emptyDraft({ payerId: me?.id ?? activeMembers(members.data)[0]?.id ?? '', date: todayIso() });

  return (
    <ScanWizard
      key={`${billId ?? 'new'}-${reloads}`}
      tripId={tripId}
      members={members.data ?? []}
      myMemberId={me?.id}
      existing={existing}
      initial={initial}
      onReload={() => setReloads((n) => n + 1)}
      pinTo={pin}
    />
  );
}

function ScanWizard({
  tripId,
  members,
  myMemberId,
  existing,
  initial,
  onReload,
  pinTo,
}: {
  tripId: string;
  members: Member[];
  myMemberId?: string;
  existing?: Bill;
  initial: ReceiptDraft;
  onReload: () => void;
  /** Pins a new bill to this plan activity (when scanned from the activity). */
  pinTo?: string;
}) {
  const save = useSaveItemizedBill(tripId);
  const pin = usePinBill(tripId);
  const [activityId, setActivityId] = useState<string | null>(existing ? existing.itinerary_item_id : (pinTo ?? null));
  const { setEditing, editorsOf } = useTripLive();
  const [step, setStep] = useState<Step>(existing ? 'items' : 'photo');
  const [draft, setDraft] = useState<ReceiptDraft>(initial);
  const [localPhoto, setLocalPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanProblem, setScanProblem] = useState<string | null>(null);
  const [openedVersion] = useState(existing?.version);
  const remotePhoto = useReceiptUrl(localPhoto ? null : draft.imagePath);
  const photoUri = localPhoto ?? remotePhoto.data ?? null;

  const existingId = existing?.id;
  useEffect(() => {
    if (!existingId) return;
    setEditing(existingId);
    return () => setEditing(null);
  }, [existingId, setEditing]);
  const otherEditors = existingId ? editorsOf(existingId) : [];
  const newerVersionSaved = !!existing && openedVersion !== undefined && existing.version > openedVersion;

  const check = checkDraft(draft);
  const people = members.filter((m) => !m.left_at || draft.items.some((i) => i.memberIds.includes(m.id)));
  const nameOf = (id: string) => (id === myMemberId ? 'You' : (members.find((m) => m.id === id)?.display_name ?? 'Someone'));
  const update = (changes: Partial<ReceiptDraft>) => setDraft((d) => ({ ...d, ...changes }));
  const updateItem = (key: string, changes: Partial<DraftItem>) =>
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...changes } : i)) }));

  async function onPhoto(source: 'camera' | 'library') {
    setScanProblem(null);
    let photo: { uri: string } | null;
    try {
      photo = await pickReceiptPhoto(source);
    } catch (e) {
      setScanProblem(friendlyError(e));
      return;
    }
    if (!photo) return;
    setLocalPhoto(photo.uri);
    let path: string;
    try {
      setBusy('Uploading the photo…');
      path = await uploadReceipt(tripId, photo.uri);
    } catch (e) {
      setBusy(null);
      setScanProblem(`Couldn't upload the photo. ${friendlyError(e)}`);
      return;
    }
    try {
      setBusy('Reading the receipt… this takes a few seconds.');
      const scan = await readReceipt(path);
      setDraft((d) => draftFromScan(scan, { payerId: d.payerId, date: d.date, imagePath: path }));
    } catch (e) {
      // Keep the photo so they can type the items while looking at it.
      setDraft((d) => ({ ...d, imagePath: path }));
      setScanProblem(`${friendlyError(e)} The photo is saved, so you can type the items below while looking at it.`);
    } finally {
      setBusy(null);
      setStep('items');
    }
  }

  async function onSave() {
    if (!check.result) return;
    let savedId: string;
    try {
      savedId = await save.mutateAsync(
        itemizedPayload(draft, check.result, { tripId, billId: existing?.id, expectedVersion: openedVersion }),
      );
    } catch {
      // Shown in the footer.
      return;
    }
    try {
      if (activityId !== (existing?.itinerary_item_id ?? null)) await pin.mutateAsync({ billId: savedId, activityId });
      returnToTrip(tripId);
    } catch {
      // Shown in the footer; the bill itself is saved.
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.step === step);
  const footer =
    step === 'photo' ? undefined : (
      <View style={styles.footer}>
        {step === 'people' && save.isError ? <Notice tone="error">{friendlyError(save.error)}</Notice> : null}
        {step === 'people' && pin.isError ? (
          <Notice tone="error">{`The bill is saved, but pinning it to the plan didn't work. ${friendlyError(pin.error)}`}</Notice>
        ) : null}
        <View style={styles.footerButtons}>
          {stepIndex > 0 ? (
            <Button label="Back" variant="secondary" onPress={() => setStep(STEPS[stepIndex - 1].step)} />
          ) : null}
          {step === 'items' ? (
            <Button label="Next: totals" onPress={() => setStep('totals')} disabled={!check.itemsOk} style={styles.grow} />
          ) : step === 'totals' ? (
            <Button
              label="Next: who had what"
              onPress={() => setStep('people')}
              disabled={!check.totals || !isValidIsoDate(draft.date)}
              style={styles.grow}
            />
          ) : (
            <Button
              label={existing ? 'Save changes' : 'Add bill'}
              onPress={onSave}
              disabled={!check.result}
              loading={save.isPending}
              style={styles.grow}
            />
          )}
        </View>
      </View>
    );

  return (
    <Screen footer={footer}>
      <TopBar />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="title" accessibilityRole="header">
          {existing ? 'Edit scanned bill' : 'Scan a receipt'}
        </ThemedText>
        {stepIndex >= 0 ? (
          <ThemedText themeColor="textSecondary">
            Step {stepIndex + 1} of 3: {STEPS[stepIndex].label}
          </ThemedText>
        ) : null}
      </View>

      <FormerOnBillNotice
        tripId={tripId}
        people={existing ? formerOnBill(members, existing) : []}
        canManage={members.some((m) => m.id === myMemberId && m.role === 'admin')}
      />

      {newerVersionSaved ? (
        <Notice tone="error">
          <ThemedText type="strong">Someone just saved changes to this bill</ThemedText>
          <ThemedText type="small">
            Your edits are based on the older version, so saving them won&apos;t work. Load the latest version to see
            their changes.
          </ThemedText>
          <Button label="Load latest version" variant="secondary" onPress={onReload} />
        </Notice>
      ) : otherEditors.length > 0 ? (
        <Notice>{`${describeEditors(otherEditors)} also editing this bill.`}</Notice>
      ) : null}

      {step === 'photo' ? (
        <PhotoStep
          busy={busy}
          problem={scanProblem}
          onPhoto={onPhoto}
          onManual={() => {
            setScanProblem(null);
            setStep('items');
          }}
        />
      ) : null}

      {step === 'items' ? (
        <>
          {photoUri ? <ReceiptPhoto uri={photoUri} /> : null}
          {scanProblem ? <Notice tone="error">{scanProblem}</Notice> : null}
          {draft.warnings.length > 0 ? (
            <Notice>
              <ThemedText type="strong">Double-check against the photo</ThemedText>
              {draft.warnings.map((w) => (
                <ThemedText key={w} type="small">
                  {w}
                </ThemedText>
              ))}
            </Notice>
          ) : null}
          <ItemsStep draft={draft} check={check} updateItem={updateItem} update={update} />
          {check.mismatches.length > 0 ? (
            <Notice>
              {check.mismatches.map((m) => (
                <ThemedText key={m} type="small">
                  {m}
                </ThemedText>
              ))}
            </Notice>
          ) : null}
        </>
      ) : null}

      {step === 'totals' ? (
        <>
          <TotalsStep draft={draft} check={check} update={update} people={people} nameOf={nameOf} scanned={!!draft.imagePath} />
          <PlanPicker tripId={tripId} billDate={draft.date} value={activityId} onChange={setActivityId} />
        </>
      ) : null}

      {step === 'people' ? (
        <PeopleStep draft={draft} check={check} people={people} nameOf={nameOf} updateItem={updateItem} />
      ) : null}
    </Screen>
  );
}

function PhotoStep({
  busy,
  problem,
  onPhoto,
  onManual,
}: {
  busy: string | null;
  problem: string | null;
  onPhoto: (source: 'camera' | 'library') => void;
  onManual: () => void;
}) {
  const theme = useTheme();
  if (busy) {
    return (
      <View style={[styles.photoCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Loading />
        <ThemedText style={styles.center} accessibilityLiveRegion="polite">
          {busy}
        </ThemedText>
      </View>
    );
  }
  return (
    <View style={{ gap: Spacing.three }}>
      <View style={[styles.photoCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <ThemedText type="heading">Take a photo of the whole receipt</ThemedText>
        <ThemedText themeColor="textSecondary">
          Lay it flat in good light. Shareplate reads the items, discount, tax and tip, and you check everything
          before anything is saved.
        </ThemedText>
        <Button label="Take a photo" onPress={() => onPhoto('camera')} />
        <Button label="Choose a photo" variant="secondary" onPress={() => onPhoto('library')} />
      </View>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <Button label="Type the items instead" variant="quiet" onPress={onManual} />
    </View>
  );
}

function ReceiptPhoto({ uri }: { uri: string }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ gap: Spacing.one }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Shrink the receipt photo' : 'Enlarge the receipt photo'}
        onPress={() => setExpanded((v) => !v)}
        style={[styles.photoFrame, { height: expanded ? 640 : 260, borderColor: theme.border, backgroundColor: theme.surfaceMuted }]}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel="Receipt photo" />
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        {expanded ? 'Tap the photo to make it smaller' : 'Tap the photo to make it bigger'}
      </ThemedText>
    </View>
  );
}

function MoneyInput({
  value,
  onChange,
  label,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  invalid?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.money, { borderColor: invalid ? theme.danger : theme.border, backgroundColor: theme.surface }]}>
      <ThemedText themeColor="textSecondary">$</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9.,]/g, ''))}
        placeholder="0.00"
        placeholderTextColor={theme.textSecondary}
        keyboardType="decimal-pad"
        inputMode="decimal"
        style={[styles.moneyText, { color: theme.text }]}
      />
    </View>
  );
}

function ItemsStep({
  draft,
  check,
  updateItem,
  update,
}: {
  draft: ReceiptDraft;
  check: ReturnType<typeof checkDraft>;
  updateItem: (key: string, changes: Partial<DraftItem>) => void;
  update: (changes: Partial<ReceiptDraft>) => void;
}) {
  const theme = useTheme();
  return (
    <Section title="Items">
      <View style={styles.list}>
        {draft.items.map((item, index) => (
          <View key={item.key} style={{ gap: Spacing.one }}>
            <View style={styles.itemRow}>
              <TextInput
                accessibilityLabel={`Item ${index + 1} name`}
                value={item.name}
                onChangeText={(name) => updateItem(item.key, { name })}
                placeholder="Item name"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.itemName,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface },
                ]}
              />
              <MoneyInput
                label={`Item ${index + 1} price`}
                value={item.price}
                onChange={(price) => updateItem(item.key, { price })}
                invalid={!!check.itemErrors[item.key] && check.itemErrors[item.key].includes('price')}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name || `item ${index + 1}`}`}
                onPress={() => update({ items: draft.items.filter((i) => i.key !== item.key) })}
                hitSlop={6}
                style={styles.remove}>
                <ThemedText themeColor="textSecondary" style={styles.removeText}>
                  ×
                </ThemedText>
              </Pressable>
            </View>
            {check.itemErrors[item.key] && (item.name || item.price) ? (
              <ThemedText type="small" themeColor="danger">
                {check.itemErrors[item.key]}
              </ThemedText>
            ) : null}
            {looksLikeDiscount(item.name) ? (
              <View style={styles.discountHint}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
                  This looks like a discount, not something you bought.
                </ThemedText>
                <Button variant="quiet" label="Move to discount" onPress={() => update(moveItemToDiscount(draft, item.key))} />
              </View>
            ) : null}
          </View>
        ))}
      </View>
      <Button
        label="Add item"
        variant="secondary"
        onPress={() => update({ items: [...draft.items, { key: newItemKey(), name: '', price: '', memberIds: [] }] })}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Items subtotal {formatCents(check.totals?.subtotal ?? sumTyped(draft))}
      </ThemedText>
    </Section>
  );
}

function sumTyped(draft: ReceiptDraft) {
  return draft.items.reduce((sum, i) => {
    const n = Math.round(Number(i.price.replace(/,/g, '')) * 100);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

function TotalsStep({
  draft,
  check,
  update,
  people,
  nameOf,
  scanned,
}: {
  draft: ReceiptDraft;
  check: ReturnType<typeof checkDraft>;
  update: (changes: Partial<ReceiptDraft>) => void;
  people: Member[];
  nameOf: (id: string) => string;
  scanned: boolean;
}) {
  const theme = useTheme();
  const [quickDates] = useState(() => [todayIso(), todayIso(new Date(Date.now() - 86_400_000))]);
  const t = check.totals;
  return (
    <>
      <View style={[styles.totals, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <TotalRow label="Items subtotal" value={formatCents(t?.subtotal ?? 0)} />
        <View style={styles.totalField}>
          <ThemedText style={styles.grow}>Discount or voucher</ThemedText>
          <MoneyInput label="Discount" value={draft.discount} onChange={(discount) => update({ discount })} />
        </View>
        <View style={styles.totalField}>
          <View style={styles.grow}>
            <ThemedText>Tax</ThemedText>
            {check.taxRate ? (
              <ThemedText type="small" themeColor="textSecondary">
                {check.taxRate} of the discounted subtotal
              </ThemedText>
            ) : null}
          </View>
          <MoneyInput label="Tax" value={draft.tax} onChange={(tax) => update({ tax })} />
        </View>
        <View style={styles.totalField}>
          <View style={styles.grow}>
            <ThemedText>Tip or service charge</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Split equally between everyone on the bill
            </ThemedText>
          </View>
          <MoneyInput label="Tip" value={draft.tip} onChange={(tip) => update({ tip })} />
        </View>
        <View style={[styles.rule, { borderColor: theme.border }]} />
        <View style={styles.totalField}>
          <ThemedText type="heading" style={styles.grow}>
            Total
          </ThemedText>
          <ThemedText type="money" style={styles.bigMoney}>
            {formatCents(t?.total ?? 0)}
          </ThemedText>
        </View>
      </View>

      {check.totalsMessage ? <Notice tone="error">{check.totalsMessage}</Notice> : null}
      {check.mismatches.length > 0 ? (
        <Notice>
          {check.mismatches.map((m) => (
            <ThemedText key={m} type="small">
              {m}
            </ThemedText>
          ))}
          {check.taxLooksIncluded ? (
            <Button
              variant="secondary"
              label="Tax is already included"
              accessibilityHint="Sets tax to zero so it isn't added on top of the prices"
              onPress={() => update({ tax: '' })}
            />
          ) : null}
        </Notice>
      ) : null}

      <TextField
        label="What was it for?"
        placeholder="Dinner at Phở 24"
        value={draft.title}
        onChangeText={(title) => update({ title })}
        maxLength={120}
      />

      <ChipGroup label={scanned ? 'Category (suggested from the receipt)' : 'Category'}>
        {CATEGORIES.map((c) => (
          <Chip key={c} label={c} selected={draft.category === c} onPress={() => update({ category: c })} />
        ))}
      </ChipGroup>

      <ChipGroup label="Paid by">
        {people
          .filter((m) => !m.left_at || m.id === draft.payerId)
          .map((m) => (
            <Chip key={m.id} label={nameOf(m.id)} selected={draft.payerId === m.id} onPress={() => update({ payerId: m.id })} />
          ))}
      </ChipGroup>

      <View style={{ gap: Spacing.two }}>
        <ChipGroup label="Date">
          {quickDates.map((d) => (
            <Chip key={d} label={friendlyDate(d)} selected={draft.date === d} onPress={() => update({ date: d })} />
          ))}
        </ChipGroup>
        <TextField
          label="Or type a date"
          hint="Year-month-day, like 2026-10-17"
          value={draft.date}
          onChangeText={(date) => update({ date })}
          error={!isValidIsoDate(draft.date) ? 'Use year-month-day, like 2026-10-17.' : null}
          maxLength={10}
          autoCapitalize="none"
        />
      </View>
    </>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.totalField}>
      <ThemedText style={styles.grow}>{label}</ThemedText>
      <ThemedText type="money">{value}</ThemedText>
    </View>
  );
}

function PeopleStep({
  draft,
  check,
  people,
  nameOf,
  updateItem,
}: {
  draft: ReceiptDraft;
  check: ReturnType<typeof checkDraft>;
  people: Member[];
  nameOf: (id: string) => string;
  updateItem: (key: string, changes: Partial<DraftItem>) => void;
}) {
  const theme = useTheme();
  const active = people.filter((m) => !m.left_at);
  return (
    <>
      <ThemedText themeColor="textSecondary">
        Tap everyone who shared each item. Shared dishes are split equally between the people you pick.
      </ThemedText>
      <View style={styles.list}>
        {draft.items.map((item) => {
          const everyone = active.length > 0 && active.every((m) => item.memberIds.includes(m.id));
          return (
            <View key={item.key} style={[styles.assignCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.totalField}>
                <ThemedText type="strong" style={styles.grow} numberOfLines={2}>
                  {item.name}
                </ThemedText>
                <ThemedText type="money">{formatCents(Math.round(Number(item.price.replace(/,/g, '')) * 100) || 0)}</ThemedText>
              </View>
              <View style={styles.chips} accessibilityLabel={`Who had ${item.name}`}>
                <Chip
                  label="Everyone"
                  selected={everyone}
                  onPress={() => updateItem(item.key, { memberIds: everyone ? [] : active.map((m) => m.id) })}
                />
                {people.map((m) => {
                  const on = item.memberIds.includes(m.id);
                  return (
                    <Chip
                      key={m.id}
                      label={nameOf(m.id)}
                      selected={on}
                      onPress={() =>
                        updateItem(item.key, {
                          memberIds: on ? item.memberIds.filter((x) => x !== m.id) : [...item.memberIds, m.id],
                        })
                      }
                    />
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>

      {check.assignMessage ? (
        <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite">
          {check.assignMessage}
        </ThemedText>
      ) : null}

      {check.result ? (
        <Section title="Each person pays">
          <View style={styles.list}>
            {check.result.members.map((m) => (
              <View key={m.memberId} style={styles.personRow}>
                <Avatar name={nameOf(m.memberId)} size={32} />
                <View style={styles.grow}>
                  <ThemedText numberOfLines={1}>{nameOf(m.memberId)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.tabular}>
                    {[
                      `Items ${formatCents(m.itemsCents)}`,
                      m.discountCents ? `discount −${formatCents(m.discountCents)}` : null,
                      m.taxCents ? `tax ${formatCents(m.taxCents)}` : null,
                      m.tipCents ? `tip ${formatCents(m.tipCents)}` : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </ThemedText>
                </View>
                <ThemedText type="money">{formatCents(m.totalCents)}</ThemedText>
              </View>
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Total {formatCents(check.result.totalCents)}, paid by {nameOf(draft.payerId)}.
          </ThemedText>
        </Section>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  center: { textAlign: 'center' },
  tabular: { fontVariant: ['tabular-nums'] },
  footer: { gap: Spacing.two },
  footerButtons: { flexDirection: 'row', gap: Spacing.two },
  photoCard: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.four, gap: Spacing.three },
  photoFrame: { borderWidth: 1, borderRadius: Radius.medium, overflow: 'hidden' },
  list: { gap: Spacing.two },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  itemName: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: Radius.small,
    paddingHorizontal: Spacing.three,
    fontFamily: Fonts.regular,
    fontSize: 16,
  },
  money: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.small,
    paddingHorizontal: Spacing.two,
    width: 104,
    minHeight: 44,
    gap: Spacing.half,
  },
  moneyText: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.medium,
    fontSize: 16,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  remove: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  discountHint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  removeText: { fontSize: 24, lineHeight: 28 },
  totals: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.three },
  totalField: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rule: { borderTopWidth: 1, borderStyle: 'dashed' },
  bigMoney: { fontSize: 22, lineHeight: 28 },
  assignCard: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
