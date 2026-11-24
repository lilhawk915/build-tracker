import { lineProgress, rollupLines } from './budget';
import { arrivesTooLate, CALL_WINDOW_DAYS, callList, dailyCarryCents, isRequested, leadWords, materialLate, neededOn, orderFlag, scheduleHealth, stepFor } from './jobops';
import { checksDue } from './checks';
import { DRAW_READY_MIN_CENTS, drawStanding } from './draws';
import { inspectionNeeds } from './inspections';
import { addDays } from './schedule';
import { coiFlag, isLate, niceDate, payBlockers } from './rules';
import type { Bill, BudgetLine, ChangeOrder, Draw, DrawLine, Inspection, Job, Material, Photo, Po, StepCheck, Task, Vendor, Waiver } from './types';

export interface WorkData {
  jobs: Job[]; vendors: Vendor[]; budget_lines: BudgetLine[]; pos: Po[]; bills: Bill[]; change_orders: ChangeOrder[];
  draws: Draw[]; lien_waivers: Waiver[]; tasks: Task[]; materials?: Material[]; photos?: Photo[]; step_checks?: StepCheck[];
  inspections?: Inspection[]; draw_lines?: DrawLine[];
}

export interface Attention {
  severity: 'stop' | 'act' | 'watch';
  label: string;
  jobId?: string;
  tab?: string;
}

const RANK = { stop: 0, act: 1, watch: 2 };

export function attention(d: WorkData, today: string, money: (c: number) => string): Attention[] {
  const out: Attention[] = [];
  const day = (iso: string | null | undefined) => niceDate(iso, today);
  const vendor = (id: string | null) => d.vendors.find((v) => v.id === id);
  for (const job of d.jobs.filter((j) => j.status !== 'closed')) {
    const of = <T extends { job_id: string }>(rows: T[]) => rows.filter((r) => r.job_id === job.id);
    const bills = of(d.bills);
    const waivers = of(d.lien_waivers);
    const add = (severity: Attention['severity'], label: string, tab: string) =>
      out.push({ severity, label, jobId: job.id, tab });

    const rolls = rollupLines(of(d.budget_lines), of(d.pos), bills, of(d.change_orders));
    for (const r of rolls) {
      if (r.over > 0) add('stop', `${r.line.name} is ${money(r.over)} over budget`, 'budget');
      else {
        const p = lineProgress(r);
        if (p.behind) add('watch', `${r.line.name} is ${p.pct}% done but has used ${p.spentPct}% of its budget`, 'budget');
      }
    }
    for (const b of bills) {
      const name = vendor(b.vendor_id)?.name ?? 'Unknown sub';
      if (b.status === 'submitted') add('act', `Approve or reject ${name}'s ${money(b.amount_cents)} bill`, 'bills');
      if (b.status === 'approved') {
        const blocks = payBlockers(vendor(b.vendor_id), waivers, b.id, today);
        if (blocks.length) add('watch', `${name}'s ${money(b.amount_cents)} bill can't be paid yet: ${blocks.join(', ')}`, 'bills');
        else add('act', `Pay ${name}'s ${money(b.amount_cents)} bill`, 'bills');
      }
    }
    for (const w of waivers) {
      if (w.status === 'requested' && w.kind.startsWith('unconditional')) {
        add('watch', `Get the signed unconditional waiver from ${vendor(w.vendor_id)?.name ?? 'the sub'}`, 'waivers');
      }
    }
    for (const t of of(d.tasks)) {
      if (isLate(t, today)) add('stop', `${t.name} was due ${day(t.end_date)}`, 'schedule');
    }
    for (const { task, status } of checksDue(of(d.tasks), of(d.step_checks ?? []), today)) {
      const started = task.start_date <= today;
      add(started ? 'stop' : 'act', `Walk the checklist before ${task.name}${started ? '' : ` starts ${day(task.start_date)}`}: ${status.done} of ${status.total} done`, 'schedule');
    }
    for (const { inspection: i, step, kind } of inspectionNeeds(of(d.inspections ?? []), of(d.tasks), today)) {
      const name = `${i.name} inspection`;
      if (kind === 'failed') add('stop', `${name} failed${i.notes ? `: ${i.notes}` : ''}. Fix it and schedule a re-inspection`, 'schedule');
      else if (kind === 'result') add('act', `Enter the result of the ${name} from ${day(i.scheduled_date)}`, 'schedule');
      else if (step) add(step.start_date <= today ? 'stop' : 'act', `Schedule the ${name}: ${step.name} can't start ${step.start_date <= today ? 'until it passes' : `${day(step.start_date)} without it`}`, 'schedule');
    }
    for (const t of callList(of(d.tasks), today, CALL_WINDOW_DAYS)) {
      const soon = t.start_date <= addDays(today, 3);
      add(soon ? 'stop' : 'act', `Call ${vendor(t.vendor_id)?.name ?? 'the sub'}: ${t.name} starts ${day(t.start_date)}, not confirmed`, 'contractors');
    }
    for (const m of of(d.materials ?? [])) {
      if (isRequested(m)) {
        const qty = m.quantity ? `${m.quantity} ` : '';
        add(m.needed_by && m.needed_by <= addDays(today, 3) ? 'stop' : 'act', `${m.requested_by_name} asked for ${qty}${m.name}`, 'materials');
        continue;
      }
      const tasks = of(d.tasks);
      const step = stepFor(m, tasks);
      const forStep = step ? ` for ${step.name}` : '';
      const flag = orderFlag(m, tasks, today);
      if (materialLate(m, today)) add('stop', `${m.name} was due ${day(m.expected_date)} and hasn't arrived`, 'materials');
      else if (arrivesTooLate(m, tasks)) add('act', `${m.name} arrives ${day(m.expected_date)}, after it's needed ${day(neededOn(m, tasks))}${forStep}`, 'materials');
      else if (flag?.state === 'overdue') {
        add('stop', `Order ${m.name} now: it takes ${leadWords(Number(m.lead_days))} and is needed ${day(flag.need)}${forStep}. Order by was ${day(flag.orderBy)}`, 'materials');
      } else if (flag?.orderBy) add('act', `Order ${m.name} by ${day(flag.orderBy)}: it takes ${leadWords(Number(m.lead_days))}, needed ${day(flag.need)}${forStep}`, 'materials');
      else if (flag) add('act', `Order ${m.name}: needed by ${day(flag.need)}${forStep}`, 'materials');
    }
    const waiting = new Map<string, number>();
    for (const p of of(d.photos ?? []).filter((x) => x.review_status === 'pending')) {
      const who = vendor(p.vendor_id)?.name ?? 'a contractor';
      waiting.set(who, (waiting.get(who) ?? 0) + 1);
    }
    for (const [who, n] of waiting) add('act', `Review ${n} photo${n === 1 ? '' : 's'} from ${who}`, 'log');
    const health = scheduleHealth(job, of(d.tasks), today);
    if (health.overTarget > 0) {
      const perDay = dailyCarryCents(job);
      const cost = perDay ? ` (about ${money(perDay * health.overTarget)} more to carry)` : '';
      add('watch', `Projected to finish ${health.overTarget} days past the target${cost}`, 'schedule');
    }
    for (const p of of(d.pos)) {
      if (p.status === 'declined') add('act', `${vendor(p.vendor_id)?.name ?? 'A sub'} declined PO ${p.number}`, 'pos');
    }
    for (const c of of(d.change_orders)) {
      if (c.status === 'pending') add('act', `Decide on change order ${c.number}: ${c.description}`, 'changes');
    }
    const draws = of(d.draws);
    for (const dr of draws) {
      if (dr.status === 'requested') add('watch', `Draw ${dr.number} is waiting on the lender`, 'draws');
    }
    if (d.draw_lines && job.loan_amount_cents > 0) {
      const ids = new Set(draws.map((x) => x.id));
      const st = drawStanding(rolls, draws, d.draw_lines.filter((l) => ids.has(l.draw_id)));
      if (st.ahead > 0) add('watch', `Draws are ${money(st.ahead)} ahead of the work done`, 'draws');
      else if (st.ready >= DRAW_READY_MIN_CENTS && !draws.some((x) => x.status !== 'funded')) add('act', `About ${money(st.ready)} of finished work is ready to draw`, 'draws');
    }
  }
  const working = new Set(
    d.pos.filter((p) => p.status === 'accepted' || p.status === 'sent').map((p) => p.vendor_id),
  );
  for (const v of d.vendors.filter((x) => working.has(x.id))) {
    const f = coiFlag(v, today);
    if (f) out.push({ severity: f.severity, label: f.label });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
