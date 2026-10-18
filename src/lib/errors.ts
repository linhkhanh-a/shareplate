import { formatCents } from '@/money';

/**
 * Turns database and network errors into sentences people can act on.
 * The database raises errors that start with a stable code, e.g.
 * "LAST_ADMIN: the group needs another admin first".
 */
export function friendlyError(error: unknown): string {
  const message =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '';

  const balance = /UNSETTLED_BALANCE: (.+) still has a balance of (-?\d+) cents/.exec(message);
  if (balance) {
    const [, name, raw] = balance;
    const cents = Number(raw);
    const amount = formatCents(Math.abs(cents));
    return cents > 0
      ? `${name} is still owed ${amount}. Settle up first, then try again.`
      : `${name} still owes ${amount}. Settle up first, then try again.`;
  }

  const former = /FORMER_MEMBER: (.+) has left the trip, and this would leave them with a balance of (-?\d+) cents/.exec(message);
  if (former) {
    const [, name, raw] = former;
    const cents = Number(raw);
    const amount = formatCents(Math.abs(cents));
    return `${name} has left the trip, and this would leave them ${cents > 0 ? 'being owed' : 'owing'} ${amount}. Bring ${name} back to the trip first (under People), then try again.`;
  }
  if (message.includes('PAYMENT_NOT_REMOVED')) {
    return 'This payment was already removed, or only the payer, the receiver, whoever recorded it, or an admin can remove it.';
  }

  const history = /HAS_HISTORY: (.+?) is on bills/.exec(message);
  if (history) {
    return `${history[1]} is on bills or payments, so they can leave the trip but can't be deleted.`;
  }

  if (message.includes('STALE_BILL')) {
    return "Someone else changed this bill while you were editing it. Your changes weren't saved. Go back and open it again to see the latest version.";
  }
  if (message.includes('BILL_NOT_FOUND')) return 'This bill was deleted.';
  if (message.includes('STALE_ACTIVITY')) {
    return "Someone else changed this activity while you were editing it. Your changes weren't saved. Go back and open it again to see the latest version.";
  }
  if (message.includes('ACTIVITY_NOT_FOUND')) return 'This activity was deleted. Go back to see the latest plan.';
  if (message.includes('ITEMIZED_BILL')) return 'Scanned bills are edited from the receipt screen.';
  if (message.includes('SHARES_NOT_TOTAL') || message.includes('EXACT_MISMATCH')) {
    return "Everyone's shares need to add up to the bill total.";
  }
  if (message.includes('PERCENT_NOT_100')) return 'Percentages need to add up to 100%.';
  if (message.includes('NO_PARTICIPANTS')) return 'Choose who is splitting this bill.';
  if (message.includes('BAD_AMOUNT')) return 'The bill needs an amount above $0.00.';
  if (message.includes('BAD_ALLOWANCE')) return 'Enter an allowance between $0 and $1,000,000 a day.';
  if (message.includes('groups_total_budget_limit')) return 'Enter a budget under $100,000,000.';
  if (message.includes('LAST_ADMIN')) {
    return 'A trip always needs an admin. Make someone else an admin first.';
  }
  const balanceTrip = /ACCOUNT_HAS_BALANCE: settle up in "(.+)" first/.exec(message);
  if (balanceTrip) return `Settle up in "${balanceTrip[1]}" first. Your balance there needs to be $0.00.`;
  const adminTrip = /ACCOUNT_LAST_ADMIN: make someone else an admin of "(.+)" first/.exec(message);
  if (adminTrip) return `Make someone else an admin of "${adminTrip[1]}" first, so the trip isn't left without one.`;
  if (message.includes('NOT_ADMIN')) return 'Only trip admins can do that.';
  if (message.includes('INVITE_INVALID')) {
    return 'This invite link has expired or was reset. Ask a trip admin for a new one.';
  }
  if (message.includes('NOT_MEMBER')) return "You're not in this trip anymore.";
  if (message.includes('NOT_SIGNED_IN')) return 'Sign in to continue.';
  if (/Failed to fetch|Network request failed|NetworkError/i.test(message)) {
    return "Couldn't reach Shareplate. Check your connection and try again.";
  }
  return message || 'Something went wrong. Try again.';
}
