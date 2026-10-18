import { describe, expect, it } from 'vitest';

import { friendlyError } from '@/lib/errors';
import { inviteUrl } from '@/lib/queries-helpers';

describe('friendlyError', () => {
  it('explains an unpaid balance in dollars, in both directions', () => {
    expect(friendlyError({ message: 'UNSETTLED_BALANCE: An still has a balance of -1250 cents' })).toBe(
      'An still owes $12.50. Settle up first, then try again.',
    );
    expect(friendlyError({ message: 'UNSETTLED_BALANCE: Linh still has a balance of 500 cents' })).toBe(
      'Linh is still owed $5.00. Settle up first, then try again.',
    );
  });

  it('explains why a change to someone who left is refused', () => {
    expect(
      friendlyError({ message: 'FORMER_MEMBER: Minh has left the trip, and this would leave them with a balance of -118756 cents' }),
    ).toBe('Minh has left the trip, and this would leave them owing $1,187.56. Bring Minh back to the trip first (under People), then try again.');
    expect(
      friendlyError({ message: 'FORMER_MEMBER: Minh has left the trip, and this would leave them with a balance of 500 cents' }),
    ).toMatch(/leave them being owed \$5\.00/);
    expect(friendlyError(new Error('PAYMENT_NOT_REMOVED'))).toMatch(/already removed, or only the payer/);
  });

  it('turns database codes into plain sentences', () => {
    expect(friendlyError(new Error('LAST_ADMIN: the group needs another admin first'))).toMatch(/needs an admin/);
    expect(friendlyError({ message: 'INVITE_INVALID: this invite link has expired or was reset' })).toMatch(
      /Ask a trip admin for a new one/,
    );
    expect(friendlyError({ message: 'HAS_HISTORY: Minh is on bills or payments, so ...' })).toBe(
      "Minh is on bills or payments, so they can leave the trip but can't be deleted.",
    );
  });

  it('recognizes being offline', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toMatch(/Check your connection/);
  });

  it('never returns an empty message', () => {
    expect(friendlyError(undefined)).toBe('Something went wrong. Try again.');
  });
});

describe('inviteUrl', () => {
  it('builds a join link that works on any deployment', () => {
    expect(inviteUrl('https://shareplate-app.vercel.app', 'abc123')).toBe('https://shareplate-app.vercel.app/join?code=abc123');
  });
});
