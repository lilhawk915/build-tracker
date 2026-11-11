import Papa from 'papaparse';
import { roundCents } from '../pricing/pricing';
import { BILL_CATEGORIES, type Bill, type BillCategory, type JobRecord, type Project, type Totals } from '../types';

export const emptyRecord = (): JobRecord => ({ bills: [], selections: [], log: [] });

export interface RecordSummary {
  /** Everything spent so far. */
  spent: number;
  unpaid: number;
  byCategory: { category: BillCategory; amount: number }[];
  /** Quoted price minus what has been spent. */
  actualProfit: number;
  /** Profit the quote planned for. */
  projectedProfit: number;
  /** Estimated job cost: line items plus tax, contingency and overhead. */
  estimatedCost: number;
  /** Positive when you have spent more than estimated. */
  overEstimate: number;
}

export function summarizeRecord(record: JobRecord, totals: Pick<Totals, 'grandTotal' | 'profit'>): RecordSummary {
  const sum = (bills: Bill[]) => roundCents(bills.reduce((s, b) => s + (Number.isFinite(b.amount) ? b.amount : 0), 0));
  const spent = sum(record.bills);
  const estimatedCost = roundCents(totals.grandTotal - totals.profit);
  return {
    spent,
    unpaid: sum(record.bills.filter((b) => !b.paid)),
    byCategory: BILL_CATEGORIES.map((category) => ({ category, amount: sum(record.bills.filter((b) => b.category === category)) })).filter(
      (c) => c.amount !== 0,
    ),
    actualProfit: roundCents(totals.grandTotal - spent),
    projectedProfit: totals.profit,
    estimatedCost,
    overEstimate: roundCents(spent - estimatedCost),
  };
}

export function billsToCsv(bills: Bill[]): string {
  const sorted = [...bills].sort((a, b) => a.date.localeCompare(b.date));
  return Papa.unparse({
    fields: ['Date', 'Vendor', 'Description', 'Category', 'Amount', 'Paid'],
    data: sorted.map((b) => [b.date, b.vendor, b.description, b.category, b.amount, b.paid ? 'yes' : 'no']),
  });
}

/** Every piece of text in a project, for the search box on the Projects page. */
function searchableText(p: Project): string {
  const r = p.record;
  return [
    p.clientName,
    p.address,
    p.notes,
    ...p.customLines.map((c) => c.name),
    ...Object.values(p.lineEdits).map((e) => e.name ?? ''),
    ...r.bills.flatMap((b) => [b.vendor, b.description, b.category]),
    ...r.selections.flatMap((s) => [s.category, s.area, s.product, s.color, s.finish, s.supplier, s.quantity, s.notes]),
    ...r.log.map((l) => l.text),
  ]
    .join('\n')
    .toLowerCase();
}

/** True when every word of the search appears somewhere in the project. */
export function projectMatches(project: Project, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = searchableText(project);
  return words.every((w) => text.includes(w));
}

/** Where a search hit, so the Projects list can say "found in selections". */
export function matchedIn(project: Project, query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const has = (parts: string[]) => {
    const t = parts.join('\n').toLowerCase();
    return words.some((w) => t.includes(w));
  };
  const r = project.record;
  const places: string[] = [];
  if (has(r.selections.flatMap((s) => [s.category, s.area, s.product, s.color, s.finish, s.supplier, s.quantity, s.notes]))) places.push('materials');
  if (has(r.bills.flatMap((b) => [b.vendor, b.description, b.category]))) places.push('bills');
  if (has(r.log.map((l) => l.text))) places.push('job log');
  if (has([project.notes])) places.push('notes');
  if (has([...project.customLines.map((c) => c.name), ...Object.values(project.lineEdits).map((e) => e.name ?? '')])) places.push('line items');
  return places;
}
