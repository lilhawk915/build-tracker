import { describe, expect, it } from 'vitest';
import { invoiceBalance, invoiceStatus, invoiceTotal, linesFromQuote } from '../src/domain/invoice';

const inv = (amounts: number[], paid = 0) => ({ lines: amounts.map((a) => ({ description: 'x', detail: '', amount_cents: a })), paid_cents: paid });

describe('invoice math', () => {
  it('totals lines and works out the balance and status', () => {
    expect(invoiceTotal(inv([755000, 60000, 50000, 20000]))).toBe(885000);
    expect(invoiceBalance(inv([885000], 300000))).toBe(585000);
    expect(invoiceStatus(inv([885000]))).toBe('Unpaid');
    expect(invoiceStatus(inv([885000], 1))).toBe('Part paid');
    expect(invoiceStatus(inv([885000], 885000))).toBe('Paid');
    expect(invoiceStatus(inv([]))).toBe('Unpaid');
  });
  it('makes one line named after a one-section quote, listing its items', () => {
    const l = linesFromQuote('1600 Stone Rd - Back Patios', [{ division: 'Foundation', clientAmount: 8850 }, { division: 'Site', clientAmount: 0 }],
      [{ division: 'Foundation', name: 'Concrete, 10 yards' }, { division: 'Foundation', name: 'Rock, 20 tons' }], 8850);
    expect(l).toEqual([{ description: '1600 Stone Rd - Back Patios', detail: 'Concrete, 10 yards; Rock, 20 tons', amount_cents: 885000 }]);
  });
  it('makes one line per section and always adds up to the quote total', () => {
    const l = linesFromQuote('House', [{ division: 'Site', clientAmount: 1000.11 }, { division: 'Framing', clientAmount: 2000.22 }], [], 3000.34);
    expect(l.map((x) => x.description)).toEqual(['Site', 'Framing']);
    expect(l.reduce((s, x) => s + x.amount_cents, 0)).toBe(300034);
  });
});
