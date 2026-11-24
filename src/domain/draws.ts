import type { LineRollup } from './budget';
import type { BudgetLine, Draw, DrawLine } from './types';

/** What a line's finished work is worth: its budget times % done. Null when no % is set. */
export function earnedCents(x: Pick<LineRollup, 'revised'> & { line: Pick<BudgetLine, 'pct_complete'> }): number | null {
  const pct = x.line.pct_complete;
  return pct === null || pct === undefined ? null : Math.round((x.revised * pct) / 100);
}

export interface DrawLineSuggestion { lineId: string; name: string; pct: number; earned: number; drawn: number; amount: number }

/**
 * What to ask the lender for on each line: the work done so far, less what's already been drawn on it
 * (every draw that isn't this one and isn't a draft). Lines without a % done are left out.
 */
export function drawFromProgress(rolls: LineRollup[], draws: Draw[], drawLines: DrawLine[], exceptDrawId?: string): DrawLineSuggestion[] {
  const counted = new Set(draws.filter((d) => d.status !== 'draft' && d.id !== exceptDrawId).map((d) => d.id));
  return rolls.flatMap((x) => {
    const earned = earnedCents(x);
    if (earned === null) return [];
    const drawn = drawLines.filter((l) => l.budget_line_id === x.line.id && counted.has(l.draw_id)).reduce((s, l) => s + l.amount_cents, 0);
    const amount = Math.max(0, Math.min(earned, x.revised) - drawn);
    return [{ lineId: x.line.id, name: x.line.name, pct: x.line.pct_complete!, earned, drawn, amount }];
  });
}

export interface DrawStanding {
  /** Earned but not drawn yet: what a new draw could ask for. */
  ready: number;
  /** Drawn past the work done, on lines with a % set. */
  ahead: number;
  /** True once any line has a % done. */
  tracked: boolean;
}

export function drawStanding(rolls: LineRollup[], draws: Draw[], drawLines: DrawLine[]): DrawStanding {
  const rows = drawFromProgress(rolls, draws, drawLines);
  return {
    ready: rows.reduce((s, r) => s + r.amount, 0),
    ahead: rows.reduce((s, r) => s + Math.max(0, r.drawn - r.earned), 0),
    tracked: rows.length > 0,
  };
}

/** Below this, a draw isn't worth the lender's inspection fee, so Today doesn't bring it up. */
export const DRAW_READY_MIN_CENTS = 500000;
