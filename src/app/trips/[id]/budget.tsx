import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BudgetBar, BudgetLegend } from '@/components/budget-bar';
import { LiveBadge } from '@/components/live-badge';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Avatar, Button, Loading, Notice, Pill, Screen, Section, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { leftOrOver, personBudget, scaleFor, tripBudget, type BudgetRow } from '@/lib/budget';
import { friendlyError } from '@/lib/errors';
import { todayIso } from '@/lib/ledger';
import {
  activeMembers,
  useBills,
  useItinerary,
  useMembers,
  useSetAllowance,
  useSetTripBudget,
  useTrip,
  type Member,
} from '@/lib/queries';
import { centsToText, formatCents, parseMoneyText } from '@/money';

export default function BudgetScreen() {
  const { id: tripId } = useLocalSearchParams<{ id: string }>();
  const uid = useAuth().session?.user.id;
  const trip = useTrip(tripId);
  const bills = useBills(tripId);
  const plan = useItinerary(tripId);
  const members = useMembers(tripId);
  const [today] = useState(() => todayIso());

  if (trip.isPending || bills.isPending || members.isPending) {
    return (
      <Screen>
        <TopBar />
        <Loading />
      </Screen>
    );
  }
  if (trip.isError || bills.isError || members.isError) {
    return (
      <Screen>
        <TopBar />
        <Notice tone="error">{friendlyError(trip.error ?? bills.error ?? members.error)}</Notice>
      </Screen>
    );
  }

  const me = members.data.find((m) => m.user_id === uid && !m.left_at);
  const isAdmin = me?.role === 'admin';
  const { start_date: start, end_date: end } = trip.data;
  const t = tripBudget({
    budgetCents: trip.data.total_budget_cents,
    bills: bills.data,
    activities: plan.data ?? [],
    start,
    end,
    today,
  });
  const people = activeMembers(members.data).map((m) =>
    personBudget({ memberId: m.id, allowancePerDay: m.daily_allowance_cents, bills: bills.data, start, end, today }),
  );
  const mine = people.find((p) => p.memberId === me?.id);

  return (
    <Screen>
      <TopBar right={<LiveBadge />} />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="title" accessibilityRole="header">
          Budget
        </ThemedText>
        <ThemedText themeColor="textSecondary">{trip.data.name}</ThemedText>
      </View>

      <TripTotal tripId={tripId} budget={t} canEdit={isAdmin} />

      <Section title="Day by day">
        {t.rows.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing spent yet.
          </ThemedText>
        ) : (
          <>
            <BudgetLegend targetLabel={t.perDay ? 'Daily budget' : null} />
            <Rows rows={t.rows} showPlanned />
          </>
        )}
        {t.outside.before > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {`${formatCents(t.outside.before)} was spent before the trip started (like bookings). It counts toward the total.`}
          </ThemedText>
        ) : null}
        {t.outside.after > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {`${formatCents(t.outside.after)} was spent after the last day.`}
          </ThemedText>
        ) : null}
        {t.days === 0 ? (
          <View style={{ gap: Spacing.two }}>
            <ThemedText type="small" themeColor="textSecondary">
              Add the trip&apos;s dates in the plan to see each day against the budget.
            </ThemedText>
            <Button
              variant="secondary"
              label="Open the trip plan"
              onPress={() => router.push({ pathname: '/trips/[id]/plan', params: { id: tripId } })}
            />
          </View>
        ) : null}
      </Section>

      {me && mine ? (
        <Section title="Your daily allowance">
          <ThemedText type="small" themeColor="textSecondary">
            How much you want to spend each day. It counts your share of each bill, so a $60 dinner split three ways is
            $20 for you.
          </ThemedText>
          <AllowanceEditor tripId={tripId} member={me} />
          {mine.allowanceTotal !== null ? (
            <ThemedText style={styles.tabular}>
              {`Your share so far: ${formatCents(mine.spent)} of ${formatCents(mine.allowanceTotal)} for ${t.days} days. ${leftOrOver(mine.allowanceTotal - mine.spent)}.`}
            </ThemedText>
          ) : (
            <ThemedText style={styles.tabular}>{`Your share so far: ${formatCents(mine.spent)}.`}</ThemedText>
          )}
          {mine.rows.length > 0 ? (
            <>
              <BudgetLegend targetLabel={mine.allowancePerDay > 0 ? 'Your allowance' : null} />
              <Rows rows={mine.rows} showPlanned={false} />
            </>
          ) : null}
        </Section>
      ) : null}

      <Section title="Everyone">
        <Everyone tripId={tripId} members={activeMembers(members.data)} people={people} myId={me?.id} isAdmin={isAdmin} />
      </Section>
    </Screen>
  );
}

/** The whole trip: spent against the budget, with the plan for reference. */
function TripTotal({
  tripId,
  budget: t,
  canEdit,
}: {
  tripId: string;
  budget: ReturnType<typeof tripBudget>;
  canEdit: boolean;
}) {
  const theme = useTheme();
  const setBudget = useSetTripBudget(tripId);
  const [editing, setEditing] = useState(false);
  const has = t.budget > 0;
  const max = Math.max(t.budget, t.spent);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <ThemedText themeColor="textSecondary">Spent on the trip</ThemedText>
      <ThemedText type="display" style={styles.tabular}>
        {formatCents(t.spent)}
      </ThemedText>
      {has ? (
        <>
          <BudgetBar value={t.spent} target={t.budget} max={max} />
          <ThemedText style={styles.tabular}>
            {`of ${formatCents(t.budget)} budget. `}
            <ThemedText type="strong" themeColor={t.left < 0 ? 'danger' : 'text'}>
              {leftOrOver(t.left)}
            </ThemedText>
          </ThemedText>
          {t.perDay ? (
            <ThemedText type="small" themeColor="textSecondary">
              {`About ${formatCents(t.perDay)} a day over ${t.days} days.`}
            </ThemedText>
          ) : null}
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {canEdit ? 'No budget yet. Set one to see how the trip is tracking.' : 'No budget set yet. A trip admin can set one.'}
        </ThemedText>
      )}
      {t.planned > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {`The trip plan expects ${formatCents(t.planned)}.`}
        </ThemedText>
      ) : null}

      {canEdit && !editing ? (
        <Button
          variant="secondary"
          label={has ? 'Change budget' : 'Set a budget'}
          onPress={() => setEditing(true)}
          style={styles.cardButton}
        />
      ) : null}
      {editing ? (
        <AmountForm
          label="Trip budget"
          hint="For the whole trip and everyone in it, in dollars. Leave it empty to remove the budget."
          initial={t.budget}
          pending={setBudget.isPending}
          error={setBudget.error}
          onSave={async (cents) => {
            await setBudget.mutateAsync(cents);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </View>
  );
}

function Rows({ rows, showPlanned }: { rows: BudgetRow[]; showPlanned: boolean }) {
  const max = scaleFor(rows, showPlanned);
  return (
    <View style={{ gap: Spacing.three }}>
      {rows.map((r) => {
        const parts = [formatCents(r.spent)];
        if (r.allowance !== null) parts.push(`of ${formatCents(r.allowance)}`);
        const over = r.allowance !== null && r.spent > r.allowance;
        const detail = [
          showPlanned && r.planned > 0 ? `Planned ${formatCents(r.planned)}` : '',
          over ? `${formatCents(r.spent - r.allowance!)} over` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <View
            key={r.date}
            accessible
            accessibilityLabel={`${r.label}: ${parts.join(' ')} spent${r.isToday ? ', today' : ''}${detail ? `. ${detail}` : ''}`}>
            <View style={styles.rowHead}>
              <ThemedText type="strong" style={styles.grow} numberOfLines={1}>
                {r.label}
              </ThemedText>
              {r.isToday ? <Pill label="Today" tone="accent" /> : null}
              <ThemedText style={styles.tabular}>{parts.join(' ')}</ThemedText>
            </View>
            <BudgetBar value={r.spent} target={r.allowance} max={max} />
            {detail ? (
              <ThemedText type="small" themeColor={over ? 'danger' : 'textSecondary'} style={styles.tabular}>
                {detail}
              </ThemedText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function AllowanceEditor({ tripId, member, compact }: { tripId: string; member: Member; compact?: boolean }) {
  const set = useSetAllowance(tripId);
  const [editing, setEditing] = useState(false);
  const has = member.daily_allowance_cents > 0;
  if (editing) {
    return (
      <AmountForm
        label={compact ? `${member.display_name}'s daily allowance` : 'Daily allowance'}
        hint="In dollars per day. Leave empty or 0 for none."
        initial={member.daily_allowance_cents}
        pending={set.isPending}
        error={set.error}
        onSave={async (cents) => {
          await set.mutateAsync({ memberId: member.id, cents });
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <View style={styles.rowHead}>
      {!compact ? (
        <ThemedText type="heading" style={[styles.grow, styles.tabular]}>
          {has ? `${formatCents(member.daily_allowance_cents)} a day` : 'Not set'}
        </ThemedText>
      ) : null}
      <Button
        variant={compact ? 'quiet' : 'secondary'}
        label={has ? 'Change' : compact ? 'Set allowance' : 'Set my allowance'}
        accessibilityLabel={compact ? `Set ${member.display_name}'s allowance` : undefined}
        onPress={() => setEditing(true)}
      />
    </View>
  );
}

function Everyone({
  tripId,
  members,
  people,
  myId,
  isAdmin,
}: {
  tripId: string;
  members: Member[];
  people: ReturnType<typeof personBudget>[];
  myId?: string;
  isAdmin: boolean;
}) {
  const theme = useTheme();
  const max = people.reduce((m, p) => Math.max(m, p.spent, p.allowanceTotal ?? 0), 0);
  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="small" themeColor="textSecondary">
        Each person&apos;s share of the bills so far, against their own allowance for the trip.
      </ThemedText>
      {people.map((p) => {
        const m = members.find((x) => x.id === p.memberId)!;
        const name = p.memberId === myId ? 'You' : m.display_name;
        const target = p.allowanceTotal;
        const summary =
          target !== null
            ? `${formatCents(p.spent)} of ${formatCents(target)}`
            : `${formatCents(p.spent)}${p.allowancePerDay > 0 ? `, ${formatCents(p.allowancePerDay)} a day` : ''}`;
        const over = target !== null && p.spent > target;
        return (
          <View key={p.memberId} style={[styles.person, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.rowHead} accessible accessibilityLabel={`${name}: ${summary}${over ? ', over' : ''}`}>
              <Avatar name={m.display_name} size={32} />
              <ThemedText type="strong" style={styles.grow} numberOfLines={1}>
                {name}
              </ThemedText>
              <ThemedText style={styles.tabular}>{summary}</ThemedText>
            </View>
            <BudgetBar value={p.spent} target={target} max={max} />
            <ThemedText type="small" themeColor={over ? 'danger' : 'textSecondary'} style={styles.tabular}>
              {target !== null
                ? `${formatCents(p.allowancePerDay)} a day. ${leftOrOver(target - p.spent)}.`
                : p.allowancePerDay > 0
                  ? 'Add trip dates to compare with the allowance.'
                  : 'No allowance set.'}
            </ThemedText>
            {isAdmin && p.memberId !== myId ? <AllowanceEditor tripId={tripId} member={m} compact /> : null}
          </View>
        );
      })}
    </View>
  );
}

/** A small "enter an amount" form used for the budget and allowances. */
function AmountForm({
  label,
  hint,
  initial,
  pending,
  error,
  onSave,
  onCancel,
}: {
  label: string;
  hint: string;
  initial: number;
  pending: boolean;
  error: Error | null;
  onSave: (cents: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial > 0 ? centsToText(initial) : '');
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    let cents = 0;
    if (text.trim()) {
      try {
        cents = parseMoneyText(text);
      } catch {
        cents = -1;
      }
      if (cents < 0) {
        setProblem('Enter an amount like 50 or 1,200.');
        return;
      }
    }
    setProblem(null);
    try {
      await onSave(cents);
    } catch {
      // Shown below.
    }
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <TextField
        label={label}
        hint={hint}
        value={text}
        onChangeText={(v) => setText(v.replace(/[^0-9.,]/g, ''))}
        keyboardType="decimal-pad"
        inputMode="decimal"
        placeholder="0.00"
        maxLength={14}
        error={problem}
        onSubmitEditing={save}
      />
      {error ? <Notice tone="error">{friendlyError(error)}</Notice> : null}
      <View style={styles.buttons}>
        <Button label="Save" onPress={save} loading={pending} style={styles.grow} />
        <Button variant="quiet" label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
  tabular: { fontVariant: ['tabular-nums'] },
  card: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.four, gap: Spacing.one },
  cardButton: { marginTop: Spacing.two },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  person: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.one },
  buttons: { flexDirection: 'row', gap: Spacing.two },
});
