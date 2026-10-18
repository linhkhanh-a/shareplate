import { Image } from 'expo-image';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BillEndActions, returnToTrip } from '@/components/bill-end-actions';
import { DateField } from '@/components/date-field';
import { FormerOnBillNotice } from '@/components/former-on-bill';
import { PlanPicker } from '@/components/plan-picker';
import { TopBar } from '@/components/top-bar';
import { Avatar, Button, Chip, ChipGroup, Loading, Notice, Screen, Section, Segmented, TextField } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { confirmAction } from '@/lib/platform';
import { dateChoices } from '@/lib/dates';
import { clearDraft, draftKey, loadDraft, storeDraft, type SavedDraft } from '@/lib/drafts';
import { CATEGORIES, formatPercent, isValidIsoDate, todayIso } from '@/lib/ledger';
import { useTripLive } from '@/lib/live';
import { pickReceiptPhoto } from '@/lib/photo';
import { formerOnBill } from '@/lib/people';
import { timeAgo } from '@/lib/activity';
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
  useTrip,
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
  type ExtraMode,
  type ReceiptDraft,
} from '@/lib/receipt';
import { centsToText, currencySymbol, formatCents, normalizeMoneyText, normalizePercentText, parseMoneyText } from '@/money';

type Step = 'photo' | 'items' | 'totals' | 'people';
const STEPS: { step: Step; label: string; tab: string }[] = [
  { step: 'items', label: 'Check the items', tab: 'Items' },
  { step: 'totals', label: 'Check the totals', tab: 'Totals' },
  { step: 'people', label: 'Who had what', tab: 'People' },
];

/** What's kept on the device while a bill is being entered. */
interface KeptDraft {
  draft: ReceiptDraft;
  step: Step;
  activityId: string | null;
  /** The saved bill's version it started from, so an outdated draft isn't offered. */
  version: number | null;
}

/** The draft without its random item keys, to tell whether anything was changed. */
const signature = (d: ReceiptDraft) => JSON.stringify({ ...d, items: d.items.map(({ key: _key, ...rest }) => rest) });

/** A typed price, or 0 while it can't be read yet. */
const priceOf = (text: string) => {
  try {
    const cents = parseMoneyText(text || '0');
    return cents > 0 ? cents : 0;
  } catch {
    return 0;
  }
};

export default function ScanScreen() {
  const { id: tripId, billId, pin, manual } = useLocalSearchParams<{ id: string; billId?: string; pin?: string; manual?: string }>();
  const trip = useTrip(tripId);
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
      manual={manual === '1'}
      tripDates={{ start: trip.data?.start_date ?? null, end: trip.data?.end_date ?? null }}
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
  manual,
  tripDates,
}: {
  tripId: string;
  members: Member[];
  myMemberId?: string;
  existing?: Bill;
  initial: ReceiptDraft;
  onReload: () => void;
  /** Pins a new bill to this plan activity (when scanned from the activity). */
  pinTo?: string;
  /** Typing the items by hand, no photo. */
  manual: boolean;
  tripDates: { start: string | null; end: string | null };
}) {
  const save = useSaveItemizedBill(tripId);
  const pin = usePinBill(tripId);
  const [activityId, setActivityId] = useState<string | null>(existing ? existing.itinerary_item_id : (pinTo ?? null));
  const { setEditing, editorsOf } = useTripLive();
  const [step, setStep] = useState<Step>(existing || manual ? 'items' : 'photo');
  const [draft, setDraft] = useState<ReceiptDraft>(initial);
  const [localPhoto, setLocalPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanProblem, setScanProblem] = useState<string | null>(null);
  const [openedVersion] = useState(existing?.version);
  const remotePhoto = useReceiptUrl(localPhoto ? null : draft.imagePath);
  const photoUri = localPhoto ?? remotePhoto.data ?? null;
  const [photoSize, setPhotoSize] = useState<PhotoSize>('small');

  // Keep the draft on this device until it's saved, and offer it back next time.
  const keepKey = draftKey(tripId, existing?.id);
  const [kept, setKept] = useState<SavedDraft<KeptDraft> | null>(null);
  const [keptChecked, setKeptChecked] = useState(false);
  const dirty = signature(draft) !== signature(initial);
  useEffect(() => {
    let live = true;
    loadDraft<KeptDraft>(keepKey).then((saved) => {
      if (!live) return;
      const current = saved && (saved.value.version ?? null) === (existing?.version ?? null);
      if (saved && current && signature(saved.value.draft) !== signature(initial)) setKept(saved);
      else if (saved && !current) clearDraft(keepKey);
      setKeptChecked(true);
    });
    return () => {
      live = false;
    };
    // Only when the screen opens: `initial` is fixed for this form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepKey]);
  useEffect(() => {
    // Wait until any kept draft has been offered, so it isn't overwritten first.
    if (!keptChecked || kept) return;
    if (dirty) storeDraft<KeptDraft>(keepKey, { draft, step, activityId, version: openedVersion ?? null });
    else clearDraft(keepKey);
  }, [draft, step, activityId, dirty, keepKey, keptChecked, kept, openedVersion]);

  // Ask before leaving with unsaved changes (the draft is kept either way).
  const [left, setLeft] = useState(false);
  const allowLeave = usePreventRemove(dirty && keptChecked && !kept && !left, ({ repeat }) => {
    confirmAction(
      'Leave this bill?',
      "It isn't saved yet. What you typed stays on this device, and you can continue it next time.",
      'Leave',
    ).then((ok) => {
      if (!ok) return;
      setLeft(true);
      repeat();
    });
  });
  /** Saved, deleted or discarded: leave without asking, and forget the kept draft. */
  function leaving() {
    setLeft(true);
    allowLeave();
    clearDraft(keepKey);
  }

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
      leaving();
      if (activityId !== (existing?.itinerary_item_id ?? null)) await pin.mutateAsync({ billId: savedId, activityId });
      returnToTrip(tripId);
    } catch {
      // Shown in the footer; the bill itself is saved.
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.step === step);
  // Steps go in order: a step opens once everything before it is filled in.
  const itemsDone = check.itemsOk;
  const totalsDone = itemsDone && !!check.totals && isValidIsoDate(draft.date);
  // The furthest step reached so far: you can go back to any of them, or one step on.
  const [furthest, setFurthest] = useState(existing ? 2 : 0);
  const reachable: Record<Exclude<Step, 'photo'>, boolean> = {
    items: true,
    totals: itemsDone && furthest >= 0,
    people: totalsDone && furthest >= 1,
  };
  const done: Record<Exclude<Step, 'photo'>, boolean> = { items: itemsDone, totals: totalsDone, people: !!check.result };
  // What's still missing on this step, shown when someone tries to go on.
  const blocker =
    step === 'items'
      ? itemsDone
        ? null
        : check.totalsMessage
      : step === 'totals'
        ? !check.totals
          ? (check.totalsMessage ?? 'Check the totals.')
          : !isValidIsoDate(draft.date)
            ? 'Pick the date of the bill.'
            : null
        : null;
  const [tried, setTried] = useState<Step | null>(null);
  function goTo(next: Step) {
    if (next === 'photo' || reachable[next]) {
      setTried(null);
      setStep(next);
      const index = STEPS.findIndex((x) => x.step === next);
      if (index > furthest) setFurthest(index);
    } else {
      setTried(step);
    }
  }
  function goNext() {
    if (blocker) {
      setTried(step);
      return;
    }
    goTo(STEPS[stepIndex + 1].step);
  }

  const footer =
    step === 'photo' ? undefined : (
      <View style={styles.footer}>
        {tried === step && blocker ? (
          <Notice tone="error">
            <ThemedText type="small" accessibilityLiveRegion="assertive">
              {blocker}
            </ThemedText>
          </Notice>
        ) : null}
        {step === 'people' && save.isError ? <Notice tone="error">{friendlyError(save.error)}</Notice> : null}
        {step === 'people' && pin.isError ? (
          <Notice tone="error">{`The bill is saved, but pinning it to the plan didn't work. ${friendlyError(pin.error)}`}</Notice>
        ) : null}
        <View style={styles.footerButtons}>
          {stepIndex > 0 ? (
            <Button label="Back" variant="secondary" onPress={() => goTo(STEPS[stepIndex - 1].step)} />
          ) : null}
          {step === 'items' ? (
            <Button label="Next: totals" onPress={goNext} style={itemsDone ? styles.grow : { ...styles.grow, ...styles.dimmed }} />
          ) : step === 'totals' ? (
            <Button label="Next: who had what" onPress={goNext} style={totalsDone ? styles.grow : { ...styles.grow, ...styles.dimmed }} />
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
          {existing ? (existing.bill_image_path ? 'Edit scanned bill' : 'Edit bill') : manual ? 'Bill by item' : 'Scan a receipt'}
        </ThemedText>
        {stepIndex >= 0 ? (
          <ThemedText themeColor="textSecondary">
            Step {stepIndex + 1} of 3: {STEPS[stepIndex].label}
          </ThemedText>
        ) : null}
      </View>

      {!existing && step !== 'photo' && !draft.imagePath ? (
        <Segmented
          label="How to enter it"
          options={[
            { value: 'total', label: 'One total' },
            { value: 'items', label: 'By item' },
          ]}
          value="items"
          onChange={async (v) => {
            if (v !== 'total') return;
            if (dirty && !(await confirmAction('Switch to one total?', "The items you typed won't be kept.", 'Switch'))) return;
            leaving();
            router.replace({ pathname: '/trips/[id]/bill', params: pinTo ? { id: tripId, pin: pinTo } : { id: tripId } });
          }}
        />
      ) : null}

      {kept ? (
        <Notice>
          <ThemedText type="strong">Continue where you left off?</ThemedText>
          <ThemedText type="small">
            {`You have an unsaved ${kept.value.draft.title.trim() || kept.value.draft.vendor.trim() || 'bill'} from ${timeAgo(kept.savedAt)}.`}
          </ThemedText>
          <View style={styles.footerButtons}>
            <Button
              label="Continue it"
              onPress={() => {
                setDraft(kept.value.draft);
                setStep(kept.value.step);
                setFurthest(Math.max(0, STEPS.findIndex((x) => x.step === kept.value.step)));
                setActivityId(kept.value.activityId);
                setKept(null);
              }}
              style={styles.grow}
            />
            <Button
              label="Start over"
              variant="secondary"
              onPress={async () => {
                if (await confirmAction('Start over?', 'The unsaved bill on this device will be thrown away.', 'Start over')) {
                  clearDraft(keepKey);
                  setKept(null);
                }
              }}
              style={styles.grow}
            />
          </View>
        </Notice>
      ) : null}

      {step !== 'photo' ? (
        <Stepper current={step} reachable={reachable} done={done} furthest={furthest} onGo={goTo} />
      ) : null}

      {step !== 'photo' && photoUri ? <ReceiptPhoto uri={photoUri} size={photoSize} onSize={setPhotoSize} /> : null}

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
          <ItemsStep draft={draft} check={check} updateItem={updateItem} update={update} showAllErrors={tried === 'items'} />
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
          <TotalsStep
            draft={draft}
            check={check}
            update={update}
            people={people}
            nameOf={nameOf}
            scanned={!!draft.imagePath}
            dateOptions={dateChoices(tripDates.start, tripDates.end)}
          />
          <PlanPicker tripId={tripId} billDate={draft.date} value={activityId} onChange={setActivityId} />
        </>
      ) : null}

      {step === 'people' ? (
        <PeopleStep draft={draft} check={check} people={people} nameOf={nameOf} updateItem={updateItem} />
      ) : null}

      {step !== 'photo' ? (
        <BillEndActions
          tripId={tripId}
          existing={existing}
          former={existing ? formerOnBill(members, existing) : []}
          dirty={dirty}
          beforeLeave={leaving}
        />
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

/**
 * 1 Items → 2 Totals → 3 People, one after another. Green marks only where
 * you are and the steps you've finished; lines run between the circles and
 * turn green once both ends are. A step opens once the ones before it are done.
 */
function Stepper({
  current,
  reachable,
  done,
  furthest,
  onGo,
}: {
  current: Step;
  reachable: Record<Exclude<Step, 'photo'>, boolean>;
  done: Record<Exclude<Step, 'photo'>, boolean>;
  /** Index of the furthest step visited so far. */
  furthest: number;
  onGo: (step: Step) => void;
}) {
  const theme = useTheme();
  // Finished means done and already gone through, never a step you haven't reached.
  const state = STEPS.map((s, i) => {
    const key = s.step as Exclude<Step, 'photo'>;
    const isCurrent = current === s.step;
    const finished = !isCurrent && done[key] && i <= furthest;
    return { isCurrent, finished, green: isCurrent || finished, open: reachable[key] };
  });
  const line = (green: boolean) => [styles.stepLine, { backgroundColor: green ? theme.primary : theme.border }];
  return (
    <View accessibilityRole="list" accessibilityLabel="Steps" style={styles.stepper}>
      {STEPS.map((s, i) => {
        const { isCurrent, finished, green, open } = state[i];
        return (
          <Pressable
            key={s.step}
            accessibilityRole="button"
            accessibilityLabel={`Step ${i + 1} of 3: ${s.label}${finished ? ', done' : ''}${isCurrent ? ', current step' : ''}${open ? '' : ', locked until the steps before it are done'}`}
            accessibilityState={{ disabled: !open, selected: isCurrent }}
            aria-current={isCurrent ? 'step' : undefined}
            onPress={() => onGo(s.step)}
            style={styles.stepCell}>
            <View style={styles.stepTrack}>
              {/* Each half-line stops at the circle's edge. */}
              <View style={i === 0 ? styles.stepLineSpace : line(green && state[i - 1].green)} />
              <View
                style={[
                  styles.stepDot,
                  {
                    backgroundColor: green ? theme.primary : theme.surface,
                    borderColor: green ? theme.primary : open ? theme.textSecondary : theme.border,
                  },
                ]}>
                <ThemedText type="strong" style={{ color: green ? theme.onPrimary : open ? theme.text : theme.textSecondary }}>
                  {finished ? '✓' : String(i + 1)}
                </ThemedText>
              </View>
              <View style={i === STEPS.length - 1 ? styles.stepLineSpace : line(green && state[i + 1].green)} />
            </View>
            <ThemedText
              type="small"
              style={{
                color: green ? theme.text : theme.textSecondary,
                fontFamily: isCurrent ? Fonts.semibold : Fonts.regular,
              }}>
              {s.tab}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

type PhotoSize = 'hidden' | 'small' | 'large';

/** The receipt photo, on every step so the numbers can be compared as you go. */
function ReceiptPhoto({ uri, size, onSize }: { uri: string; size: PhotoSize; onSize: (s: PhotoSize) => void }) {
  const theme = useTheme();
  if (size === 'hidden') {
    return <Button variant="quiet" label="Show the receipt photo" onPress={() => onSize('small')} />;
  }
  return (
    <View style={{ gap: Spacing.one }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={size === 'large' ? 'Shrink the receipt photo' : 'Enlarge the receipt photo'}
        onPress={() => onSize(size === 'large' ? 'small' : 'large')}
        style={[styles.photoFrame, { height: size === 'large' ? 640 : 220, borderColor: theme.border, backgroundColor: theme.surfaceMuted }]}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel="Receipt photo" />
      </Pressable>
      <View style={styles.photoBar}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
          {size === 'large' ? 'Tap the photo to make it smaller' : 'Tap the photo to make it bigger'}
        </ThemedText>
        <Button variant="quiet" label="Hide photo" onPress={() => onSize('hidden')} />
      </View>
    </View>
  );
}

function MoneyInput({
  value,
  onChange,
  label,
  invalid,
  mode = 'amount',
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  invalid?: boolean;
  /** An amount ("12.50") or a percentage ("10"). */
  mode?: ExtraMode;
}) {
  const theme = useTheme();
  const percent = mode === 'percent';
  return (
    <View style={[styles.money, { borderColor: invalid ? theme.danger : theme.border, backgroundColor: theme.surface }]}>
      {percent ? null : <ThemedText themeColor="textSecondary">{currencySymbol().trim()}</ThemedText>}
      <TextInput
        accessibilityLabel={percent ? `${label} percent` : label}
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9.,%]/g, ''))}
        // Round to the cent (or hundredth of a percent) as soon as you leave the box.
        onBlur={() => {
          const normal = percent ? normalizePercentText(value) : normalizeMoneyText(value);
          if (normal !== null && normal !== value) onChange(normal);
        }}
        placeholder={percent ? '0' : '0.00'}
        placeholderTextColor={theme.textSecondary}
        keyboardType="decimal-pad"
        inputMode="decimal"
        style={[styles.moneyText, { color: theme.text }]}
      />
      {percent ? <ThemedText themeColor="textSecondary">%</ThemedText> : null}
    </View>
  );
}

function ItemsStep({
  draft,
  check,
  updateItem,
  update,
  showAllErrors,
}: {
  draft: ReceiptDraft;
  check: ReturnType<typeof checkDraft>;
  updateItem: (key: string, changes: Partial<DraftItem>) => void;
  update: (changes: Partial<ReceiptDraft>) => void;
  /** After trying to go on: point at empty rows too, not just half-typed ones. */
  showAllErrors: boolean;
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
                  {
                    color: theme.text,
                    // Red once you've tried to go on (or started typing) and it still needs a name.
                    borderColor:
                      !item.name.trim() && check.itemErrors[item.key] && (showAllErrors || item.price) ? theme.danger : theme.border,
                    backgroundColor: theme.surface,
                  },
                ]}
              />
              <MoneyInput
                label={`Item ${index + 1} price`}
                value={item.price}
                onChange={(price) => updateItem(item.key, { price })}
                invalid={
                  !!check.itemErrors[item.key] &&
                  (check.itemErrors[item.key].includes('price') || (showAllErrors && !item.price.trim()))
                }
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name || `item ${index + 1}`}`}
                onPress={async () => {
                  // Empty rows go right away; rows with something typed ask first.
                  if (item.name.trim() || item.price.trim()) {
                    const ok = await confirmAction(
                      `Remove ${item.name.trim() || `item ${index + 1}`}?`,
                      'It comes off this bill. You can type it in again if you need it.',
                      'Remove item',
                    );
                    if (!ok) return;
                  }
                  update({ items: draft.items.filter((i) => i.key !== item.key) });
                }}
                hitSlop={6}
                style={styles.remove}>
                <ThemedText themeColor="textSecondary" style={styles.removeText}>
                  ×
                </ThemedText>
              </Pressable>
            </View>
            {check.itemErrors[item.key] && (item.name || item.price || showAllErrors) ? (
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
  return draft.items.reduce((sum, i) => sum + priceOf(i.price), 0);
}

function TotalsStep({
  draft,
  check,
  update,
  people,
  nameOf,
  scanned,
  dateOptions,
}: {
  draft: ReceiptDraft;
  check: ReturnType<typeof checkDraft>;
  update: (changes: Partial<ReceiptDraft>) => void;
  people: Member[];
  nameOf: (id: string) => string;
  scanned: boolean;
  dateOptions: ReturnType<typeof dateChoices>;
}) {
  const theme = useTheme();
  const t = check.totals;
  return (
    <>
      <View style={[styles.totals, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <TotalRow label="Items subtotal" value={formatCents(t?.subtotal ?? 0)} />
        <ExtraRow
          label="Discount or voucher"
          hint="A % is of the items."
          field="discount"
          draft={draft}
          update={update}
          cents={t?.discount ?? null}
          base={t?.subtotal ?? null}
        />
        <ExtraRow
          label="Tax"
          hint={check.taxRate && draft.taxMode === 'amount' ? `${check.taxRate} of the discounted subtotal` : 'A % is of the items after discount.'}
          field="tax"
          draft={draft}
          update={update}
          cents={t?.tax ?? null}
          base={t ? t.subtotal - t.discount : null}
        />
        <ExtraRow
          label="Tip or service charge"
          hint="Split equally between everyone on the bill. A % is of the items after discount, before tax."
          field="tip"
          draft={draft}
          update={update}
          cents={t?.tip ?? null}
          base={t ? t.subtotal - t.discount : null}
        />
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
              onPress={() => update({ tax: '', taxMode: 'amount' })}
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

      <DateField label="Date" value={draft.date} onChange={(date) => update({ date })} choices={dateOptions} />
    </>
  );
}

/** Discount, tax or tip, typed as an amount or a percentage. */
function ExtraRow({
  label,
  hint,
  field,
  draft,
  update,
  cents,
  base,
}: {
  label: string;
  hint: string;
  field: 'discount' | 'tax' | 'tip';
  draft: ReceiptDraft;
  update: (changes: Partial<ReceiptDraft>) => void;
  /** What it comes to, once it can be worked out. */
  cents: number | null;
  /** What a percentage is taken of. */
  base: number | null;
}) {
  const modeKey = `${field}Mode` as const;
  const mode = draft[modeKey];
  return (
    <View style={{ gap: Spacing.one }}>
      <View style={styles.totalField}>
        <View style={styles.grow}>
          <ThemedText>{label}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        </View>
        <MoneyInput label={label} value={draft[field]} onChange={(v) => update({ [field]: v })} mode={mode} />
      </View>
      <View style={styles.totalField}>
        <View style={styles.modeSwitch}>
          <Segmented
            label={`${label} as an amount or a percentage`}
            options={[
              { value: 'amount', label: currencySymbol().trim() },
              { value: 'percent', label: '%' },
            ]}
            value={mode}
            onChange={(next: ExtraMode) => {
              if (next === mode) return;
              // Keep the same money when switching: 10% of $40 becomes $4.00, and back.
              update({ [modeKey]: next, [field]: switchedText(draft[field], next, cents, base) });
            }}
          />
        </View>
        {mode === 'percent' && cents !== null ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
            {`= ${formatCents(cents)}`}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

/** The text to show after switching between $ and %, so the amount stays the same where it can. */
function switchedText(text: string, next: ExtraMode, cents: number | null, base: number | null): string {
  if (!text.trim() || cents === null) return '';
  if (next === 'amount') return cents ? centsToText(cents) : '';
  if (!base || base <= 0) return '';
  return formatPercent(Math.round((cents * 10_000) / base)).replace('%', '');
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
                <ThemedText type="money">{formatCents(priceOf(item.price))}</ThemedText>
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
  stepper: { flexDirection: 'row', alignItems: 'flex-start' },
  stepCell: { flex: 1, alignItems: 'center', gap: Spacing.one, minHeight: 44 },
  stepTrack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  stepLine: { flex: 1, height: 2 },
  stepLineSpace: { flex: 1 },
  stepDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.55 },
  photoBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  modeSwitch: { width: 120 },
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
