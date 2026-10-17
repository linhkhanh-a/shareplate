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

  const history = /HAS_HISTORY: (.+?) is on bills/.exec(message);
  if (history) {
    return `${history[1]} is on bills or payments, so they can leave the trip but can't be deleted.`;
  }

  if (message.includes('LAST_ADMIN')) {
    return 'A trip always needs an admin. Make someone else an admin first.';
  }
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
