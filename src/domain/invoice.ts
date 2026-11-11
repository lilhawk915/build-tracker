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

const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const quoteRef = (n: number | undefined | null) => (n ? `Quote #${n}` : 'the quote');
export const pctText = (p: number) => `${Math.round(p * 100) / 100}%`;

/** The deposit due up front: pct of the quote total, rounded to the cent. */
export const depositCents = (totalCents: number, pct: number) => Math.round((totalCents * pct) / 100);

/** One line: the deposit, pointing back to the quote it belongs to. */
export function depositLines(title: string, quoteNumber: number | undefined, totalCents: number, pct: number): InvoiceLine[] {
  const amount = depositCents(totalCents, pct);
  return [{
    description: `Deposit (${pctText(pct)}) - ${quoteRef(quoteNumber)}`,
    detail: `${title}. Quote total ${usd(totalCents)}. Deposit is due before material is ordered and the work is scheduled. The balance of ${usd(totalCents - amount)} is due on completion.`,
    amount_cents: amount,
  }];
}

interface CoLike { id: string; number: number; description: string; price_delta_cents: number | string; status: string }
interface DepositLike { number: number; paid_cents: number | string }

/** Approved change orders with a client price that no invoice has billed yet. */
export function unbilledChangeOrders<T extends CoLike>(cos: T[], invoices: Pick<Invoice, 'lines'>[]): T[] {
  const billed = new Set(invoices.flatMap((i) => i.lines.map((l) => l.change_order_id).filter(Boolean)));
  return cos.filter((c) => c.status === 'approved' && Number(c.price_delta_cents) !== 0 && !billed.has(c.id)).sort((a, b) => a.number - b.number);
}

export const changeOrderLines = (cos: CoLike[]): InvoiceLine[] => cos.map((c) => ({
  description: `Change order #${c.number}`, detail: c.description, amount_cents: Number(c.price_delta_cents), change_order_id: c.id,
}));

/**
 * The final invoice: the quote at its full price, each unbilled approved change order, then each
 * deposit as a credit for what was actually received. The total of the lines is the balance due.
 */
export function finalLines(quoteLines: InvoiceLine[], quoteNumber: number | undefined, cos: CoLike[], deposits: DepositLike[]): InvoiceLine[] {
  const quote = quoteLines.map((l, n) => (n === 0 && quoteNumber ? { ...l, description: `${l.description} - ${quoteRef(quoteNumber)}` } : l));
  const credits = deposits.filter((d) => Number(d.paid_cents) > 0).map((d): InvoiceLine => ({
    description: `Less deposit received (Invoice #${d.number})`, detail: '', amount_cents: -Number(d.paid_cents),
  }));
  return [...quote, ...changeOrderLines(cos), ...credits];
}
