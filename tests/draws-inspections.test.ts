import { describe, expect, it } from 'vitest';
import { attention } from '../src/domain/attention';
import { rollupLines } from '../src/domain/budget';
import { drawFromProgress, drawStanding } from '../src/domain/draws';
import { inspectionBlocker, inspectionNeeds, standardInspectionsFor } from '../src/domain/inspections';
import { subScore } from '../src/domain/scorecard';
import { copyPlan } from '../src/domain/templates';
import type { BudgetLine, Draw, DrawLine, Inspection, Job, Task, Vendor } from '../src/domain/types';

const line = (id: string, budget: number, pct: number | null): BudgetLine => ({ id, job_id: 'j', code: id, name: `Line ${id}`, budget_cents: budget, bought_out: false, sort: 0, pct_complete: pct });
const draw = (id: string, number: number, status: Draw['status']): Draw => ({ id, job_id: 'j', number, status, requested_date: null, funded_date: null, funded_cents: 0, notes: '' });
const dl = (draw_id: string, budget_line_id: string, amount_cents: number): DrawLine => ({ id: `${draw_id}-${budget_line_id}`, draw_id, budget_line_id, amount_cents });

describe('draws from % done', () => {
  const rolls = rollupLines([line('a', 100000, 50), line('b', 40000, 100), line('c', 20000, null)], [], [], []);
  it('asks for the work done less what was already drawn', () => {
    const rows = drawFromProgress(rolls, [draw('d1', 1, 'funded')], [dl('d1', 'a', 30000)]);
    expect(rows.map((r) => [r.lineId, r.earned, r.drawn, r.amount])).toEqual([['a', 50000, 30000, 20000], ['b', 40000, 0, 40000]]);
  });
  it('skips draft draws and the draw being edited', () => {
    const draws = [draw('d1', 1, 'requested'), draw('d2', 2, 'draft')];
    const lines = [dl('d1', 'a', 10000), dl('d2', 'a', 99999)];
    expect(drawFromProgress(rolls, draws, lines)[0].drawn).toBe(10000);
    expect(drawFromProgress(rolls, draws, lines, 'd1')[0].drawn).toBe(0);
  });
  it('flags draws ahead of the work and totals what is ready', () => {
    const st = drawStanding(rolls, [draw('d1', 1, 'funded')], [dl('d1', 'a', 70000)]);
    expect(st).toEqual({ ready: 40000, ahead: 20000, tracked: true });
    expect(drawStanding(rollupLines([line('c', 20000, null)], [], [], []), [], []).tracked).toBe(false);
  });
});

const task = (id: string, name: string, start: string, extra: Partial<Task> = {}): Task => ({
  id, job_id: 'j', vendor_id: null, name, start_date: start, end_date: start, depends_on: null, status: 'todo', notes: '', sort: 0, contact_status: 'not_contacted', ...extra,
});
const insp = (extra: Partial<Inspection>): Inspection => ({
  id: 'i', job_id: 'j', task_id: 'f', name: 'Footer', result: 'not_scheduled', scheduled_date: null, result_date: null, inspector: '', notes: '', vendor_id: null, fail_count: 0, sort: 0, ...extra,
});

describe('inspections', () => {
  const steps = [task('f', 'Footer and foundation', '2026-12-02', { sort: 0 }), task('i', 'Insulation', '2027-01-11', { sort: 1 }), task('d', 'Drywall', '2027-01-14', { sort: 2 })];
  it('ties the standard inspections to the steps they hold up', () => {
    const rows = standardInspectionsFor('j', steps);
    expect(rows.map((r) => [r.name, r.task_id])).toEqual([
      ['Footer', 'f'], ['Framing', 'i'], ['Rough plumbing, electric and HVAC', 'i'], ['Insulation', 'd'], ['Final', null],
    ]);
    expect(standardInspectionsFor('j', steps, [{ name: 'footer' }]).map((r) => r.name)).not.toContain('Footer');
  });
  it('blocks a step until its inspections pass or are not needed', () => {
    const t = steps[0];
    expect(inspectionBlocker(t, [insp({})])).toBe("Footer and foundation can't start until this inspection passes: Footer.");
    expect(inspectionBlocker(t, [insp({ result: 'failed' }), insp({ id: 'x', name: 'Setback' })])).toBe("Footer and foundation can't start until these inspections pass: Footer (failed), Setback.");
    expect(inspectionBlocker(t, [insp({ result: 'passed' }), insp({ id: 'x', result: 'not_needed' })])).toBeNull();
  });
  it('asks for scheduling a week out, results after the date, and fixes after a fail', () => {
    const today = '2026-11-26';
    expect(inspectionNeeds([insp({})], steps, today).map((n) => n.kind)).toEqual(['schedule']);
    expect(inspectionNeeds([insp({})], steps, '2026-11-20')).toEqual([]);
    expect(inspectionNeeds([insp({ result: 'scheduled', scheduled_date: '2026-11-25' })], steps, today).map((n) => n.kind)).toEqual(['result']);
    expect(inspectionNeeds([insp({ result: 'failed' })], steps, today).map((n) => n.kind)).toEqual(['failed']);
  });
  it('shows on Today', () => {
    const job = { id: 'j', name: 'Lot 1', address: '', job_type: 'spec', status: 'active', sale_price_cents: 0, loan_amount_cents: 0, lender: '', start_date: null, target_finish: null, notes: '' } as Job;
    const base = { vendors: [], budget_lines: [], pos: [], bills: [], change_orders: [], draws: [], lien_waivers: [], tasks: steps, jobs: [job] };
    const a = attention({ ...base, inspections: [insp({ task_id: 'f' })] }, '2026-11-28', String);
    expect(a.find((x) => x.label.includes('inspection'))).toMatchObject({ severity: 'act', label: "Schedule the Footer inspection: Footer and foundation can't start Dec 2 without it" });
    const f = attention({ ...base, inspections: [insp({ task_id: 'f', result: 'failed', notes: 'Rebar on the dirt' })] }, '2026-11-28', String);
    expect(f[0]).toMatchObject({ severity: 'stop', label: 'Footer inspection failed: Rebar on the dirt. Fix it and schedule a re-inspection' });
  });
  it('counts failures on the sub scorecard and copies with a job, unscheduled', () => {
    const v: Vendor = { id: 'v', name: 'Concrete', trade: '', coi_expires: null, w9_on_file: true, notes: '' };
    expect(subScore(v, { vendors: [v], tasks: [], photos: [], pos: [], bills: [], change_orders: [], inspections: [insp({ vendor_id: 'v', fail_count: 2 })] }, '2026-11-28').failedInspections).toBe(2);
    const out = copyPlan({ tasks: [steps[0]], budget_lines: [], materials: [], inspections: [insp({ task_id: 'f', result: 'passed', fail_count: 1, vendor_id: 'v' })] }, 'new', '2027-05-01');
    expect(out.inspections[0]).toMatchObject({ task_id: out.tasks[0].id, job_id: 'new', result: 'not_scheduled', fail_count: 0, vendor_id: null });
  });
});
