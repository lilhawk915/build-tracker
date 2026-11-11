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

import { depositLines, finalLines, unbilledChangeOrders } from '../src/domain/invoice';

describe('deposit and final invoices', () => {
  it('bills a 50% deposit on a $17,760 quote as $8,880, pointing at the quote', () => {
    const [l] = depositLines('Drywall', 1003, 1776000, 50);
    expect(l.amount_cents).toBe(888000);
    expect(l.description).toBe('Deposit (50%) - Quote #1003');
    expect(l.detail).toContain('balance of $8,880.00 is due on completion');
  });
  it('rounds an odd deposit to the cent', () => {
    expect(depositLines('x', 1, 100001, 33.33)[0].amount_cents).toBe(33330);
  });
  it('final = quote + approved unbilled change orders - deposits received', () => {
    const cos = [
      { id: 'a', number: 1, description: 'Extra 10 sheets', price_delta_cents: 80000, status: 'approved' },
      { id: 'b', number: 2, description: 'Ceiling', price_delta_cents: 150000, status: 'pending' },
      { id: 'c', number: 3, description: 'Texture', price_delta_cents: 30000, status: 'approved' },
      { id: 'd', number: 4, description: 'Cost only', price_delta_cents: 0, status: 'approved' },
    ];
    const already = [{ lines: [{ description: 'x', detail: '', amount_cents: 30000, change_order_id: 'c' }] }];
    const open = unbilledChangeOrders(cos, already);
    expect(open.map((c) => c.id)).toEqual(['a']);
    const lines = finalLines([{ description: 'Drywall', detail: '220 sheets', amount_cents: 1776000 }], 1003, open, [{ number: 1004, paid_cents: 888000 }, { number: 1005, paid_cents: 0 }]);
    expect(lines.map((l) => l.description)).toEqual(['Drywall - Quote #1003', 'Change order #1', 'Less deposit received (Invoice #1004)']);
    expect(lines.reduce((s, l) => s + l.amount_cents, 0)).toBe(1776000 + 80000 - 888000);
    expect(lines[1].change_order_id).toBe('a');
  });
});
