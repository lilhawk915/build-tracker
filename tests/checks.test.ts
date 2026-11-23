import { describe, expect, it } from 'vitest';
import { attention } from '../src/domain/attention';
import { jobPctDone, lineProgress, rollupLines } from '../src/domain/budget';
import { checksDue, checkStatus, standardChecksFor, standardFor, startBlocker } from '../src/domain/checks';
import { copyPlan } from '../src/domain/templates';
import type { BudgetLine, Bill, Job, StepCheck, Task } from '../src/domain/types';

const task = (id: string, name: string, start: string, extra: Partial<Task> = {}): Task => ({
  id, job_id: 'j', vendor_id: null, name, start_date: start, end_date: start, depends_on: null,
  status: 'todo', notes: '', sort: 0, contact_status: 'not_contacted', ...extra,
});
const check = (task_id: string, done: boolean, label = 'x'): StepCheck => ({
  id: `${task_id}-${label}`, job_id: 'j', task_id, label, done, done_at: null, done_by: '', sort: 0,
});

describe('walk-through checklists', () => {
  it('matches the ready-made lists to the real step names', () => {
    expect(standardFor('Footer and foundation')?.title).toBe('Before the footer pour');
    expect(standardFor('Basement floor')?.title).toBe('Before the floor pour');
    expect(standardFor('Frame the house')?.title).toBe('Before framing');
    expect(standardFor('Insulation')?.title).toBe('Before insulation');
    expect(standardFor('Drywall')?.title).toBe('Before drywall');
    expect(standardFor('General cleanup and punch list')?.title).toBe('Final walk-through');
    expect(standardFor('Pull permits')).toBeUndefined();
  });
  it('blocks starting a step until its list is ticked', () => {
    const t = task('dw', 'Drywall', '2027-01-14');
    expect(startBlocker(t, [check('dw', true), check('dw', false, 'y')])).toBe('Finish the walk-through checklist for Drywall first: 1 of 2 done.');
    expect(startBlocker(t, [check('dw', true)])).toBeNull();
    expect(startBlocker(t, [])).toBeNull();
  });
  it('lists unfinished checklists for steps starting within 3 days', () => {
    const tasks = [task('a', 'Drywall', '2027-01-14'), task('b', 'Insulation', '2027-01-20'), task('c', 'Paint', '2027-01-12')];
    const checks = [check('a', false), check('b', false), check('c', true)];
    expect(checksDue(tasks, checks, '2027-01-11').map((x) => x.task.id)).toEqual(['a']);
  });
  it('builds standard lists only for steps without one', () => {
    const tasks = [task('a', 'Drywall', '2027-01-14'), task('b', 'Insulation', '2027-01-10'), task('c', 'Paint', '2027-01-20')];
    const rows = standardChecksFor(tasks, [check('b', false)]);
    expect(new Set(rows.map((r) => r.task_id))).toEqual(new Set(['a']));
    expect(rows.every((r) => !r.done)).toBe(true);
  });
  it('copies lists with a job, unticked and on the new steps', () => {
    const out = copyPlan({ tasks: [task('a', 'Drywall', '2027-01-14')], budget_lines: [], materials: [], step_checks: [check('a', true)] }, 'new', '2027-06-01');
    expect(out.step_checks).toHaveLength(1);
    expect(out.step_checks[0]).toMatchObject({ task_id: out.tasks[0].id, job_id: 'new', done: false });
  });
  it('shows on the Today list, as a stop once the step has started', () => {
    const base = { vendors: [], budget_lines: [], pos: [], bills: [], change_orders: [], draws: [], lien_waivers: [], materials: [] };
    const job = { id: 'j', name: 'Lot 1', address: '', job_type: 'spec', status: 'active', sale_price_cents: 0, loan_amount_cents: 0, lender: '', start_date: null, target_finish: null, notes: '' } as Job;
    const tasks = [task('a', 'Drywall', '2027-01-14')];
    const soon = attention({ ...base, jobs: [job], tasks, step_checks: [check('a', false)] }, '2027-01-12', String);
    expect(soon[0]).toMatchObject({ severity: 'act', label: 'Walk the checklist before Drywall starts 2027-01-14: 0 of 1 done' });
    const late = attention({ ...base, jobs: [job], tasks, step_checks: [check('a', false)] }, '2027-01-15', String);
    expect(late.find((a) => a.label.startsWith('Walk'))?.severity).toBe('stop');
  });
  it('counts done items', () => {
    expect(checkStatus([check('a', true), check('a', false, 'y'), check('b', false)], 'a')).toEqual({ total: 2, done: 1, complete: false });
  });
});

const line = (id: string, budget: number, pct: number | null = null, extra: Partial<BudgetLine> = {}): BudgetLine => ({
  id, job_id: 'j', code: id, name: `Line ${id}`, budget_cents: budget, bought_out: false, sort: 0, pct_complete: pct, ...extra,
});
const bill = (lineId: string, amount: number): Bill => ({
  id: `b-${lineId}-${amount}`, job_id: 'j', vendor_id: 'v', po_id: null, budget_line_id: lineId, invoice_no: '', amount_cents: amount,
  bill_date: '2026-11-01', status: 'approved', notes: '', file_path: null, paid_date: null, override_reason: null,
});

describe('percent done', () => {
  it('flags spending 15+ points ahead of the work', () => {
    const [r] = rollupLines([line('f', 10000, 50)], [], [bill('f', 7000)], []);
    expect(lineProgress(r)).toEqual({ pct: 50, spentPct: 70, left: 3000, behind: true });
    const [ok] = rollupLines([line('f', 10000, 60)], [], [bill('f', 7000)], []);
    expect(lineProgress(ok).behind).toBe(false);
  });
  it('does not flag lines with no % or nothing billed', () => {
    const [a] = rollupLines([line('f', 10000)], [], [bill('f', 9000)], []);
    expect(lineProgress(a).behind).toBe(false);
    const [b] = rollupLines([line('f', 10000, 0)], [], [], []);
    expect(lineProgress(b)).toMatchObject({ behind: false, left: 10000 });
  });
  it('a finished line only has unbilled commitments left', () => {
    const [r] = rollupLines([line('p', 9000, 100)], [], [], []);
    expect(lineProgress(r).left).toBe(0);
  });
  it('weights the job by budget, and is null until a line has a %', () => {
    expect(jobPctDone(rollupLines([line('a', 10000), line('b', 30000)], [], [], []))).toBeNull();
    expect(jobPctDone(rollupLines([line('a', 10000, 100), line('b', 30000, 50)], [], [], []))).toBe(63);
  });
});
