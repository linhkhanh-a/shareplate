export type MoneyErrorCode =
  | 'NOT_INTEGER_CENTS'
  | 'NEGATIVE_AMOUNT'
  | 'INVALID_AMOUNT_TEXT'
  | 'NO_MEMBERS'
  | 'DUPLICATE_MEMBER'
  | 'INVALID_WEIGHTS'
  | 'PERCENT_NOT_100'
  | 'EXACT_NOT_TOTAL'
  | 'NO_ITEMS'
  | 'ITEM_UNASSIGNED'
  | 'DISCOUNT_TOO_LARGE'
  | 'BAD_SETTLEMENT';

/**
 * Every money-engine failure throws this, with a stable `code` the UI can
 * turn into a friendly message (for example "Percentages add up to 98%, not 100%").
 */
export class MoneyError extends Error {
  readonly code: MoneyErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: MoneyErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
    this.details = details;
  }
}
