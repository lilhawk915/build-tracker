import { describe, expect, it } from 'vitest';
import { daysLate, scorecards, subScore } from '../src/domain/scorecard';
import { weekSummary, weekText } from '../src/domain/weekly';
import type { Bill, Job, Material, Photo, Po, Task, Vendor } from '../src/domain/types';

const vendor = (id: string): Vendor => ({ id, name: `Sub ${id}`, trade: '', coi_expires: '2030-01-01', w9_on_file: true, notes: '' });
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, job_id: 'j', vendor_id: 'v', name: `Step ${id}`, start_date: '2026-11-01', end_date: '2026-11-05', depends_on: null,
  status: 'todo', notes: '', sort: 0, contact_status: 'not_contacted', ...extra,
});
const done = (id: string, finished: string, extra: Partial<Task> = {}) => task(id, { status: 'done', completed_at: `${finished}T15:00:00`, ...extra });
const empty = { photos: [] as Photo[], pos: [] as Po[], bills: [] as Bill[], change_orders: [] };

describe('sub scorecard', () => {
  it('scores lateness against the end date the step had when it started', () => {
    expect(daysLate(done('a', '2026-11-05'))).toBe(0);
    expect(daysLate(done('a', '2026-11-08'))).toBe(3);
    expect(daysLate(done('a', '2026-11-08', { promised_end: '2026-11-07', end_date: '2026-11-09' }))).toBe(1);
    expect(daysLate(done('a', '2026-11-02'))).toBe(0);
    expect(daysLate(task('a', { status: 'done' }))).toBeNull();
  });
  it('grades on time rate, redos and overruns', () => {
    const v = vendor('v');
    const good = subScore(v, { vendors: [v], tasks: [done('a', '2026-11-05'), done('b', '2026-11-04')], ...empty }, '2026-11-20');
    expect(good).toMatchObject({ onTimePct: 100, grade: 'good', late: 0 });
    const mixed = subScore(v, { vendors: [v], tasks: [done('a', '2026-11-05'), done('b', '2026-11-04'), done('c', '2026-11-09')], ...empty }, '2026-11-20');
    expect(mixed).toMatchObject({ onTimePct: 67, grade: 'watch', late: 1, avgDaysLate: 4 });
    const bad = subScore(v, { vendors: [v], tasks: [done('a', '2026-11-07'), done('b', '2026-11-09')], ...empty }, '2026-11-20');
    expect(bad.grade).toBe('bad');
    const one = subScore(v, { vendors: [v], tasks: [done('a', '2026-11-05')], ...empty }, '2026-11-20');
    expect(one.grade).toBe('new');
  });
  it('counts photos sent back, bills past the PO, late work and unscored steps', () => {
    const v = vendor('v');
    const photos = [{ id: 'p', job_id: 'j', vendor_id: 'v', task_id: null, file_path: '', caption: '', review_status: 'rejected', review_note: 'redo' }] as Photo[];
    const pos = [{ id: 'po', job_id: 'j', vendor_id: 'v', budget_line_id: 'l', number: 1, description: '', amount_cents: 1000, approved_co_cents: 0, status: 'accepted' }] as Po[];
    const bill = (id: string, amount: number, status: Bill['status'] = 'approved') =>
      ({ id, job_id: 'j', vendor_id: 'v', po_id: 'po', budget_line_id: 'l', invoice_no: '', amount_cents: amount, bill_date: '2026-11-01', status, notes: '', file_path: null, paid_date: null, override_reason: null }) as Bill;
    const s = subScore(v, {
      vendors: [v], photos, pos, bills: [bill('b1', 800), bill('b2', 300), bill('b3', 5000, 'rejected')], change_orders: [],
      tasks: [done('a', '2026-11-05'), done('b', '2026-11-05'), task('c', { status: 'done' }), task('d', { end_date: '2026-11-10' })],
    }, '2026-11-20');
    expect(s).toMatchObject({ redos: 1, overPo: 1, unrated: 1, billedCents: 1100, grade: 'watch' });
    expect(s.lateNow.map((t) => t.id)).toEqual(['d']);
  });
  it('lists problems first', () => {
    const tasks = [done('a', '2026-11-09', { vendor_id: 'b' }), done('c', '2026-11-09', { vendor_id: 'b' }), done('d', '2026-11-05', { vendor_id: 'a' }), done('e', '2026-11-05', { vendor_id: 'a' })];
    expect(scorecards({ vendors: [vendor('a'), vendor('b')], tasks, ...empty }, '2026-11-20').map((c) => c.vendor.id)).toEqual(['b', 'a']);
  });
});

describe('Monday summary', () => {
  const job = { id: 'j', name: 'Lot 1', address: '', job_type: 'spec', status: 'active', sale_price_cents: 0, loan_amount_cents: 36500000, lender: '', start_date: null, target_finish: null, notes: '', interest_rate: 10 } as Job;
  const base = { vendors: [vendor('v')], budget_lines: [], pos: [], bills: [], change_orders: [], draws: [], lien_waivers: [] };
  const mat = (extra: Partial<Material>) => ({ id: 'm', job_id: 'j', name: 'Trusses', quantity: '', supplier: '', order_number: '', status: 'needed', needed_by: null, ordered_date: null, expected_date: null, arrived_date: null, cost_cents: null, notes: '', ...extra }) as Material;
  // Monday 2026-11-23: since Monday 11-16.
  const today = '2026-11-23';

  it('splits work into done since last Monday and this week', () => {
    const tasks = [
      done('old', '2026-11-12', { end_date: '2026-11-12' }),
      done('new', '2026-11-18', { end_date: '2026-11-18' }),
      task('going', { status: 'in_progress', start_date: '2026-11-20', end_date: '2026-11-25' }),
      task('soon', { start_date: '2026-11-26', end_date: '2026-11-27' }),
      task('later', { start_date: '2026-12-10', end_date: '2026-12-11' }),
    ];
    const materials = [mat({ status: 'arrived', arrived_date: '2026-11-17' }), mat({ id: 'm2', name: 'Doors', needed_by: '2026-11-26' })];
    const s = weekSummary({ ...base, jobs: [job], tasks, materials }, today, String);
    expect(s).toMatchObject({ weekStart: '2026-11-23', since: '2026-11-16' });
    const [w] = s.jobs;
    expect(w.finished.map((t) => t.id)).toEqual(['new']);
    expect(w.going.map((t) => t.id)).toEqual(['going']);
    expect(w.starting.map((t) => t.id)).toEqual(['soon']);
    expect(w.arrived.map((m) => m.name)).toEqual(['Trusses']);
    expect(w.toOrder.map(({ m }) => m.name)).toEqual(['Doors']);
    const text = weekText(s, base.vendors, (c) => `$${c / 100}`);
    expect(text).toContain('LOT 1');
    expect(text).toContain('Finished: Step new');
    expect(text).toContain('This week: Step going (going, Sub v); Step soon Thu, Nov 26 to Fri, Nov 27, Sub v');
  });
  it('plans next week on a Sunday, and prices the days behind', () => {
    const late = task('late', { start_date: '2026-11-10', end_date: '2026-11-19', status: 'in_progress' });
    const s = weekSummary({ ...base, jobs: [job], tasks: [late], materials: [] }, '2026-11-22', String);
    expect(s.weekStart).toBe('2026-11-23');
    // 3 days behind at $100 a day of interest.
    expect(s.jobs[0]).toMatchObject({ carryCents: 30000 });
    expect(s.jobs[0].stops[0].label).toContain('was due');
  });
  it('leaves closed jobs out', () => {
    expect(weekSummary({ ...base, jobs: [{ ...job, status: 'closed' }], tasks: [], materials: [] }, today, String).jobs).toHaveLength(0);
  });
});
