import { describe, expect, it } from 'vitest';
import { attention } from '../src/domain/attention';
import { arrivesTooLate, dailyCarryCents, finishSlip, leadWords, neededOn, needsOrdering, orderByDate, orderFlag } from '../src/domain/jobops';
import { copyPlan } from '../src/domain/templates';
import type { Job, Material, Task } from '../src/domain/types';

const task = (id: string, start: string, end = start, extra: Partial<Task> = {}): Task => ({
  id, job_id: 'j', vendor_id: null, name: `Step ${id}`, start_date: start, end_date: end, depends_on: null,
  status: 'todo', notes: '', sort: 0, contact_status: 'not_contacted', ...extra,
});
const mat = (extra: Partial<Material> = {}): Material => ({
  id: 'm', job_id: 'j', name: 'Trusses', quantity: '', supplier: '', order_number: '', status: 'needed', needed_by: null,
  ordered_date: null, expected_date: null, arrived_date: null, cost_cents: null, notes: '', ...extra,
});
const steps = [task('frame', '2026-12-20', '2026-12-30')];

describe('order-by dates', () => {
  it('uses the linked step start as the need date, else Need by', () => {
    expect(neededOn(mat({ task_id: 'frame', needed_by: '2026-12-01' }), steps)).toBe('2026-12-20');
    expect(neededOn(mat({ needed_by: '2026-12-01' }), steps)).toBe('2026-12-01');
    expect(neededOn(mat({ task_id: 'gone', needed_by: '2026-12-01' }), steps)).toBe('2026-12-01');
  });
  it('order-by is need date minus lead time', () => {
    expect(orderByDate(mat({ task_id: 'frame', lead_days: 21 }), steps)).toBe('2026-11-29');
    expect(orderByDate(mat({ task_id: 'frame' }), steps)).toBeNull();
  });
  it('flags within 3 days of order-by, and past it', () => {
    const m = mat({ task_id: 'frame', lead_days: 21 });
    expect(orderFlag(m, steps, '2026-11-25')).toBeNull();
    expect(orderFlag(m, steps, '2026-11-26')?.state).toBe('now');
    expect(orderFlag(m, steps, '2026-11-29')?.state).toBe('now');
    expect(orderFlag(m, steps, '2026-11-30')?.state).toBe('overdue');
    expect(orderFlag({ ...m, status: 'ordered' }, steps, '2026-12-10')).toBeNull();
  });
  it('without a lead time keeps the one-week rule', () => {
    expect(needsOrdering(mat({ needed_by: '2026-12-05' }), '2026-11-28')).toBe(true);
    expect(needsOrdering(mat({ needed_by: '2026-12-06' }), '2026-11-28')).toBe(false);
  });
  it('follows the schedule when the step moves', () => {
    const m = mat({ task_id: 'frame', lead_days: 21 });
    expect(orderFlag(m, [task('frame', '2027-01-10')], '2026-11-30')).toBeNull();
  });
  it('catches an order arriving after the step starts', () => {
    expect(arrivesTooLate(mat({ status: 'ordered', task_id: 'frame', expected_date: '2026-12-21' }), steps)).toBe(true);
    expect(arrivesTooLate(mat({ status: 'ordered', task_id: 'frame', expected_date: '2026-12-20' }), steps)).toBe(false);
  });
  it('says lead times in weeks when even', () => {
    expect(leadWords(21)).toBe('3 weeks');
    expect(leadWords(7)).toBe('1 week');
    expect(leadWords(10)).toBe('10 days');
  });
  it('copyPlan keeps lead times and relinks steps', () => {
    const out = copyPlan({ tasks: steps, budget_lines: [], materials: [mat({ task_id: 'frame', lead_days: 21 })] }, 'new', '2027-03-01');
    expect(out.materials[0].lead_days).toBe(21);
    expect(out.materials[0].task_id).toBe(out.tasks[0].id);
  });
});

const job = (extra: Partial<Job> = {}): Job => ({
  id: 'j', name: 'Lot 1', address: '', job_type: 'spec', status: 'active', sale_price_cents: 0, loan_amount_cents: 30000000,
  lender: '', start_date: '2026-11-01', target_finish: null, notes: '', ...extra,
});

describe('carrying cost', () => {
  it('is loan interest per day plus other monthly costs', () => {
    expect(dailyCarryCents(job({ interest_rate: 12 }))).toBe(9863);
    expect(dailyCarryCents(job({ interest_rate: 12, holding_monthly_cents: 60000 }))).toBe(11836);
    expect(dailyCarryCents(job())).toBe(0);
  });
  it('counts how far moves push the finish', () => {
    const ts = [task('a', '2026-12-01', '2026-12-05'), task('b', '2026-12-06', '2026-12-10')];
    expect(finishSlip(ts, [{ id: 'b', end_date: '2026-12-14' }])).toBe(4);
    expect(finishSlip(ts, [{ id: 'a', end_date: '2026-12-07' }])).toBe(0);
  });
});

describe('attention', () => {
  const base = { vendors: [], budget_lines: [], pos: [], bills: [], change_orders: [], draws: [], lien_waivers: [] };
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  it('says when to order and that a past order-by is a stop', () => {
    const tasks = [task('frame', '2026-12-20', '2026-12-30', { name: 'Frame house' })];
    const soon = attention({ ...base, jobs: [job()], tasks, materials: [mat({ task_id: 'frame', lead_days: 21 })] }, '2026-11-27', money);
    expect(soon[0]).toMatchObject({ severity: 'act', label: 'Order Trusses by Nov 29: it takes 3 weeks, needed Dec 20 for Frame house' });
    const late = attention({ ...base, jobs: [job()], tasks, materials: [mat({ task_id: 'frame', lead_days: 21 })] }, '2026-12-01', money);
    expect(late[0].severity).toBe('stop');
    expect(late[0].label).toContain('Order Trusses now');
  });
  it('prices a finish past target', () => {
    const tasks = [task('a', '2026-11-01', '2026-11-20', { status: 'in_progress' })];
    const out = attention({ ...base, jobs: [job({ interest_rate: 12, target_finish: '2026-11-15' })], tasks, materials: [] }, '2026-11-10', money);
    expect(out.find((a) => a.label.startsWith('Projected'))?.label).toBe('Projected to finish 5 days past the target (about $493.15 more to carry)');
  });
});
