import { allocate } from './allocate';
import { assertNonNegativeCents, sumCents, type Cents } from './cents';
import { MoneyError } from './errors';

export type MemberId = string;

/** What one member owes for one bill. */
export interface Share {
  memberId: MemberId;
  amountCents: Cents;
}

/** 100% expressed in basis points (hundredths of a percent): 33.33% = 3333. */
export const FULL_PERCENT_BP = 10_000;

function assertMembers(memberIds: readonly MemberId[]): void {
  if (memberIds.length === 0) {
    throw new MoneyError('NO_MEMBERS', 'Choose at least one person to split with');
  }
  const seen = new Set<MemberId>();
  for (const id of memberIds) {
    if (seen.has(id)) {
      throw new MoneyError('DUPLICATE_MEMBER', 'The same person is listed twice', { memberId: id });
    }
    seen.add(id);
  }
}

/** Equal split. $10.00 between 3 people -> $3.34, $3.33, $3.33. */
export function splitEqual(totalCents: Cents, memberIds: readonly MemberId[]): Share[] {
  assertNonNegativeCents(totalCents, 'total');
  assertMembers(memberIds);
  const amounts = allocate(
    totalCents,
    memberIds.map(() => 1),
  );
  return memberIds.map((memberId, i) => ({ memberId, amountCents: amounts[i] }));
}

/**
 * Converts a typed percentage ("33.33", "50", "12.5%") to basis points.
 * At most two decimal places.
 */
export function parsePercentToBasisPoints(text: string): number {
  const match = /^\s*(\d+)?(?:\.(\d{0,2}))?\s*%?\s*$/.exec(text);
  if (!match || (match[1] === undefined && !match[2])) {
    throw new MoneyError('INVALID_AMOUNT_TEXT', `"${text}" is not a valid percentage`, { text });
  }
  const whole = Number(match[1] ?? '0');
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  return whole * 100 + fraction;
}

export interface PercentInput {
  memberId: MemberId;
  /** Basis points: 25% = 2500. Must add up to 10000 across everyone. */
  basisPoints: number;
}

/** Percentage split. Percentages must add up to exactly 100%. */
export function splitByPercent(totalCents: Cents, inputs: readonly PercentInput[]): Share[] {
  assertNonNegativeCents(totalCents, 'total');
  assertMembers(inputs.map((x) => x.memberId));
  let sum = 0;
  for (const { memberId, basisPoints } of inputs) {
    if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
      throw new MoneyError('INVALID_WEIGHTS', 'Percentages must be zero or more', { memberId });
    }
    sum += basisPoints;
  }
  if (sum !== FULL_PERCENT_BP) {
    throw new MoneyError('PERCENT_NOT_100', `Percentages add up to ${sum / 100}%, not 100%`, {
      sumBasisPoints: sum,
    });
  }
  const amounts = allocate(
    totalCents,
    inputs.map((x) => x.basisPoints),
  );
  return inputs.map(({ memberId }, i) => ({ memberId, amountCents: amounts[i] }));
}

/** Exact-amount split. The amounts must add up to exactly the total. */
export function splitExact(totalCents: Cents, inputs: readonly Share[]): Share[] {
  assertNonNegativeCents(totalCents, 'total');
  assertMembers(inputs.map((x) => x.memberId));
  inputs.forEach((x) => assertNonNegativeCents(x.amountCents, 'share'));
  const sum = sumCents(inputs.map((x) => x.amountCents));
  if (sum !== totalCents) {
    throw new MoneyError(
      'EXACT_NOT_TOTAL',
      sum < totalCents ? 'Amounts are less than the bill total' : 'Amounts are more than the bill total',
      { sumCents: sum, totalCents, differenceCents: totalCents - sum },
    );
  }
  return inputs.map((x) => ({ memberId: x.memberId, amountCents: x.amountCents }));
}
