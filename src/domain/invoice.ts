import type { Invoice, InvoiceLine } from './types';

export const invoiceTotal = (i: Pick<Invoice, 'lines'>) => i.lines.reduce((s, l) => s + (Number(l.amount_cents) || 0), 0);
export const invoiceBalance = (i: Pick<Invoice, 'lines' | 'paid_cents'>) => invoiceTotal(i) - Number(i.paid_cents);

export type InvoiceStatus = 'Paid' | 'Part paid' | 'Unpaid';
export function invoiceStatus(i: Pick<Invoice, 'lines' | 'paid_cents'>): InvoiceStatus {
  const total = invoiceTotal(i);
  const paid = Number(i.paid_cents);
  if (total > 0 && paid >= total) return 'Paid';
  return paid > 0 ? 'Part paid' : 'Unpaid';
}

interface QuoteDivision { division: string; clientAmount: number }
interface QuoteLine { division: string; name: string }

/**
 * Starting lines for an invoice from an accepted quote, at client prices. A quote with one section
 * becomes one line named after the quote, listing its items; otherwise one line per section.
 * The lines always add up to the quote's grand total.
 */
export function linesFromQuote(title: string, divisions: QuoteDivision[], lines: QuoteLine[], grandTotal: number): InvoiceLine[] {
  const used = divisions.filter((d) => d.clientAmount !== 0 || lines.some((l) => l.division === d.division));
  const items = (division: string) => lines.filter((l) => l.division === division).map((l) => l.name).filter(Boolean).join('; ');
  const out: InvoiceLine[] = used.length <= 1
    ? [{ description: title || 'Work as quoted', detail: used[0] ? items(used[0].division) : '', amount_cents: Math.round(grandTotal * 100) }]
    : used.map((d) => ({ description: d.division, detail: items(d.division), amount_cents: Math.round(d.clientAmount * 100) }));
  const drift = Math.round(grandTotal * 100) - out.reduce((s, l) => s + l.amount_cents, 0);
  if (drift && out.length) out[out.length - 1].amount_cents += drift;
  return out;
}
