import { describe, expect, it } from 'vitest';

import { centsToText, currencySymbolFor, formatCents, normalizeMoneyText, normalizePercentText, parseMoneyText, setCurrencySymbol } from '@/money';

describe('typing amounts', () => {
  it.each([
    ['12.345', '12.35'],
    ['12.344', '12.34'],
    ['12.5', '12.50'],
    ['12', '12.00'],
    ['.99', '0.99'],
    ['$1,234.5', '1234.50'],
    ['12,50', '12.50'],
    ['12,5', '12.50'],
    ['1,234', '1234.00'],
    ['1,234,567.891', '1234567.89'],
    ['1.234,56', '1234.56'],
    ['1.234.567', '1234567.00'],
    ['CHF 54.50', '54.50'],
    ['54,50 €', '54.50'],
    ['0.995', '1.00'],
    ['  7 ', '7.00'],
    ['', ''],
  ])('reads %j as %j', (typed, normal) => {
    expect(normalizeMoneyText(typed)).toBe(normal);
  });

  it.each(['abc', '1.2.3', '-5', '12,34,5', '.', ','])('refuses %j', (typed) => {
    expect(normalizeMoneyText(typed)).toBeNull();
  });

  it('parses leniently into whole cents', () => {
    expect(parseMoneyText('12.345')).toBe(1235);
    expect(parseMoneyText('$1,234.5')).toBe(123450);
    expect(() => parseMoneyText('abc')).toThrow();
    expect(centsToText(123450)).toBe('1234.50');
  });
});

describe('typing percentages', () => {
  it.each([
    ['12,5', '12.5'],
    ['33.333', '33.33'],
    ['33.335', '33.34'],
    ['10%', '10'],
    ['8.50', '8.5'],
    ['', ''],
  ])('reads %j as %j', (typed, normal) => {
    expect(normalizePercentText(typed)).toBe(normal);
  });
  it('refuses text', () => expect(normalizePercentText('ten')).toBeNull());
});

describe('currency', () => {
  it('shows the trip currency sign, and plain $ by default', () => {
    expect(currencySymbolFor('CHF')).toBe('CHF ');
    expect(currencySymbolFor('XYZ')).toBe('$');
    setCurrencySymbol('€');
    expect(formatCents(123456)).toBe('€1,234.56');
    expect(centsToText(5450)).toBe('54.50');
    setCurrencySymbol('$');
    expect(formatCents(-500)).toBe('-$5.00');
  });
});
