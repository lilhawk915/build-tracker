import type { Data } from '../data';
import { rollupJob } from '../domain/budget';
import type { Job } from '../domain/types';
import { rowsToProject } from '../estimator/convert';
import { priceProject } from '../estimator/domain/pricing/resolve';
import type { CatalogItem, Settings } from '../estimator/domain/types';

export interface JobMoney {
  /** Contract or sale price plus approved change orders, in cents. */
  amount: number;
  /** Price minus forecast cost, in cents. Null when there is nothing to forecast from. */
  profit: number | null;
  /** Where the profit comes from: the job budget, or the accepted quote(s) when the job has no budget. */
  basis: 'budget' | 'quote' | null;
}

/** Admins only: it uses client prices and quote markups. */
export function jobMoney(job: Job, data: Data, catalog: CatalogItem[], settings: Settings): JobMoney {
  const of = <T extends { job_id: string | null }>(rows: T[]) => rows.filter((r) => r.job_id === job.id);
  const draws = of(data.draws);
  const ids = new Set(draws.map((d) => d.id));
  const lines = of(data.budget_lines);
  const cos = of(data.change_orders);
  const r = rollupJob(job, lines, of(data.pos), of(data.bills), cos, draws, data.draw_lines.filter((l) => ids.has(l.draw_id)));
  if (lines.some((l) => Number(l.budget_cents) !== 0)) return { amount: r.salePrice, profit: r.forecastMargin, basis: 'budget' };

  // No budget yet (a job set up from a quote before budgets were added): use the quote's own profit,
  // plus what each approved change order adds over its cost.
  const quotes = of(data.estimates);
  const priced = quotes.flatMap((e) => {
    const m = data.estimate_markups.find((x) => x.estimate_id === e.id);
    return m ? [priceProject(rowsToProject(e, m), catalog, settings)] : [];
  });
  if (!priced.length) return { amount: r.salePrice, profit: null, basis: null };
  const quoteProfit = priced.reduce((s, p) => s + Math.round(p.totals.profit * 100), 0);
  const coProfit = cos.filter((c) => c.status === 'approved').reduce((s, c) => s + Number(c.price_delta_cents) - Number(c.cost_delta_cents), 0);
  return { amount: r.salePrice, profit: quoteProfit + coProfit, basis: 'quote' };
}
