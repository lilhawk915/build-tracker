import { poTotal } from './budget';
import { daysBetween, isLate } from './rules';
import type { Bill, ChangeOrder, Inspection, Photo, Po, Task, Vendor } from './types';

/** The local calendar day of a timestamp, so a step finished at 9 PM isn't counted as the next day. */
export const localDay = (ts: string) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The finish date a sub was held to: the end date when the step started, so earlier delays aren't on them. */
export const promisedEnd = (t: Pick<Task, 'end_date' | 'promised_end'>) => t.promised_end ?? t.end_date;

/** Days past the promised finish a done step was finished. Null if no finish date was recorded. */
export function daysLate(t: Pick<Task, 'status' | 'end_date' | 'promised_end' | 'completed_at'>): number | null {
  if (t.status !== 'done' || !t.completed_at) return null;
  return Math.max(0, daysBetween(promisedEnd(t), localDay(t.completed_at)));
}

/** Fewer rated steps than this and a sub gets no grade yet. */
export const MIN_RATED = 2;

/** On-time rates below this are a problem; at or above GOOD_AT with no redos or overruns is strong. */
export const BAD_BELOW = 60;
export const GOOD_AT = 90;

export type Grade = 'good' | 'watch' | 'bad' | 'new';
export const GRADE_LABEL: Record<Grade, string> = { good: 'Strong', watch: 'Watch', bad: 'Problem', new: 'Not enough work yet' };

export interface SubScore {
  vendor: Vendor;
  /** Done steps with a recorded finish date. */
  rated: Task[];
  onTime: number;
  late: number;
  /** Average days late, over the late steps only. */
  avgDaysLate: number;
  /** Done steps from before finish dates were recorded. */
  unrated: number;
  /** Open steps already past their end date. */
  lateNow: Task[];
  /** Photos sent back to be fixed. */
  redos: number;
  /** Times an inspection failed on their work. */
  failedInspections: number;
  /** Purchase orders billed past their amount. */
  overPo: number;
  /** Approved change orders on their purchase orders, and what they added. */
  extras: number;
  extrasCents: number;
  /** Bills not rejected, across all jobs. */
  billedCents: number;
  onTimePct: number | null;
  grade: Grade;
}

export interface ScoreData {
  vendors: Vendor[]; tasks: Task[]; photos: Photo[]; pos: Po[]; bills: Bill[]; change_orders: ChangeOrder[]; inspections?: Inspection[];
}

export function subScore(vendor: Vendor, d: ScoreData, today: string): SubScore {
  const tasks = d.tasks.filter((t) => t.vendor_id === vendor.id);
  const rated = tasks.filter((t) => daysLate(t) !== null);
  const lateDays = rated.map((t) => daysLate(t)!).filter((n) => n > 0);
  const bills = d.bills.filter((b) => b.vendor_id === vendor.id && b.status !== 'rejected');
  const pos = d.pos.filter((p) => p.vendor_id === vendor.id);
  const overPo = pos.filter((p) => bills.filter((b) => b.po_id === p.id).reduce((s, b) => s + b.amount_cents, 0) > poTotal(p)).length;
  const poIds = new Set(pos.map((p) => p.id));
  const cos = d.change_orders.filter((c) => c.status === 'approved' && c.po_id && poIds.has(c.po_id) && c.cost_delta_cents > 0);
  const redos = d.photos.filter((p) => p.vendor_id === vendor.id && p.review_status === 'rejected').length;
  const failedInspections = (d.inspections ?? []).filter((i) => i.vendor_id === vendor.id).reduce((s, i) => s + i.fail_count, 0);
  const onTime = rated.length - lateDays.length;
  const onTimePct = rated.length ? Math.round((onTime / rated.length) * 100) : null;
  let grade: Grade = 'new';
  if (rated.length >= MIN_RATED && onTimePct !== null) {
    if (onTimePct < BAD_BELOW || redos + failedInspections >= 2) grade = 'bad';
    else if (onTimePct >= GOOD_AT && redos + failedInspections === 0 && overPo === 0) grade = 'good';
    else grade = 'watch';
  }
  return {
    vendor, rated, onTime, late: lateDays.length,
    avgDaysLate: lateDays.length ? Math.round(lateDays.reduce((s, n) => s + n, 0) / lateDays.length) : 0,
    unrated: tasks.filter((t) => t.status === 'done' && !t.completed_at).length,
    lateNow: tasks.filter((t) => isLate(t, today)),
    redos, failedInspections, overPo, extras: cos.length, extrasCents: cos.reduce((s, c) => s + c.cost_delta_cents, 0),
    billedCents: bills.reduce((s, b) => s + b.amount_cents, 0),
    onTimePct, grade,
  };
}

const GRADE_RANK: Record<Grade, number> = { bad: 0, watch: 1, good: 2, new: 3 };

/** Every sub's scorecard, problems first, then by name. */
export const scorecards = (d: ScoreData, today: string) =>
  d.vendors.map((v) => subScore(v, d, today))
    .sort((a, b) => GRADE_RANK[a.grade] - GRADE_RANK[b.grade] || a.vendor.name.localeCompare(b.vendor.name));
