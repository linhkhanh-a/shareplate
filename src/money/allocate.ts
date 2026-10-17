import { assertCents, type Cents } from './cents';
import { MoneyError } from './errors';

/**
 * Splits `totalCents` into whole-cent pieces proportional to `weights`,
 * using the largest-remainder method:
 *
 *   1. Give everyone the rounded-down value of their exact share.
 *   2. Hand the cents left over, one each, to the people whose exact share
 *      had the biggest fractional part. Ties go to whoever is listed first.
 *
 * Guarantees:
 *   - the pieces always add up to exactly `totalCents`;
 *   - every piece is within 1 cent of its exact proportional value;
 *   - a weight of 0 always gets 0.
 *
 * Weights are integers (BigInt-safe) so the math is exact. Negative totals
 * are allowed and are allocated as the mirror image of the positive total.
 */
export function allocate(totalCents: Cents, weights: readonly (number | bigint)[]): Cents[] {
  assertCents(totalCents, 'total');
  if (weights.length === 0) {
    throw new MoneyError('INVALID_WEIGHTS', 'Need at least one weight to allocate');
  }

  const w = weights.map((weight, index) => {
    if (typeof weight === 'number' && !Number.isSafeInteger(weight)) {
      throw new MoneyError('INVALID_WEIGHTS', 'Weights must be whole numbers', { index, weight });
    }
    const big = BigInt(weight);
    if (big < 0n) {
      throw new MoneyError('INVALID_WEIGHTS', 'Weights cannot be negative', { index, weight });
    }
    return big;
  });

  const weightSum = w.reduce((a, b) => a + b, 0n);
  if (weightSum === 0n) {
    throw new MoneyError('INVALID_WEIGHTS', 'At least one weight must be greater than zero');
  }

  if (totalCents < 0) {
    return allocate(-totalCents, w).map((piece) => (piece === 0 ? 0 : -piece));
  }

  const total = BigInt(totalCents);
  const floors: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let allocated = 0n;

  w.forEach((weight, index) => {
    const numerator = total * weight;
    const floor = numerator / weightSum; // BigInt division rounds down for non-negatives
    floors.push(floor);
    allocated += floor;
    if (weight > 0n) {
      remainders.push({ index, remainder: numerator % weightSum });
    }
  });

  let leftover = Number(total - allocated); // always < number of non-zero weights
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const { index } of remainders) {
    if (leftover === 0) break;
    floors[index] += 1n;
    leftover -= 1;
  }

  return floors.map((piece) => Number(piece));
}
