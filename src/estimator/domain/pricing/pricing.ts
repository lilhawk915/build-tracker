import { DIVISIONS, type DivisionSummary, type Markups, type ResolvedLine, type Totals } from '../types';

export const roundCents = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const toCents = (n: number) => Math.round(n * 100);

export interface LineAmounts {
  material: number;
  labor: number;
  total: number;
}

export function lineAmounts(qty: number, materialUnit: number, laborUnit: number): LineAmounts {
  const material = roundCents(qty * materialUnit);
  const labor = roundCents(qty * laborUnit);
  return { material, labor, total: roundCents(material + labor) };
}

/**
 * Stacked markups. Tax is on materials only and goes into the subtotal.
 * Then contingency, overhead and profit each apply to the running total.
 */
export function computeTotals(
  lines: Pick<ResolvedLine, 'material' | 'labor'>[],
  settings: Pick<Markups, 'overheadPct' | 'profitPct' | 'contingencyPct' | 'salesTaxPct'> & { profitAmount?: number | null },
  heatedSqft: number,
): Totals {
  const material = roundCents(lines.reduce((sum, l) => sum + l.material, 0));
  const labor = roundCents(lines.reduce((sum, l) => sum + l.labor, 0));
  const tax = roundCents((material * settings.salesTaxPct) / 100);
  const subtotal = roundCents(material + labor + tax);
  const contingency = roundCents((subtotal * settings.contingencyPct) / 100);
  const overhead = roundCents(((subtotal + contingency) * settings.overheadPct) / 100);
  // A typed dollar profit wins over the percent.
  const profit =
    settings.profitAmount !== null && settings.profitAmount !== undefined
      ? roundCents(settings.profitAmount)
      : roundCents(((subtotal + contingency + overhead) * settings.profitPct) / 100);
  const grandTotal = roundCents(subtotal + contingency + overhead + profit);
  const costPerSqft = heatedSqft > 0 ? roundCents(grandTotal / heatedSqft) : 0;
  return { material, labor, tax, subtotal, contingency, overhead, profit, grandTotal, costPerSqft };
}

/**
 * Division subtotals for the client quote: tax and markups are rolled in, split by each division's
 * taxed cost. Cents are handed out by largest remainder so the divisions always add up to the grand
 * total exactly.
 */
export function summarizeDivisions(
  lines: Pick<ResolvedLine, 'division' | 'material' | 'labor'>[],
  settings: Pick<Markups, 'salesTaxPct'>,
  grandTotal: number,
): DivisionSummary[] {
  const rows = DIVISIONS.map((division) => {
    const own = lines.filter((l) => l.division === division);
    const material = roundCents(own.reduce((s, l) => s + l.material, 0));
    const labor = roundCents(own.reduce((s, l) => s + l.labor, 0));
    const weight = material * (1 + settings.salesTaxPct / 100) + labor;
    return { division, material, labor, direct: roundCents(material + labor), weight };
  });
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);
  const targetCents = toCents(grandTotal);

  const shares = rows.map((r) => {
    const exact = totalWeight > 0 ? (r.weight / totalWeight) * targetCents : 0;
    return { floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = targetCents - shares.reduce((s, x) => s + x.floor, 0);
  const order = shares
    .map((s, n) => ({ n, remainder: s.remainder }))
    .filter((_, n) => rows[n].weight > 0)
    .sort((a, b) => b.remainder - a.remainder);
  for (const { n } of order) {
    if (left <= 0) break;
    shares[n].floor += 1;
    left -= 1;
  }

  return rows.map((r, n) => ({
    division: r.division,
    material: r.material,
    labor: r.labor,
    direct: r.direct,
    clientAmount: shares[n].floor / 100,
  }));
}

export type AmountField = 'material' | 'labor' | 'total';

/**
 * You typed a dollar amount instead of a unit price. Works the unit price back out so the line comes
 * to exactly that amount. Total keeps the line's current material/labor split; a line with nothing
 * on it yet puts the whole total in labor, so no sales tax gets added by surprise. A zero quantity
 * becomes 1, since nothing times zero can reach the amount.
 */
export function editsForAmount(
  line: { qty: number; material: number; labor: number },
  field: AmountField,
  amount: number,
): { qty?: number; materialUnit?: number; laborUnit?: number } {
  const qty = line.qty > 0 ? line.qty : 1;
  const out: { qty?: number; materialUnit?: number; laborUnit?: number } = line.qty > 0 ? {} : { qty: 1 };
  if (field === 'material') return { ...out, materialUnit: amount / qty };
  if (field === 'labor') return { ...out, laborUnit: amount / qty };
  const current = line.material + line.labor;
  const materialShare = current > 0 ? line.material / current : 0;
  const material = roundCents(amount * materialShare);
  return { ...out, materialUnit: material / qty, laborUnit: (amount - material) / qty };
}
