import { describe, expect, it } from 'vitest';

import { describeEditors, editorsByBill } from '@/lib/presence';

describe('editorsByBill', () => {
  it('groups other people by the bill they have open, ignoring yourself and duplicates', () => {
    const state = {
      m1: [{ memberId: 'm1', name: 'Linh', editingBillId: 'b1' }],
      m2: [
        { memberId: 'm2', name: 'An', editingBillId: 'b1' },
        { memberId: 'm2', name: 'An', editingBillId: 'b1' }, // second tab
      ],
      m3: [{ memberId: 'm3', name: 'Minh', editingBillId: 'b2' }],
      m4: [{ memberId: 'm4', name: 'Hương', editingBillId: null }],
      junk: [{ nothing: true }],
    };
    const result = editorsByBill(state, 'm1');
    expect(Object.fromEntries(result)).toEqual({ b1: ['An'], b2: ['Minh'] });
  });
});

describe('describeEditors', () => {
  it('writes a natural phrase for any number of people', () => {
    expect(describeEditors([])).toBe('');
    expect(describeEditors(['Minh'])).toBe('Minh is');
    expect(describeEditors(['An', 'Minh'])).toBe('An and Minh are');
    expect(describeEditors(['An', 'Hương', 'Minh'])).toBe('An, Hương and 1 other are');
    expect(describeEditors(['A', 'B', 'C', 'D'])).toBe('A, B and 2 others are');
  });
});
