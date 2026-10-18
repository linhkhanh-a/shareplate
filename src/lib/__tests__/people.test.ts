import { describe, expect, it } from 'vitest';

import { canRemovePayment, formerOnBill, formerWithBalance, peopleLine, removeMessage, settleTiming, zelleOf } from '@/lib/people';
import type { Member, Payment } from '@/lib/queries';

const member = (id: string, extra: Partial<Member> = {}): Member => ({
  id,
  user_id: `u-${id}`,
  display_name: id,
  role: 'member',
  joined_at: '',
  left_at: null,
  daily_allowance_cents: 0,
  profile: null,
  zelle_identifier: null,
  ...extra,
});

const payment: Payment = {
  id: 'p',
  from_member_id: 'guest',
  to_member_id: 'linh',
  amount_cents: 1000,
  settled_on: '',
  created_at: '',
  created_by: 'u-linh',
};

describe('who can remove a payment', () => {
  it('is the payer, the receiver, whoever recorded it, or an admin', () => {
    expect(canRemovePayment(payment, member('linh'), 'u-linh')).toBe(true); // receiver and recorder
    expect(canRemovePayment({ ...payment, created_by: 'u-an' }, member('linh'), 'u-linh')).toBe(true); // receiver
    expect(canRemovePayment(payment, member('an'), 'u-an')).toBe(false);
    expect(canRemovePayment({ ...payment, created_by: 'u-an' }, member('an'), 'u-an')).toBe(true); // recorder
    expect(canRemovePayment(payment, member('an', { role: 'admin' }), 'u-an')).toBe(true);
    expect(canRemovePayment({ ...payment, from_member_id: 'an' }, member('an'), 'u-an')).toBe(true); // payer
  });

  it('is nobody who has left the trip, or when signed out', () => {
    expect(canRemovePayment(payment, member('linh', { left_at: '2026-10-18' }), 'u-linh')).toBe(false);
    expect(canRemovePayment(payment, undefined, undefined)).toBe(false);
  });
});

describe('people who left', () => {
  const gone = member('2', { user_id: null, left_at: '2026-10-18' });
  const goneSettled = member('3', { user_id: null, left_at: '2026-10-18' });
  const members = [member('linh'), gone, goneSettled];

  it('lists those who left with money still on them', () => {
    const balances = new Map([
      ['linh', 118756],
      ['2', -118756],
      ['3', 0],
    ]);
    expect(formerWithBalance(members, balances)).toEqual([{ member: gone, balance: -118756 }]);
  });

  it('finds who on a bill has left, as payer or as a share', () => {
    expect(formerOnBill(members, { paid_by_member_id: '3', shares: [{ group_member_id: 'linh' }] })).toEqual([goneSettled]);
    expect(formerOnBill(members, { paid_by_member_id: 'linh', shares: [{ group_member_id: '2' }] })).toEqual([gone]);
    expect(formerOnBill(members, { paid_by_member_id: 'linh', shares: [{ group_member_id: 'linh' }] })).toEqual([]);
  });
});

describe('Zelle info', () => {
  it('comes from the profile for people with an account, and from the trip for guests', () => {
    expect(zelleOf(member('an', { profile: { zelle_identifier: 'an@example.com' }, zelle_identifier: 'ignored' }))).toBe('an@example.com');
    expect(zelleOf(member('minh', { user_id: null, zelle_identifier: '(614) 555-0100' }))).toBe('(614) 555-0100');
    expect(zelleOf(member('an', { profile: { zelle_identifier: '' } }))).toBeNull();
    expect(zelleOf(undefined)).toBeNull();
  });
});

describe('when to settle', () => {
  it('nudges during the trip and after it ends', () => {
    expect(settleTiming(null, '2026-10-18')).toBeNull();
    expect(settleTiming('2026-10-26', '2026-10-18')).toBe('during');
    expect(settleTiming('2026-10-26', '2026-10-26')).toBe('during');
    expect(settleTiming('2026-10-26', '2026-10-27')).toBe('over');
  });
});

describe('describing the group', () => {
  it('counts people and guests', () => {
    expect(peopleLine([member('linh'), member('1', { user_id: null }), member('2', { user_id: null }), member('3', { user_id: null })])).toBe(
      '4 people · 3 guests',
    );
    expect(peopleLine([member('linh'), member('an')])).toBe('2 people');
    expect(peopleLine([member('linh'), member('1', { user_id: null })])).toBe('2 people · 1 guest');
    expect(peopleLine([member('linh')])).toBe('Just you');
  });

  it('words removal differently for guests, who never saw the trip', () => {
    expect(removeMessage(member('2', { user_id: null })).body).toMatch(/^They'll be taken off the list of people/);
    expect(removeMessage(member('An')).body).toMatch(/^They will no longer see this trip/);
    expect(removeMessage(member('An')).title).toBe('Remove An?');
  });
});
