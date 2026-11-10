import { rollupLines } from './budget';
import { CALL_WINDOW_DAYS, callList, isRequested, materialLate, needsOrdering, scheduleHealth } from './jobops';
import { addDays } from './schedule';
import { coiFlag, isLate, payBlockers } from './rules';
import type { Bill, BudgetLine, ChangeOrder, Draw, Job, Material, Photo, Po, Task, Vendor, Waiver } from './types';

export interface WorkData {
  jobs: Job[]; vendors: Vendor[]; budget_lines: BudgetLine[]; pos: Po[]; bills: Bill[]; change_orders: ChangeOrder[];
  draws: Draw[]; lien_waivers: Waiver[]; tasks: Task[]; materials?: Material[]; photos?: Photo[];
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
  const vendor = (id: string | null) => d.vendors.find((v) => v.id === id);
  for (const job of d.jobs.filter((j) => j.status !== 'closed')) {
    const of = <T extends { job_id: string }>(rows: T[]) => rows.filter((r) => r.job_id === job.id);
    const bills = of(d.bills);
    const waivers = of(d.lien_waivers);
    const add = (severity: Attention['severity'], label: string, tab: string) =>
      out.push({ severity, label, jobId: job.id, tab });

    for (const r of rollupLines(of(d.budget_lines), of(d.pos), bills, of(d.change_orders))) {
      if (r.over > 0) add('stop', `${r.line.name} is ${money(r.over)} over budget`, 'budget');
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
      if (isLate(t, today)) add('stop', `${t.name} was due ${t.end_date}`, 'schedule');
    }
    for (const t of callList(of(d.tasks), today, CALL_WINDOW_DAYS)) {
      const soon = t.start_date <= addDays(today, 3);
      add(soon ? 'stop' : 'act', `Call ${vendor(t.vendor_id)?.name ?? 'the sub'}: ${t.name} starts ${t.start_date}, not confirmed`, 'contractors');
    }
    for (const m of of(d.materials ?? [])) {
      if (isRequested(m)) {
        const qty = m.quantity ? `${m.quantity} ` : '';
        add(m.needed_by && m.needed_by <= addDays(today, 3) ? 'stop' : 'act', `${m.requested_by_name} asked for ${qty}${m.name}`, 'materials');
      } else if (materialLate(m, today)) add('stop', `${m.name} was due ${m.expected_date} and hasn't arrived`, 'materials');
      else if (needsOrdering(m, today)) add('act', `Order ${m.name}: needed by ${m.needed_by}`, 'materials');
    }
    const waiting = new Map<string, number>();
    for (const p of of(d.photos ?? []).filter((x) => x.review_status === 'pending')) {
      const who = vendor(p.vendor_id)?.name ?? 'a contractor';
      waiting.set(who, (waiting.get(who) ?? 0) + 1);
    }
    for (const [who, n] of waiting) add('act', `Review ${n} photo${n === 1 ? '' : 's'} from ${who}`, 'log');
    const health = scheduleHealth(job, of(d.tasks), today);
    if (health.overTarget > 0) add('watch', `Projected to finish ${health.overTarget} days past the target`, 'schedule');
    for (const p of of(d.pos)) {
      if (p.status === 'declined') add('act', `${vendor(p.vendor_id)?.name ?? 'A sub'} declined PO ${p.number}`, 'pos');
    }
    for (const c of of(d.change_orders)) {
      if (c.status === 'pending') add('act', `Decide on change order ${c.number}: ${c.description}`, 'changes');
    }
    for (const dr of of(d.draws)) {
      if (dr.status === 'requested') add('watch', `Draw ${dr.number} is waiting on the lender`, 'draws');
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
