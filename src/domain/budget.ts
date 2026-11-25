import type { Bill, BudgetLine, ChangeOrder, Draw, DrawLine, Job, Po } from './types';

const ACTIVE_PO = new Set(['sent', 'accepted', 'closed']);
const costBill = (b: Bill) => b.status === 'approved' || b.status === 'paid';

export const poTotal = (p: Po) => p.amount_cents + p.approved_co_cents;

export interface LineRollup {
  line: BudgetLine;
  revised: number;    // budget plus approved change orders
  committed: number;  // what POs have promised
  billed: number;     // approved and paid bills
  paid: number;
  pending: number;    // bills waiting on approval
  projected: number;  // known cost: each PO at its larger of promised or billed, plus bills with no live PO
  forecast: number;   // expected final cost
  over: number;       // known cost above revised budget
}

export function rollupLines(lines: BudgetLine[], pos: Po[], bills: Bill[], cos: ChangeOrder[]): LineRollup[] {
  return [...lines].sort((a, b) => a.sort - b.sort).map((line) => {
    const coTotal = cos
      .filter((c) => c.budget_line_id === line.id && c.status === 'approved')
      .reduce((s, c) => s + c.cost_delta_cents, 0);
    const revised = line.budget_cents + coTotal;
    const linePos = pos.filter((p) => p.budget_line_id === line.id && ACTIVE_PO.has(p.status));
    const lineBills = bills.filter((b) => b.budget_line_id === line.id);
    const counted = lineBills.filter(costBill);
    const committed = linePos.reduce((s, p) => s + poTotal(p), 0);
    const billed = counted.reduce((s, b) => s + b.amount_cents, 0);
    const paid = lineBills.filter((b) => b.status === 'paid').reduce((s, b) => s + b.amount_cents, 0);
    const pending = lineBills.filter((b) => b.status === 'submitted').reduce((s, b) => s + b.amount_cents, 0);
    const activeIds = new Set(linePos.map((p) => p.id));
    const poCost = linePos.reduce((s, p) => {
      const onPo = counted.filter((b) => b.po_id === p.id).reduce((t, b) => t + b.amount_cents, 0);
      return s + Math.max(poTotal(p), onPo);
    }, 0);
    const looseCost = counted
      .filter((b) => !b.po_id || !activeIds.has(b.po_id))
      .reduce((s, b) => s + b.amount_cents, 0);
    const projected = poCost + looseCost;
    // Work not fully bought yet is assumed to use its whole budget, so early savings aren't counted.
    const forecast = line.bought_out ? projected : Math.max(revised, projected);
    return { line, revised, committed, billed, paid, pending, projected, forecast, over: Math.max(0, projected - revised) };
  });
}

/** Flag a line when the share of its budget spent runs this many points ahead of the share of work done. */
/** Our part of a job's profit on a partner deal, or null when the profit is all ours. */
export function ourShare(profitCents: number, pct: number | null | undefined): number | null {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return null;
  return Math.round((profitCents * Number(pct)) / 100);
}

export const PACE_GAP = 15;

export interface LineProgress {
  pct: number | null;       // work done, 0-100, as entered
  spentPct: number | null;  // billed as a share of the revised budget
  left: number;             // expected final cost minus what's billed so far (just what's still owed once 100% done)
  behind: boolean;          // spending is running ahead of the work
}

export function lineProgress(x: LineRollup): LineProgress {
  const raw = x.line.pct_complete;
  const pct = raw == null ? null : Math.max(0, Math.min(100, Math.round(Number(raw))));
  const spentPct = x.revised > 0 ? Math.round((x.billed / x.revised) * 100) : null;
  const behind = pct != null && pct < 100 && spentPct != null && x.billed > 0 && spentPct - pct >= PACE_GAP;
  // A finished line only has what's still owed on it left; otherwise assume it uses its expected final cost.
  const left = Math.max(0, (pct === 100 ? x.projected : x.forecast) - x.billed);
  return { pct, spentPct, left, behind };
}

/** How done the whole job is, weighted by each line's budget. Lines with no % count as 0. Null until any line has a %. */
export function jobPctDone(rolls: LineRollup[]): number | null {
  if (!rolls.some((x) => x.line.pct_complete != null)) return null;
  const total = rolls.reduce((s, x) => s + Math.max(0, x.revised), 0);
  if (total <= 0) return null;
  const done = rolls.reduce((s, x) => s + Math.max(0, x.revised) * ((lineProgress(x).pct ?? 0) / 100), 0);
  return Math.round((done / total) * 100);
}

export interface JobRollup {
  originalBudget: number; revised: number; committed: number; billed: number; paid: number; pending: number;
  forecast: number; over: number;
  salePrice: number;      // sale or contract price plus approved client change orders
  forecastMargin: number;
  drawnRequested: number; drawnFunded: number; loanLeft: number;
  outOfPocket: number;    // paid to vendors beyond what the lender has funded
}

export function rollupJob(
  job: Job, lines: BudgetLine[], pos: Po[], bills: Bill[], cos: ChangeOrder[], draws: Draw[], drawLines: DrawLine[],
): JobRollup {
  const r = rollupLines(lines, pos, bills, cos);
  const sum = (f: (x: LineRollup) => number) => r.reduce((s, x) => s + f(x), 0);
  const priceDelta = cos.filter((c) => c.status === 'approved').reduce((s, c) => s + c.price_delta_cents, 0);
  const salePrice = job.sale_price_cents + priceDelta;
  const forecast = sum((x) => x.forecast);
  const drawIds = new Set(draws.filter((d) => d.status !== 'draft').map((d) => d.id));
  const drawnRequested = drawLines.filter((l) => drawIds.has(l.draw_id)).reduce((s, l) => s + l.amount_cents, 0);
  const drawnFunded = draws.filter((d) => d.status === 'funded').reduce((s, d) => s + d.funded_cents, 0);
  const paid = sum((x) => x.paid);
  return {
    originalBudget: sum((x) => x.line.budget_cents),
    revised: sum((x) => x.revised),
    committed: sum((x) => x.committed),
    billed: sum((x) => x.billed),
    paid,
    pending: sum((x) => x.pending),
    forecast,
    over: sum((x) => x.over),
    salePrice,
    forecastMargin: salePrice - forecast,
    drawnRequested,
    drawnFunded,
    loanLeft: job.loan_amount_cents - drawnFunded,
    outOfPocket: Math.max(0, paid - drawnFunded),
  };
}

export interface DrawSheetRow {
  line: BudgetLine; budget: number; prior: number; thisDraw: number; total: number; balance: number; overdrawn: boolean;
}

// Lender's draw sheet: earlier draws (not drafts) count as prior, regardless of funded amount.
export function drawSheet(
  draw: Draw, lines: BudgetLine[], rollups: LineRollup[], draws: Draw[], drawLines: DrawLine[],
): DrawSheetRow[] {
  const earlier = new Set(
    draws.filter((d) => d.number < draw.number && d.status !== 'draft').map((d) => d.id),
  );
  return [...lines].sort((a, b) => a.sort - b.sort).map((line) => {
    const budget = rollups.find((r) => r.line.id === line.id)?.revised ?? line.budget_cents;
    const of = (pred: (l: DrawLine) => boolean) =>
      drawLines.filter((l) => l.budget_line_id === line.id && pred(l)).reduce((s, l) => s + l.amount_cents, 0);
    const prior = of((l) => earlier.has(l.draw_id));
    const thisDraw = of((l) => l.draw_id === draw.id);
    const total = prior + thisDraw;
    return { line, budget, prior, thisDraw, total, balance: budget - total, overdrawn: total > budget };
  });
}
