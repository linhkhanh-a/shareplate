import { allocate } from './allocate';
import { assertNonNegativeCents, sumCents, type Cents } from './cents';
import { MoneyError } from './errors';
import type { MemberId, Share } from './splits';

export interface BillItemInput {
  /** Optional, only used to point at the right line in error messages. */
  name?: string;
  priceCents: Cents;
  /** Who had this item. Shared dishes list several people; they split it equally. */
  memberIds: readonly MemberId[];
}

export interface ItemizedBillInput {
  items: readonly BillItemInput[];
  discountCents?: Cents;
  taxCents?: Cents;
  tipCents?: Cents;
  /**
   * Who shares the tip. Defaults to everyone who had at least one item.
   * The spec treats tip as a group service charge, split equally.
   */
  tipMemberIds?: readonly MemberId[];
}

export interface MemberBreakdown {
  memberId: MemberId;
  itemsCents: Cents;
  discountCents: Cents;
  taxCents: Cents;
  tipCents: Cents;
  /** itemsCents - discountCents + taxCents + tipCents */
  totalCents: Cents;
}

export interface ItemizedBillResult {
  members: MemberBreakdown[];
  shares: Share[];
  subtotalCents: Cents;
  discountedSubtotalCents: Cents;
  totalCents: Cents;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function lcm(a: bigint, b: bigint): bigint {
  return (a / gcd(a, b)) * b;
}

/**
 * Splits a scanned or itemized bill following the app spec:
 *
 *  - Each item is split equally among the people who had it.
 *  - The discount is spread in proportion to each person's pre-tax items
 *    (Discount Ratio = discount / subtotal).
 *  - Tax is spread in proportion to each person's discounted items
 *    (Tax Ratio = tax / discounted subtotal). Because the discount ratio is
 *    the same for everyone, this is also proportional to their items.
 *  - Tip is split equally among the tip group.
 *
 * Each line (items, discount, tax, tip) is rounded to whole cents with the
 * largest-remainder method, so every column adds up to the bill exactly and
 * everyone's shares add up to the bill total exactly.
 */
export function splitItemizedBill(input: ItemizedBillInput): ItemizedBillResult {
  const discount = input.discountCents ?? 0;
  const tax = input.taxCents ?? 0;
  const tip = input.tipCents ?? 0;
  assertNonNegativeCents(discount, 'discount');
  assertNonNegativeCents(tax, 'tax');
  assertNonNegativeCents(tip, 'tip');

  if (input.items.length === 0) {
    throw new MoneyError('NO_ITEMS', 'Add at least one item to the bill');
  }

  // Member order: first appearance on the bill, then any extra tip-only people.
  const order: MemberId[] = [];
  const indexOf = new Map<MemberId, number>();
  const addMember = (id: MemberId) => {
    if (!indexOf.has(id)) {
      indexOf.set(id, order.length);
      order.push(id);
    }
  };

  let denominator = 1n;
  input.items.forEach((item, i) => {
    const label = item.name ?? `item ${i + 1}`;
    assertNonNegativeCents(item.priceCents, `price of ${label}`);
    if (item.memberIds.length === 0) {
      throw new MoneyError('ITEM_UNASSIGNED', `Nobody is assigned to ${label}`, { itemIndex: i });
    }
    if (new Set(item.memberIds).size !== item.memberIds.length) {
      throw new MoneyError('DUPLICATE_MEMBER', `Someone is listed twice on ${label}`, { itemIndex: i });
    }
    item.memberIds.forEach(addMember);
    denominator = lcm(denominator, BigInt(item.memberIds.length));
  });

  const tipGroup = input.tipMemberIds ?? order.slice();
  if (tip > 0 && tipGroup.length === 0) {
    throw new MoneyError('NO_MEMBERS', 'Choose who shares the tip');
  }
  if (new Set(tipGroup).size !== tipGroup.length) {
    throw new MoneyError('DUPLICATE_MEMBER', 'Someone is listed twice in the tip group');
  }
  tipGroup.forEach(addMember);

  const subtotal = sumCents(input.items.map((x) => x.priceCents));
  if (discount > subtotal) {
    throw new MoneyError('DISCOUNT_TOO_LARGE', 'The discount is bigger than the items subtotal', {
      discountCents: discount,
      subtotalCents: subtotal,
    });
  }

  // Each person's exact share of the items, scaled by `denominator` so it is a whole number.
  // An item of price p shared by k people adds p * (denominator / k) to each of them.
  const weights = order.map(() => 0n);
  for (const item of input.items) {
    const perPerson = BigInt(item.priceCents) * (denominator / BigInt(item.memberIds.length));
    for (const id of item.memberIds) weights[indexOf.get(id)!] += perPerson;
  }

  const zeros = order.map(() => 0);
  let items = zeros;
  let discounts = zeros;
  let taxes = zeros;
  if (subtotal > 0) {
    items = allocate(subtotal, weights);
    discounts = allocate(discount, weights);
    taxes = allocate(tax, weights);
  } else if (tax > 0) {
    throw new MoneyError('NO_ITEMS', 'There is tax but every item costs $0.00');
  }

  const tipWeights = order.map((id) => (tipGroup.includes(id) ? 1 : 0));
  const tips = tip > 0 ? allocate(tip, tipWeights) : zeros;

  const members: MemberBreakdown[] = order.map((memberId, i) => ({
    memberId,
    itemsCents: items[i],
    discountCents: discounts[i],
    taxCents: taxes[i],
    tipCents: tips[i],
    totalCents: items[i] - discounts[i] + taxes[i] + tips[i],
  }));

  return {
    members,
    shares: members.map((m) => ({ memberId: m.memberId, amountCents: m.totalCents })),
    subtotalCents: subtotal,
    discountedSubtotalCents: subtotal - discount,
    totalCents: subtotal - discount + tax + tip,
  };
}

/**
 * Turns a percentage (in basis points, 8.25% = 825) of an amount into cents,
 * rounding half-cents up. Useful when a receipt shows a tax or tip rate
 * instead of an amount.
 */
export function percentOfCents(amountCents: Cents, basisPoints: number): Cents {
  assertNonNegativeCents(amountCents);
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    throw new MoneyError('INVALID_WEIGHTS', 'Percentage must be zero or more');
  }
  const scaled = BigInt(amountCents) * BigInt(basisPoints);
  return Number((scaled + 5_000n) / 10_000n);
}
