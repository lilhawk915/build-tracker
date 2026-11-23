import { attention, type Attention, type WorkData } from './attention';
import { jobPctDone, rollupLines } from './budget';
import { dailyCarryCents, orderFlag, scheduleHealth, shortDate, weekOf, type OrderFlag, type ScheduleHealth } from './jobops';
import { localDay } from './scorecard';
import { addDays } from './schedule';
import type { Job, Material, Task, Vendor } from './types';

export interface WeekData extends WorkData {
  materials: Material[];
}

export interface JobWeek {
  job: Job;
  health: ScheduleHealth;
  /** Extra carrying cost from the days behind, in cents. 0 when on time or nothing entered. */
  carryCents: number;
  finished: Task[];
  arrived: Material[];
  paidCents: number;
  starting: Task[];
  going: Task[];
  toOrder: { m: Material; flag: OrderFlag }[];
  budget: { revised: number; billed: number; forecast: number; over: number; pctDone: number | null };
  stops: Attention[];
  acts: number;
}

export interface WeekSummary {
  /** Monday of the week being planned. */
  weekStart: string;
  /** First day counted as "since last week". */
  since: string;
  jobs: JobWeek[];
}

/**
 * The Monday look at every open job: what got done since last Monday, what's on this week, money,
 * and the problems. On a weekend it plans the week that starts next Monday.
 */
export function weekSummary(d: WeekData, today: string, money: (c: number) => string): WeekSummary {
  const weekStart = weekOf(addDays(today, 1));
  const weekEnd = addDays(weekStart, 6);
  const since = addDays(weekStart, -7);
  const needs = attention(d, today, money);
  const inRange = (day: string | null | undefined) => Boolean(day) && day! >= since && day! <= today;
  const jobs = d.jobs.filter((j) => j.status !== 'closed').map((job): JobWeek => {
    const of = <T extends { job_id: string }>(rows: T[]) => rows.filter((r) => r.job_id === job.id);
    const tasks = of(d.tasks);
    const health = scheduleHealth(job, tasks, today);
    const rolls = rollupLines(of(d.budget_lines), of(d.pos), of(d.bills), of(d.change_orders));
    const sum = (f: (x: (typeof rolls)[number]) => number) => rolls.reduce((s, x) => s + f(x), 0);
    const mine = needs.filter((n) => n.jobId === job.id);
    return {
      job, health,
      carryCents: health.state === 'behind' ? dailyCarryCents(job) * (health.daysBehind || health.overTarget) : 0,
      finished: tasks.filter((t) => t.status === 'done' && t.completed_at && inRange(localDay(t.completed_at))),
      arrived: of(d.materials).filter((m) => m.status === 'arrived' && inRange(m.arrived_date)),
      paidCents: of(d.bills).filter((b) => b.status === 'paid' && inRange(b.paid_date)).reduce((s, b) => s + b.amount_cents, 0),
      starting: tasks.filter((t) => t.status === 'todo' && t.start_date <= weekEnd).sort((a, b) => a.start_date.localeCompare(b.start_date)),
      going: tasks.filter((t) => t.status === 'in_progress'),
      toOrder: of(d.materials).flatMap((m) => { const flag = orderFlag(m, tasks, today); return flag ? [{ m, flag }] : []; }),
      budget: { revised: sum((x) => x.revised), billed: sum((x) => x.billed), forecast: sum((x) => x.forecast), over: sum((x) => x.over), pctDone: jobPctDone(rolls) },
      stops: mine.filter((n) => n.severity === 'stop'),
      acts: mine.filter((n) => n.severity === 'act').length,
    };
  });
  return { weekStart, since, jobs };
}

const when = (t: Pick<Task, 'start_date' | 'end_date'>) =>
  t.start_date === t.end_date ? shortDate(t.start_date) : `${shortDate(t.start_date)} to ${shortDate(t.end_date)}`;

/** The whole summary as plain text, to paste into an email or text. Never sent from here. */
export function weekText(s: WeekSummary, vendors: Pick<Vendor, 'id' | 'name'>[], money: (c: number) => string): string {
  const who = (t: Task) => vendors.find((v) => v.id === t.vendor_id)?.name;
  const out = [`Week of ${shortDate(s.weekStart)}`];
  for (const w of s.jobs) {
    out.push('', `${w.job.name.toUpperCase()}`);
    const finish = w.health.projectedFinish ? `, finish ${shortDate(w.health.projectedFinish)}` : '';
    const target = w.job.target_finish ? ` (target ${shortDate(w.job.target_finish)})` : '';
    out.push(`Schedule: ${w.health.label}${finish}${target}${w.carryCents ? `. About ${money(w.carryCents)} more to carry.` : ''}`);
    if (w.budget.revised) {
      const pct = w.budget.pctDone === null ? '' : `, ${w.budget.pctDone}% of the work done`;
      out.push(`Money: ${money(w.budget.billed)} billed of ${money(w.budget.revised)} budget${pct}${w.budget.over ? `. ${money(w.budget.over)} over budget.` : ''}`);
    }
    if (w.finished.length) out.push(`Finished: ${w.finished.map((t) => t.name).join(', ')}`);
    if (w.arrived.length) out.push(`Delivered: ${w.arrived.map((m) => m.name).join(', ')}`);
    if (w.paidCents) out.push(`Paid out: ${money(w.paidCents)}`);
    const week = [...w.going.map((t) => `${t.name} (going${who(t) ? `, ${who(t)}` : ''})`), ...w.starting.map((t) => `${t.name} ${when(t)}${who(t) ? `, ${who(t)}` : ''}`)];
    if (week.length) out.push(`This week: ${week.join('; ')}`);
    if (w.toOrder.length) out.push(`Order: ${w.toOrder.map(({ m }) => m.name).join(', ')}`);
    if (w.stops.length) out.push(`Problems: ${w.stops.map((n) => n.label).join('; ')}`);
  }
  return out.join('\n');
}
