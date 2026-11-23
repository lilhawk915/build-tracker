import { describe, expect, it } from 'vitest';
import { copyPlan } from '../src/domain/templates';
import { lookAhead, lookAheadGroups, lookAheadText, weekOf } from '../src/domain/jobops';
import type { BudgetLine, Material, Task } from '../src/domain/types';

const task = (id: string, start: string, end: string, extra: Partial<Task> = {}): Task => ({
  id, job_id: 'src', vendor_id: null, name: id, start_date: start, end_date: end, depends_on: null,
  status: 'todo', notes: '', sort: 0, contact_status: 'not_contacted', ...extra,
});
const mat = (name: string, needed_by: string | null, extra: Partial<Material> = {}): Material => ({
  id: name, job_id: 'src', name, quantity: '', supplier: 'Lowe\'s', order_number: 'PO-9', status: 'arrived', needed_by,
  ordered_date: '2026-11-01', expected_date: '2026-11-05', arrived_date: '2026-11-04', cost_cents: 500, notes: 'n', ...extra,
});
const line = (code: string, cents: number, sort: number): BudgetLine =>
  ({ id: code, job_id: 'src', code, name: `L${code}`, budget_cents: cents, bought_out: true, sort });

describe('copy a job plan', () => {
  const src = {
    tasks: [
      task('permits', '2026-11-23', '2026-11-23', { sort: 0, assigned_to: 'ryan', status: 'done' }),
      task('dig', '2026-11-28', '2026-12-01', { sort: 1, depends_on: 'permits', vendor_id: 'np', contact_status: 'confirmed', notes: 'basement' }),
      task('walls', '2026-12-07', '2026-12-11', { sort: 2, depends_on: 'dig', vendor_id: 'bf', status: 'in_progress' }),
    ],
    budget_lines: [line('02', 500000, 1), line('01', 10000, 0)],
    materials: [mat('Lumber', '2026-12-14'), mat('Crew ask', '2026-12-01', { requested_by: 'u1', requested_by_name: 'Al' }), mat('Paint', null)],
  };
  const out = copyPlan(src, 'new', '2027-03-01');

  it('slides every date so the first step lands on the new start and keeps the gaps', () => {
    expect(out.tasks.map((t) => [t.name, t.start_date, t.end_date])).toEqual([
      ['permits', '2027-03-01', '2027-03-01'],
      ['dig', '2027-03-06', '2027-03-09'],
      ['walls', '2027-03-15', '2027-03-19'],
    ]);
  });

  it('keeps subs, people, notes and the starts-after links, pointing at the new steps', () => {
    const [p, d, w] = out.tasks;
    expect(d.depends_on).toBe(p.id);
    expect(w.depends_on).toBe(d.id);
    expect(new Set(out.tasks.map((t) => t.id)).size).toBe(3);
    expect(out.tasks.every((t) => !['permits', 'dig', 'walls'].includes(t.id))).toBe(true);
    expect([p.assigned_to, d.vendor_id, d.notes, w.vendor_id]).toEqual(['ryan', 'np', 'basement', 'bf']);
    expect(out.tasks.every((t) => t.job_id === 'new')).toBe(true);
  });

  it('carries nothing over as done, started or confirmed', () => {
    expect(out.tasks.map((t) => t.status)).toEqual(['todo', 'todo', 'todo']);
    expect(out.tasks.map((t) => t.contact_status)).toEqual(['not_contacted', 'not_contacted', 'not_contacted']);
  });

  it('copies budget amounts in order, not bought out', () => {
    expect(out.budget_lines.map((l) => [l.code, l.budget_cents, l.bought_out, l.sort, l.job_id])).toEqual([
      ['01', 10000, false, 0, 'new'], ['02', 500000, false, 1, 'new'],
    ]);
  });

  it('copies the order list as not ordered yet, with needed-by dates moved, and skips crew requests', () => {
    expect(out.materials.map((m) => [m.name, m.status, m.needed_by, m.order_number, m.ordered_date, m.arrived_date, m.cost_cents, m.supplier]))
      .toEqual([
        ['Lumber', 'needed', '2027-03-22', '', null, null, null, 'Lowe\'s'],
        ['Paint', 'needed', null, '', null, null, null, 'Lowe\'s'],
      ]);
  });

  it('handles a job with no schedule', () => {
    const r = copyPlan({ tasks: [], budget_lines: [line('01', 1, 0)], materials: [mat('X', '2026-01-01')] }, 'n', '2027-01-01');
    expect(r.tasks).toEqual([]);
    expect(r.budget_lines).toHaveLength(1);
    expect(r.materials[0].needed_by).toBeNull();
  });
});

describe('two-week look-ahead', () => {
  const today = '2026-11-22'; // a Sunday
  const tasks = [
    task('done', '2026-11-23', '2026-11-23', { status: 'done' }),
    task('going', '2026-11-20', '2026-11-24', { status: 'in_progress' }),
    task('mon', '2026-11-23', '2026-11-23'),
    task('nextwk', '2026-12-01', '2026-12-03', { job_id: 'b' }),
    task('lastday', '2026-12-05', '2026-12-09'),
    task('toofar', '2026-12-06', '2026-12-07'),
    task('over', '2026-11-01', '2026-11-10'),
  ];

  it('includes work that touches the next 14 days and is not done', () => {
    expect(lookAhead(tasks, today).map((t) => t.name)).toEqual(['going', 'mon', 'nextwk', 'lastday']);
  });

  it('weeks start on Monday', () => {
    expect(weekOf('2026-11-22')).toBe('2026-11-16');
    expect(weekOf('2026-11-23')).toBe('2026-11-23');
    expect(weekOf('2026-11-29')).toBe('2026-11-23');
  });

  it('groups into already going, then by week', () => {
    const g = lookAheadGroups(lookAhead(tasks, today), today);
    expect(g.map((x) => [x.label, x.tasks.map((t) => t.name)])).toEqual([
      ['Already going', ['going']],
      ['This week', ['mon']],
      ['Next week', ['nextwk', 'lastday']],
    ]);
  });

  it('on a weekday, that week is this week', () => {
    const wed = [task('wed', '2026-11-25', '2026-11-25'), task('mon2', '2026-11-30', '2026-11-30')];
    const g = lookAheadGroups(lookAhead(wed, '2026-11-25'), '2026-11-25');
    expect(g.map((x) => [x.label, x.tasks.map((t) => t.name)])).toEqual([['This week', ['wed']], ['Next week', ['mon2']]]);
  });

  it('writes a plain text of someone\'s dates', () => {
    const text = lookAheadText({
      who: 'Bryan',
      tasks: [task('Basement walls', '2026-12-07', '2026-12-11', { job_id: 'b' }), task('Insulation', '2027-01-11', '2027-01-11', { job_id: 'c' })],
      jobs: [{ id: 'b', name: 'Lewis Lane 1', address: '' }, { id: 'c', name: 'Lewis Lane 2', address: '1 Lewis Ln' }],
    });
    expect(text).toBe("Hi Bryan, here's what we have you down for in the next two weeks:\n- Mon, Dec 7 to Fri, Dec 11: Basement walls, Lewis Lane 1\n- Mon, Jan 11: Insulation, Lewis Lane 2 (1 Lewis Ln)\nLet me know if any of these dates don't work.");
  });
});
