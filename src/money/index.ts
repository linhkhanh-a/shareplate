/**
 * The money engine: pure TypeScript, no UI and no database.
 * Every amount is an integer number of cents. See docs/money-engine.md.
 */
export { MoneyError, type MoneyErrorCode } from './errors';
export {
  assertCents,
  assertNonNegativeCents,
  currencySymbol,
  formatCents,
  setCurrencySymbol,
  parseCents,
  sumCents,
  type Cents,
} from './cents';
export { allocate } from './allocate';
export {
  centsToText,
  CURRENCIES,
  currencySymbolFor,
  normalizeMoneyText,
  normalizePercentText,
  parseMoneyText,
  type CurrencyCode,
} from './entry';
export {
  FULL_PERCENT_BP,
  parsePercentToBasisPoints,
  splitByPercent,
  splitEqual,
  splitExact,
  type MemberId,
  type PercentInput,
  type Share,
} from './splits';
export {
  percentOfCents,
  splitItemizedBill,
  type BillItemInput,
  type ItemizedBillInput,
  type ItemizedBillResult,
  type MemberBreakdown,
} from './itemized';
export {
  computeBalances,
  isSettled,
  type Balances,
  type BillForBalance,
  type SettlementForBalance,
} from './balances';
export { simplifyDebts, type Transfer } from './simplify';
