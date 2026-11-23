import { daysBetween } from './rules';
import { addDays } from './schedule';
import type { Job, Material, Task, VendorContact } from './types';

// ---------- schedule status ----------
export interface ScheduleHealth {
  state: 'none' | 'done' | 'on' | 'behind';
  daysBehind: number;
  projectedFinish: string | null;
  overTarget: number;  // days the projected finish runs past the target finish
  lateTasks: Task[];
  label: string;
}

// A task is behind if it should have finished, or should have started and hasn't.
// Unfinished work pushes the projected finish out by the worst delay.
export function scheduleHealth(job: Pick<Job, 'target_finish'>, tasks: Task[], today: string): ScheduleHealth {
  if (!tasks.length) return { state: 'none', daysBehind: 0, projectedFinish: null, overTarget: 0, lateTasks: [], label: 'No schedule' };
  const open = tasks.filter((t) => t.status !== 'done');
  const lastEnd = tasks.reduce((m, t) => (t.end_date > m ? t.end_date : m), tasks[0].end_date);
  if (!open.length) return { state: 'done', daysBehind: 0, projectedFinish: lastEnd, overTarget: 0, lateTasks: [], label: 'Schedule complete' };
  const delay = (t: Task) => {
    const finishLate = t.end_date < today ? daysBetween(t.end_date, today) : 0;
    const startLate = t.status === 'todo' && t.start_date < today ? daysBetween(t.start_date, today) : 0;
    return Math.max(finishLate, startLate);
  };
  const lateTasks = open.filter((t) => delay(t) > 0);
  const daysBehind = Math.max(0, ...open.map(delay));
  const projectedFinish = addDays(lastEnd, daysBehind);
  const overTarget = job.target_finish ? Math.max(0, daysBetween(job.target_finish, projectedFinish)) : 0;
  const behind = daysBehind > 0 || overTarget > 0;
  const n = daysBehind || overTarget;
  return {
    state: behind ? 'behind' : 'on', daysBehind, projectedFinish, overTarget, lateTasks,
    label: behind ? `${n} day${n === 1 ? '' : 's'} behind` : 'On schedule',
  };
}

// ---------- contractor call list ----------
export const CALL_WINDOW_DAYS = 14;

// Open sub tasks starting soon that aren't confirmed yet, soonest first.
export function callList(tasks: Task[], today: string, windowDays = CALL_WINDOW_DAYS): Task[] {
  const cutoff = addDays(today, windowDays);
  return tasks
    .filter((t) => t.vendor_id && t.status === 'todo' && t.contact_status !== 'confirmed' && t.start_date <= cutoff)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}

// ---------- materials ----------
export const materialLate = (m: Pick<Material, 'status' | 'expected_date'>, today: string) =>
  m.status === 'ordered' && Boolean(m.expected_date) && m.expected_date! < today;

// ---------- order-by dates ----------
/** Flag an item to order this many days before its order-by date. */
export const ORDER_WARN_DAYS = 3;
/** Without a lead time, flag an item this many days before it's needed. */
export const ORDER_SOON_DAYS = 7;

type Orderable = Pick<Material, 'status' | 'needed_by'> & { lead_days?: number | null; task_id?: string | null };
type StepDates = Pick<Task, 'id' | 'start_date'>;

/** The step an item is for, if it's linked to one that still exists. */
export const stepFor = <T extends StepDates>(m: Pick<Orderable, 'task_id'>, tasks: T[]): T | undefined =>
  m.task_id ? tasks.find((t) => t.id === m.task_id) : undefined;

/** The day an item has to be on site: the start of the step it's for (so it moves with the schedule), else its own Need by date. */
export function neededOn(m: Orderable, tasks: StepDates[]): string | null {
  return stepFor(m, tasks)?.start_date ?? m.needed_by ?? null;
}

/** The last day to order and still have it on time: needed date minus the supplier's lead time. */
export function orderByDate(m: Orderable, tasks: StepDates[]): string | null {
  const need = neededOn(m, tasks);
  return need && m.lead_days ? addDays(need, -Number(m.lead_days)) : null;
}

export interface OrderFlag { state: 'overdue' | 'now'; orderBy: string | null; need: string }

/**
 * Still to order and time to order it. With a lead time: within ORDER_WARN_DAYS of the order-by date
 * ('now'), or past it ('overdue': it will show up after it's needed). Without a lead time: needed within
 * ORDER_SOON_DAYS ('now').
 */
export function orderFlag(m: Orderable, tasks: StepDates[], today: string): OrderFlag | null {
  if (m.status !== 'needed') return null;
  const need = neededOn(m, tasks);
  if (!need) return null;
  const by = orderByDate(m, tasks);
  if (by) {
    if (by < today) return { state: 'overdue', orderBy: by, need };
    return by <= addDays(today, ORDER_WARN_DAYS) ? { state: 'now', orderBy: by, need } : null;
  }
  return need <= addDays(today, ORDER_SOON_DAYS) ? { state: 'now', orderBy: null, need } : null;
}

export const needsOrdering = (m: Orderable, today: string, tasks: StepDates[] = []) => orderFlag(m, tasks, today) !== null;

/** Ordered, but the supplier's arrival date is after the day it's needed. */
export function arrivesTooLate(m: Orderable & Pick<Material, 'expected_date'>, tasks: StepDates[]): boolean {
  if (m.status !== 'ordered' || !m.expected_date) return false;
  const need = neededOn(m, tasks);
  return Boolean(need && m.expected_date > need);
}

/** Lead time in plain words: "3 weeks", "10 days". */
export function leadWords(days: number): string {
  return days >= 7 && days % 7 === 0 ? `${days / 7} week${days === 7 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'}`;
}

// ---------- carrying cost ----------
type Carry = Pick<Job, 'loan_amount_cents'> & { interest_rate?: number | null; holding_monthly_cents?: number | null };

/**
 * What one more day on a job costs to carry, in cents: interest on the full loan amount plus other
 * monthly costs. Figured on the whole loan, so it's the most a day can cost. 0 when nothing is entered.
 */
export function dailyCarryCents(job: Carry): number {
  const interest = ((Number(job.loan_amount_cents) || 0) * (Number(job.interest_rate) || 0)) / 100 / 365;
  const other = ((Number(job.holding_monthly_cents) || 0) * 12) / 365;
  return Math.round(interest + other);
}

/** The last finish date across the steps, or null with no steps. */
export function finishOf(tasks: Pick<Task, 'end_date'>[]): string | null {
  return tasks.reduce<string | null>((m, t) => (!m || t.end_date > m ? t.end_date : m), null);
}

/** How many days a set of date changes pushes the job's finish out (0 if it doesn't). */
export function finishSlip(tasks: Task[], moves: { id: string; end_date: string }[]): number {
  const before = finishOf(tasks);
  const moved = new Map(moves.map((m) => [m.id, m.end_date]));
  const after = finishOf(tasks.map((t) => ({ end_date: moved.get(t.id) ?? t.end_date })));
  return before && after ? Math.max(0, daysBetween(before, after)) : 0;
}

export interface MaterialSummary {
  needed: number; ordered: number; arrived: number; late: number; orderedCost: number;
}

export function summarizeMaterials(rows: Material[], today: string): MaterialSummary {
  return {
    needed: rows.filter((m) => m.status === 'needed').length,
    ordered: rows.filter((m) => m.status === 'ordered').length,
    arrived: rows.filter((m) => m.status === 'arrived').length,
    late: rows.filter((m) => materialLate(m, today)).length,
    orderedCost: rows.filter((m) => m.status !== 'needed').reduce((s, m) => s + (m.cost_cents ?? 0), 0),
  };
}

// "12 2x4x8 studs" becomes quantity 12 and the rest as the name. One item per line.
export function parseMaterialLines(text: string): { name: string; quantity: string }[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^(\d[\d,.]*)\s*(?:x\s+)?(\D.*)$/i);
    return m ? { quantity: m[1], name: m[2].trim() } : { quantity: '', name: line };
  });
}

// ---------- messages ----------
// Returns digits with country code for a text or call link, or '' if it can't be a US number.
export function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return '';
}

export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

export function taskMessage(opts: {
  firstName: string; task: Pick<Task, 'name' | 'start_date' | 'end_date'>; job: { name: string; address: string }; sender: string;
}): string {
  const { firstName, task, job, sender } = opts;
  const place = job.address || job.name;
  const when = task.start_date === task.end_date
    ? shortDate(task.start_date)
    : `${shortDate(task.start_date)} to ${shortDate(task.end_date)}`;
  const hi = firstName ? `Hi ${firstName}, ` : 'Hi, ';
  return `${hi}this is ${sender}. You're scheduled for ${task.name} at ${place}, ${when}. Can you confirm you'll be there?`;
}

export const smsLink = (phone: string, body: string) => `sms:${phoneDigits(phone)}?&body=${encodeURIComponent(body)}`;

export const emailLink = (email: string, subject: string, body: string) =>
  `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export const firstNameOf = (c?: Pick<VendorContact, 'name'>) => c?.name.trim().split(/\s+/)[0] ?? '';

// The main contact for a sub: the one marked primary, or else the first with a way to reach them.
export function primaryContact(contacts: VendorContact[], vendorId: string | null): VendorContact | undefined {
  const mine = contacts.filter((c) => c.vendor_id === vendorId);
  return mine.find((c) => c.is_primary) ?? mine.find((c) => c.mobile || c.office_phone || c.email) ?? mine[0];
}

export const bestPhone = (c?: Pick<VendorContact, 'mobile' | 'office_phone'>) => c?.mobile || c?.office_phone || '';

export const isRequested = (m: Pick<Material, 'status' | 'requested_by_name'>) => m.status === 'needed' && Boolean(m.requested_by_name);

// ---------- two-week look-ahead ----------
export const LOOKAHEAD_DAYS = 14;

/** Monday of the week an ISO date falls in. */
export function weekOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

/** Work that isn't done and touches the next `days` days (today included), soonest first. */
export function lookAhead(tasks: Task[], today: string, days = LOOKAHEAD_DAYS): Task[] {
  const last = addDays(today, days - 1);
  return tasks
    .filter((t) => t.status !== 'done' && t.start_date <= last && t.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date) || a.sort - b.sort);
}

/** Look-ahead rows grouped for display: work already going, then one group per week (Monday start). */
export function lookAheadGroups(rows: Task[], today: string): { key: string; label: string; tasks: Task[] }[] {
  const going = rows.filter((t) => t.start_date < today);
  const weeks = new Map<string, Task[]>();
  for (const t of rows.filter((x) => x.start_date >= today)) {
    const w = weekOf(t.start_date);
    weeks.set(w, [...(weeks.get(w) ?? []), t]);
  }
  // On a Sunday, the week you're planning is the one that starts tomorrow.
  const thisWeek = weekOf(addDays(today, 1));
  const label = (w: string) =>
    w === thisWeek ? 'This week' : w === addDays(thisWeek, 7) ? 'Next week' : `Week of ${shortDate(w)}`;
  return [
    ...(going.length ? [{ key: 'going', label: 'Already going', tasks: going }] : []),
    ...[...weeks.entries()].map(([w, tasks]) => ({ key: w, label: label(w), tasks })),
  ];
}

/** Plain-text list of one person's or sub's next two weeks, ready to paste into a text. Never sent from here. */
export function lookAheadText(opts: {
  who: string; tasks: Pick<Task, 'job_id' | 'name' | 'start_date' | 'end_date'>[]; jobs: { id: string; name: string; address: string }[];
}): string {
  const lines = opts.tasks.map((t) => {
    const job = opts.jobs.find((j) => j.id === t.job_id);
    const place = job ? (job.address ? `${job.name} (${job.address})` : job.name) : 'Job';
    const when = t.start_date === t.end_date ? shortDate(t.start_date) : `${shortDate(t.start_date)} to ${shortDate(t.end_date)}`;
    return `- ${when}: ${t.name}, ${place}`;
  });
  const hi = opts.who ? `Hi ${opts.who}, here` : 'Here';
  return `${hi}'s what we have you down for in the next two weeks:\n${lines.join('\n')}\nLet me know if any of these dates don't work.`;
}
