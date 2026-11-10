import { describe, expect, it } from 'vitest';
import { bestPhone, callList, emailLink, primaryContact, materialLate, needsOrdering, parseMaterialLines, phoneDigits, scheduleHealth, smsLink, summarizeMaterials, taskMessage } from '../src/domain/jobops';
import { stepsFor } from '../src/domain/record';
import { highlightParts, search, type SearchData } from '../src/domain/search';
import type { JobStep, Material, Photo, VendorContact } from '../src/domain/types';
import { attention, type WorkData } from '../src/domain/attention';
import { csvCell, money, parseMoney, toCsv } from '../src/domain/csv';
import { drawSheet, rollupJob, rollupLines } from '../src/domain/budget';
import { canMoveBill, coiFlag, followUpWaiverKind, payBlockers } from '../src/domain/rules';
import { cascade, wouldLoop } from '../src/domain/schedule';
import type { Bill, BudgetLine, ChangeOrder, Draw, DrawLine, Job, Po, Task, Vendor, Waiver } from '../src/domain/types';

const line = (id: string, budget: number, extra: Partial<BudgetLine> = {}): BudgetLine =>
  ({ id, job_id: 'j', code: '', name: id, budget_cents: budget, bought_out: false, sort: 0, ...extra });
const po = (id: string, l: string, amt: number, extra: Partial<Po> = {}): Po =>
  ({ id, job_id: 'j', vendor_id: 'v', budget_line_id: l, number: 1, description: '', amount_cents: amt, approved_co_cents: 0, status: 'accepted', ...extra });
const bill = (id: string, l: string, amt: number, extra: Partial<Bill> = {}): Bill =>
  ({ id, job_id: 'j', vendor_id: 'v', po_id: null, budget_line_id: l, invoice_no: '', amount_cents: amt, bill_date: '2026-01-01', status: 'approved', notes: '', file_path: null, paid_date: null, override_reason: null, ...extra });
const co = (l: string, cost: number, price: number, status: ChangeOrder['status'] = 'approved'): ChangeOrder =>
  ({ id: `c${l}${cost}`, job_id: 'j', budget_line_id: l, po_id: null, number: 1, description: '', cost_delta_cents: cost, price_delta_cents: price, status });

describe('budget rollup', () => {
  it('counts a PO at its promised amount before any bills arrive', () => {
    const [r] = rollupLines([line('a', 10000)], [po('p', 'a', 8000)], [], []);
    expect(r.committed).toBe(8000);
    expect(r.projected).toBe(8000);
    expect(r.over).toBe(0);
  });

  it('does not double count a bill against its own PO', () => {
    const [r] = rollupLines([line('a', 10000)], [po('p', 'a', 8000)], [bill('b', 'a', 3000, { po_id: 'p' })], []);
    expect(r.projected).toBe(8000);
    expect(r.billed).toBe(3000);
  });

  it('uses the billed amount when bills run past the PO', () => {
    const [r] = rollupLines([line('a', 10000)], [po('p', 'a', 8000)], [bill('b', 'a', 11000, { po_id: 'p' })], []);
    expect(r.projected).toBe(11000);
    expect(r.over).toBe(1000);
  });

  it('adds bills with no PO on top of PO commitments', () => {
    const [r] = rollupLines([line('a', 10000)], [po('p', 'a', 8000)], [bill('b', 'a', 3000)], []);
    expect(r.projected).toBe(11000);
    expect(r.over).toBe(1000);
  });

  it('ignores drafts, declined POs, rejected bills and unapproved change orders', () => {
    const [r] = rollupLines(
      [line('a', 10000)],
      [po('d', 'a', 5000, { status: 'draft' }), po('x', 'a', 5000, { status: 'declined' })],
      [bill('r', 'a', 5000, { status: 'rejected' })],
      [co('a', 5000, 0, 'pending')],
    );
    expect(r.committed).toBe(0);
    expect(r.projected).toBe(0);
    expect(r.revised).toBe(10000);
  });

  it('still counts a real bill when its PO was declined', () => {
    const [r] = rollupLines([line('a', 1000)], [po('x', 'a', 5000, { status: 'declined' })], [bill('b', 'a', 700, { po_id: 'x' })], []);
    expect(r.projected).toBe(700);
  });

  it('counts submitted bills as pending, not as cost', () => {
    const [r] = rollupLines([line('a', 1000)], [], [bill('b', 'a', 700, { status: 'submitted' })], []);
    expect(r.billed).toBe(0);
    expect(r.pending).toBe(700);
  });

  it('holds the full budget in the forecast until the line is bought out', () => {
    const lines = [line('open', 10000), line('bought', 10000, { bought_out: true })];
    const r = rollupLines(lines, [po('p1', 'open', 6000), po('p2', 'bought', 6000)], [], []);
    expect(r.find((x) => x.line.id === 'open')!.forecast).toBe(10000);
    expect(r.find((x) => x.line.id === 'bought')!.forecast).toBe(6000);
  });

  it('adds approved PO change orders to the PO total', () => {
    const [r] = rollupLines([line('a', 10000)], [po('p', 'a', 8000, { approved_co_cents: 500 })], [], [co('a', 500, 900)]);
    expect(r.committed).toBe(8500);
    expect(r.revised).toBe(10500);
  });
});

describe('job rollup', () => {
  const job: Job = { id: 'j', name: 'J', address: '', job_type: 'client', status: 'active', sale_price_cents: 100000, loan_amount_cents: 50000, lender: '', start_date: null, target_finish: null, notes: '' };
  it('adds client change order price to the sale price and works out margin', () => {
    const r = rollupJob(job, [line('a', 60000)], [], [], [co('a', 5000, 9000)], [], []);
    expect(r.salePrice).toBe(109000);
    expect(r.forecast).toBe(65000);
    expect(r.forecastMargin).toBe(44000);
  });
  it('tracks loan left and out-of-pocket from funded draws, not requested', () => {
    const draws: Draw[] = [
      { id: 'd1', job_id: 'j', number: 1, status: 'funded', requested_date: null, funded_date: null, funded_cents: 9000, notes: '' },
      { id: 'd2', job_id: 'j', number: 2, status: 'requested', requested_date: null, funded_date: null, funded_cents: 0, notes: '' },
    ];
    const dl: DrawLine[] = [
      { id: 'x', draw_id: 'd1', budget_line_id: 'a', amount_cents: 10000 },
      { id: 'y', draw_id: 'd2', budget_line_id: 'a', amount_cents: 2000 },
    ];
    const r = rollupJob(job, [line('a', 60000)], [], [bill('b', 'a', 12000, { status: 'paid' })], [], draws, dl);
    expect(r.drawnRequested).toBe(12000);
    expect(r.drawnFunded).toBe(9000);
    expect(r.loanLeft).toBe(41000);
    expect(r.outOfPocket).toBe(3000);
  });
});

describe('draw sheet', () => {
  const lines = [line('a', 10000)];
  const rolls = rollupLines(lines, [], [], []);
  const mk = (id: string, number: number, status: Draw['status']): Draw =>
    ({ id, job_id: 'j', number, status, requested_date: null, funded_date: null, funded_cents: 0, notes: '' });
  const draws = [mk('d1', 1, 'funded'), mk('dd', 2, 'draft'), mk('d3', 3, 'draft')];
  const dl: DrawLine[] = [
    { id: '1', draw_id: 'd1', budget_line_id: 'a', amount_cents: 7000 },
    { id: '2', draw_id: 'dd', budget_line_id: 'a', amount_cents: 500 },
    { id: '3', draw_id: 'd3', budget_line_id: 'a', amount_cents: 4000 },
  ];
  it('shows prior draws, skips other drafts, and flags overdrawing', () => {
    const [row] = drawSheet(draws[2], lines, rolls, draws, dl);
    expect(row.prior).toBe(7000);
    expect(row.thisDraw).toBe(4000);
    expect(row.balance).toBe(-1000);
    expect(row.overdrawn).toBe(true);
  });
});

describe('payment gate', () => {
  const vendor = (coi: string | null): Vendor =>
    ({ id: 'v', name: 'V', trade: '', coi_expires: coi, w9_on_file: true, notes: '' });
  const w = (status: Waiver['status'], bill_id = 'b'): Waiver =>
    ({ id: 'w', job_id: 'j', vendor_id: 'v', bill_id, kind: 'conditional_progress', amount_cents: 1, through_date: null, status, file_path: null });

  it('clears when insurance is current and a waiver is in', () => {
    expect(payBlockers(vendor('2026-12-01'), [w('received')], 'b', '2026-11-01')).toEqual([]);
  });
  it('allows payment on the day insurance expires', () => {
    expect(payBlockers(vendor('2026-11-01'), [w('received')], 'b', '2026-11-01')).toEqual([]);
  });
  it('blocks expired insurance, missing insurance, and missing waivers', () => {
    expect(payBlockers(vendor('2026-10-31'), [w('received')], 'b', '2026-11-01')).toEqual(['insurance expired 2026-10-31']);
    expect(payBlockers(vendor(null), [w('received')], 'b', '2026-11-01')).toEqual(['no insurance certificate on file']);
    expect(payBlockers(vendor('2026-12-01'), [w('requested')], 'b', '2026-11-01')).toEqual(['no lien waiver received']);
  });
  it("won't accept another bill's waiver", () => {
    expect(payBlockers(vendor('2026-12-01'), [w('received', 'other')], 'b', '2026-11-01')).toEqual(['no lien waiver received']);
  });
  it('limits bill moves', () => {
    expect(canMoveBill('submitted', 'paid', true)).toBe(false);
    expect(canMoveBill('paid', 'approved', false)).toBe(false);
    expect(canMoveBill('paid', 'approved', true)).toBe(true);
  });
  it('picks the right follow-up waiver', () => {
    const cond = (kind: Waiver['kind']): Waiver => ({ ...w('received'), kind });
    expect(followUpWaiverKind([cond('conditional_progress')])).toBe('unconditional_progress');
    expect(followUpWaiverKind([cond('conditional_final')])).toBe('unconditional_final');
    expect(followUpWaiverKind([cond('unconditional_progress')])).toBeNull();
  });
  it('flags insurance by date', () => {
    expect(coiFlag(vendor('2026-11-20'), '2026-11-08')?.severity).toBe('watch');
    expect(coiFlag(vendor('2026-11-01'), '2026-11-08')?.severity).toBe('stop');
    expect(coiFlag(vendor('2027-06-01'), '2026-11-08')).toBeNull();
  });
});

describe('schedule', () => {
  const t = (id: string, s: string, e: string, dep: string | null = null, status: Task['status'] = 'todo'): Task =>
    ({ id, job_id: 'j', vendor_id: null, name: id, start_date: s, end_date: e, depends_on: dep, status, notes: '', sort: 0, contact_status: 'not_contacted' });

  it('pushes the chain out and keeps task lengths', () => {
    const tasks = [t('a', '2026-01-01', '2026-01-05'), t('b', '2026-01-06', '2026-01-08', 'a'), t('c', '2026-01-09', '2026-01-09', 'b')];
    const out = cascade(tasks, 'a', '2026-01-01', '2026-01-10');
    expect(out.find((x) => x.id === 'b')).toEqual({ id: 'b', start_date: '2026-01-11', end_date: '2026-01-13' });
    expect(out.find((x) => x.id === 'c')).toEqual({ id: 'c', start_date: '2026-01-14', end_date: '2026-01-14' });
  });
  it('uses up slack before moving anything', () => {
    const tasks = [t('a', '2026-01-01', '2026-01-05'), t('b', '2026-01-20', '2026-01-22', 'a')];
    expect(cascade(tasks, 'a', '2026-01-01', '2026-01-10').map((x) => x.id)).toEqual(['a']);
  });
  it('never pulls later work earlier', () => {
    const tasks = [t('a', '2026-01-01', '2026-01-05'), t('b', '2026-01-06', '2026-01-08', 'a')];
    expect(cascade(tasks, 'a', '2026-01-01', '2026-01-02').map((x) => x.id)).toEqual(['a']);
  });
  it('leaves finished work alone', () => {
    const tasks = [t('a', '2026-01-01', '2026-01-05'), t('b', '2026-01-06', '2026-01-08', 'a', 'done')];
    expect(cascade(tasks, 'a', '2026-01-01', '2026-01-10').map((x) => x.id)).toEqual(['a']);
  });
  it('handles month and year rollover', () => {
    const tasks = [t('a', '2026-12-28', '2026-12-30'), t('b', '2026-12-31', '2027-01-02', 'a')];
    const out = cascade(tasks, 'a', '2026-12-28', '2027-01-01');
    expect(out.find((x) => x.id === 'b')).toEqual({ id: 'b', start_date: '2027-01-02', end_date: '2027-01-04' });
  });
  it('survives a dependency loop', () => {
    const tasks = [t('a', '2026-01-01', '2026-01-05', 'b'), t('b', '2026-01-06', '2026-01-08', 'a')];
    expect(() => cascade(tasks, 'a', '2026-01-01', '2026-01-10')).not.toThrow();
  });
  it('detects loops before they are saved', () => {
    const tasks = [t('a', '2026-01-01', '2026-01-02'), t('b', '2026-01-03', '2026-01-04', 'a'), t('c', '2026-01-05', '2026-01-06', 'b')];
    expect(wouldLoop(tasks, 'a', 'c')).toBe(true);
    expect(wouldLoop(tasks, 'c', 'a')).toBe(false);
  });
});

describe('money and CSV', () => {
  it('parses money without float drift', () => {
    expect(parseMoney('$12,500.50')).toBe(1250050);
    expect(parseMoney('19.99')).toBe(1999);
    expect(parseMoney('1.10')).toBe(110);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney('-250')).toBe(-25000);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1.234')).toBeNull();
    expect(parseMoney('-')).toBeNull();
  });
  it('formats money', () => {
    expect(money(1250000)).toBe('$12,500');
    expect(money(1250050)).toBe('$12,500.50');
    expect(money(-50000)).toBe('-$500');
  });
  it('quotes CSV and stops spreadsheet formula injection', () => {
    expect(toCsv([['a,b', 'c"d', 3]])).toBe('"a,b","c""d",3');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@cmd')).toBe("'@cmd");
  });
});

describe('needs-you list', () => {
  const base: WorkData = { jobs: [], vendors: [], budget_lines: [], pos: [], bills: [], change_orders: [], draws: [], lien_waivers: [], tasks: [] };
  const job: Job = { id: 'j', name: 'J', address: '', job_type: 'spec', status: 'active', sale_price_cents: 0, loan_amount_cents: 0, lender: '', start_date: null, target_finish: null, notes: '' };
  const late: Task = { id: 't', job_id: 'j', vendor_id: null, name: 'Frame', start_date: '2026-01-01', end_date: '2026-01-02', depends_on: null, status: 'todo', notes: '', sort: 0, contact_status: 'not_contacted' };
  it('puts stops first and ignores closed jobs', () => {
    const d = { ...base, jobs: [job], tasks: [late], bills: [bill('b', 'a', 100, { status: 'submitted' })] };
    const out = attention(d, '2026-02-01', money);
    expect(out[0].severity).toBe('stop');
    expect(out[1].severity).toBe('act');
    expect(attention({ ...d, jobs: [{ ...job, status: 'closed' }] }, '2026-02-01', money)).toEqual([]);
  });
  it("flags insurance only for subs with live work", () => {
    const v: Vendor = { id: 'v', name: 'V', trade: '', coi_expires: '2026-01-01', w9_on_file: true, notes: '' };
    expect(attention({ ...base, vendors: [v] }, '2026-02-01', money)).toEqual([]);
    expect(attention({ ...base, vendors: [v], pos: [po('p', 'a', 1)] }, '2026-02-01', money)[0].severity).toBe('stop');
  });
});

describe('schedule with finished work in the chain', () => {
  const t = (id: string, s: string, e: string, dep: string | null, status: Task['status'] = 'todo'): Task =>
    ({ id, job_id: 'j', vendor_id: null, name: id, start_date: s, end_date: e, depends_on: dep, status, notes: '', sort: 0, contact_status: 'not_contacted' });
  it('does not move work that follows an already finished task', () => {
    const tasks = [t('a', '2026-01-01', '2026-01-05', null), t('b', '2026-01-06', '2026-01-08', 'a', 'done'), t('c', '2026-01-09', '2026-01-10', 'b')];
    expect(cascade(tasks, 'a', '2026-01-01', '2026-01-20').map((x) => x.id)).toEqual(['a']);
  });
});

describe('job search', () => {
  const j = (id: string, name: string, extra: Partial<Job> = {}): Job =>
    ({ id, name, address: '', job_type: 'spec', status: 'closed', sale_price_cents: 0, loan_amount_cents: 0, lender: '', start_date: null, target_finish: null, notes: '', ...extra });
  const v = (id: string, name: string, trade = ''): Vendor =>
    ({ id, name, trade, coi_expires: null, w9_on_file: false, notes: '' });
  const sel = (job_id: string, color_name: string, color_code: string, room = 'Kitchen', vendor_id: string | null = null) =>
    ({ id: `${job_id}${color_code}`, job_id, category: 'Paint', room, item: 'Walls', brand: 'Sherwin-Williams', color_name, color_code, finish: '', supplier: '', vendor_id, notes: '', file_path: null });
  const base: SearchData = {
    jobs: [j('a', 'Birch Ln', { finish_date: '2024-09-01', client_name: 'Jane Client', square_feet: 1850 }), j('b', 'Oak Ridge', { finish_date: '2026-01-01', job_type: 'client' })],
    vendors: [v('f', 'Acme Framing', 'Framing'), v('p', 'Pat Plumbing', 'Plumbing')],
    budget_lines: [], pos: [], bills: [], change_orders: [], lien_waivers: [], tasks: [], daily_logs: [], photos: [],
    selections: [sel('a', 'Alabaster', 'SW-7008'), sel('b', 'Agreeable Gray', 'SW-7029', 'Bedroom')],
    documents: [{ id: 'd', job_id: 'a', category: 'Drawings', title: 'Foundation plan', file_path: 'a/f.pdf', file_name: 'f.pdf', revision: 'B', doc_date: null, notes: '' }],
    job_steps: [
      { id: 's1', job_id: 'a', step: 'Framing', vendor_id: 'f', other_name: '', start_date: null, end_date: null, cost_cents: 5000000, notes: 'Clean work' },
      { id: 's2', job_id: 'b', step: 'Painting', vendor_id: null, other_name: 'Old Crew', start_date: null, end_date: null, cost_cents: null, notes: '' },
    ],
  };
  const jobs = (q: string, o = {}) => search(base, q, o).map((h) => h.job.id);
  const kinds = (q: string) => search(base, q).flatMap((h) => h.records.map((r) => r.kind));

  it('finds a color by name on the right job', () => {
    expect(jobs('alabaster')).toEqual(['a']);
    expect(kinds('alabaster')).toContain('selection');
  });
  it('matches paint codes however they are typed', () => {
    for (const q of ['SW-7008', 'sw 7008', 'sw7008', '7008']) expect(jobs(q), q).toEqual(['a']);
  });
  it('ignores case', () => expect(jobs('ALABASTER')).toEqual(['a']));
  it('finds drawings by title and file name', () => {
    expect(kinds('foundation plan')).toContain('document');
    expect(search(base, 'foundation')[0].records[0].filePath).toBe('a/f.pdf');
  });
  it('finds who did the work, including someone not in the sub list', () => {
    expect(jobs('acme')).toEqual(['a']);
    expect(jobs('old crew')).toEqual(['b']);
  });
  it('needs every word, but they can span the record and its job', () => {
    expect(jobs('birch alabaster')).toEqual(['a']);
    expect(jobs('oak alabaster')).toEqual([]);
    expect(jobs('alabaster bedroom')).toEqual([]);
  });
  it('lists the job without every record when only the job matched', () => {
    const [hit] = search(base, 'birch');
    expect(hit.jobMatched).toBe(true);
    expect(hit.records).toEqual([]);
  });
  it('finds job facts', () => {
    expect(jobs('jane')).toEqual(['a']);
    expect(jobs('1850')).toEqual(['a']);
    expect(jobs('2024')).toEqual(['a']);
  });
  it('filters by year, type, kind, and sub', () => {
    expect(jobs('', { year: '2026' })).toEqual(['b']);
    expect(jobs('', { jobType: 'client' })).toEqual(['b']);
    expect(jobs('', { vendorId: 'f' })).toEqual(['a']);
    expect(jobs('framing', { kind: 'selection' })).toEqual([]);
    expect(jobs('sherwin', { kind: 'selection' }).sort()).toEqual(['a', 'b']);
  });
  it('lists every job when the box is empty, newest first', () => {
    expect(jobs('')).toEqual(['b', 'a']);
  });
  it('treats regex characters in a search as plain text', () => {
    expect(() => search(base, '(.*[')).not.toThrow();
    expect(highlightParts('Alabaster (SW)', '(SW)').find((p) => p.hit)?.text).toBe('(SW)');
  });
  it('marks every matching word', () => {
    expect(highlightParts('Tricorn Black', 'black').filter((p) => p.hit).map((p) => p.text)).toEqual(['Black']);
  });
});

describe('who did each step', () => {
  const job: Job = { id: 'j', name: 'J', address: '', job_type: 'spec', status: 'active', sale_price_cents: 0, loan_amount_cents: 0, lender: '', start_date: null, target_finish: null, notes: '' };
  const v: Vendor = { id: 'v', name: 'Acme', trade: '', coi_expires: null, w9_on_file: false, notes: '' };
  const task = (id: string, s: string, e: string): Task => ({ id, job_id: 'j', vendor_id: 'v', name: id, start_date: s, end_date: e, depends_on: null, status: 'done', notes: '', sort: 0, contact_status: 'not_contacted' });
  it('builds one row from the PO, bill, and task', () => {
    const rows = stepsFor(job, [line('a', 100)], [po('p', 'a', 8000)], [bill('b', 'a', 3000, { status: 'paid' })], [task('t', '2026-01-01', '2026-01-05')], [], [v]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ step: 'a', who: 'Acme', amount: 3000, start: '2026-01-01', end: '2026-01-05' });
  });
  it('shows the agreed amount until something is paid', () => {
    expect(stepsFor(job, [line('a', 100)], [po('p', 'a', 8000)], [], [], [], [v])[0].amount).toBe(8000);
  });
  it('skips draft POs and rejected bills', () => {
    const rows = stepsFor(job, [line('a', 100)], [po('p', 'a', 8000, { status: 'draft' })], [bill('b', 'a', 1, { status: 'rejected' })], [], [], [v]);
    expect(rows).toEqual([]);
  });
  it('lists tasks on their own when a sub did several lines', () => {
    const rows = stepsFor(job, [line('a', 1), line('c', 1)], [po('p', 'a', 1), po('q', 'c', 1)], [], [task('t', '2026-01-01', '2026-01-02')], [], [v]);
    expect(rows.map((r) => r.step).sort()).toEqual(['a', 'c', 't']);
  });
  it('includes hand-entered steps, by name when not in the sub list, in date order', () => {
    const steps: JobStep[] = [
      { id: '2', job_id: 'j', step: 'Paint', vendor_id: null, other_name: 'Old Crew', start_date: '2024-07-01', end_date: null, cost_cents: null, notes: '' },
      { id: '1', job_id: 'j', step: 'Frame', vendor_id: 'v', other_name: '', start_date: '2024-04-01', end_date: null, cost_cents: 5, notes: '' },
    ];
    const rows = stepsFor(job, [], [], [], [], steps, [v]);
    expect(rows.map((r) => [r.step, r.who])).toEqual([['Frame', 'Acme'], ['Paint', 'Old Crew']]);
  });
});

describe('schedule status', () => {
  const t = (id: string, s: string, e: string, status: Task['status'] = 'todo'): Task =>
    ({ id, job_id: 'j', vendor_id: null, name: id, start_date: s, end_date: e, depends_on: null, status, notes: '', sort: 0, contact_status: 'not_contacted' });
  const job = (target_finish: string | null = null) => ({ target_finish });
  it('says no schedule when there are no tasks', () => {
    expect(scheduleHealth(job(), [], '2026-01-10').state).toBe('none');
  });
  it('is on schedule when open work is in the future', () => {
    const h = scheduleHealth(job('2026-03-01'), [t('a', '2026-01-01', '2026-01-05', 'done'), t('b', '2026-01-20', '2026-01-25')], '2026-01-10');
    expect(h.state).toBe('on');
    expect(h.label).toBe('On schedule');
  });
  it('is behind when work is past its finish date', () => {
    const h = scheduleHealth(job(), [t('a', '2026-01-01', '2026-01-05', 'in_progress')], '2026-01-08');
    expect(h.state).toBe('behind');
    expect(h.daysBehind).toBe(3);
    expect(h.label).toBe('3 days behind');
    expect(h.lateTasks.map((x) => x.id)).toEqual(['a']);
  });
  it("is behind when work should have started and hasn't", () => {
    expect(scheduleHealth(job(), [t('a', '2026-01-05', '2026-01-20')], '2026-01-08').daysBehind).toBe(3);
  });
  it('is fine when work started on time and is under way', () => {
    expect(scheduleHealth(job(), [t('a', '2026-01-05', '2026-01-20', 'in_progress')], '2026-01-08').state).toBe('on');
  });
  it('pushes the projected finish out by the worst delay', () => {
    const h = scheduleHealth(job('2026-02-01'), [t('a', '2026-01-01', '2026-01-05', 'in_progress'), t('b', '2026-01-25', '2026-02-01')], '2026-01-15');
    expect(h.daysBehind).toBe(10);
    expect(h.projectedFinish).toBe('2026-02-11');
    expect(h.overTarget).toBe(10);
  });
  it('is behind when the plan already runs past the target', () => {
    const h = scheduleHealth(job('2026-01-20'), [t('a', '2026-02-01', '2026-02-05')], '2026-01-10');
    expect(h.state).toBe('behind');
    expect(h.overTarget).toBe(16);
  });
  it('says complete when every task is done, and ignores done work for delay', () => {
    expect(scheduleHealth(job(), [t('a', '2026-01-01', '2026-01-05', 'done')], '2026-06-01').state).toBe('done');
    expect(scheduleHealth(job(), [t('a', '2026-01-01', '2026-01-05', 'done'), t('b', '2026-07-01', '2026-07-02')], '2026-06-01').state).toBe('on');
  });
});

describe('contractor call list', () => {
  const t = (id: string, start: string, extra: Partial<Task> = {}): Task =>
    ({ id, job_id: 'j', vendor_id: 'v', name: id, start_date: start, end_date: start, depends_on: null, status: 'todo', notes: '', sort: 0, contact_status: 'not_contacted', ...extra });
  it('lists unconfirmed subs due soon, soonest first', () => {
    const rows = callList([t('later', '2026-01-20'), t('soon', '2026-01-12')], '2026-01-10');
    expect(rows.map((r) => r.id)).toEqual(['soon', 'later']);
  });
  it('keeps contacted subs on the list until they confirm', () => {
    expect(callList([t('a', '2026-01-12', { contact_status: 'contacted' })], '2026-01-10')).toHaveLength(1);
    expect(callList([t('a', '2026-01-12', { contact_status: 'confirmed' })], '2026-01-10')).toHaveLength(0);
  });
  it('skips far-off work, tasks with no sub, and work under way', () => {
    expect(callList([t('far', '2026-03-01'), t('nosub', '2026-01-12', { vendor_id: null }), t('going', '2026-01-12', { status: 'in_progress' })], '2026-01-10')).toEqual([]);
  });
  it('still lists a sub who was due in the past and never confirmed', () => {
    expect(callList([t('a', '2026-01-02')], '2026-01-10')).toHaveLength(1);
  });
  it('puts it on the needs-you list, urgent inside three days', () => {
    const job: Job = { id: 'j', name: 'J', address: '', job_type: 'spec', status: 'active', sale_price_cents: 0, loan_amount_cents: 0, lender: '', start_date: null, target_finish: null, notes: '' };
    const v: Vendor = { id: 'v', name: 'Acme', trade: '', coi_expires: '2027-01-01', w9_on_file: true, notes: '' };
    const d: WorkData = { jobs: [job], vendors: [v], budget_lines: [], pos: [], bills: [], change_orders: [], draws: [], lien_waivers: [], tasks: [t('Roof', '2026-01-12')] };
    expect(attention(d, '2026-01-10', money).find((x) => x.label.startsWith('Call Acme'))?.severity).toBe('stop');
    expect(attention({ ...d, tasks: [t('Roof', '2026-01-20')] }, '2026-01-10', money).find((x) => x.label.startsWith('Call Acme'))?.severity).toBe('act');
  });
});

describe('materials', () => {
  const m = (status: Material['status'], extra: Partial<Material> = {}): Material =>
    ({ id: 'm', job_id: 'j', name: 'Windows', quantity: '', supplier: '', order_number: '', status, needed_by: null, ordered_date: null, expected_date: null, arrived_date: null, cost_cents: null, notes: '', ...extra });
  it('flags late deliveries, not on-time or arrived ones', () => {
    expect(materialLate(m('ordered', { expected_date: '2026-01-09' }), '2026-01-10')).toBe(true);
    expect(materialLate(m('ordered', { expected_date: '2026-01-10' }), '2026-01-10')).toBe(false);
    expect(materialLate(m('arrived', { expected_date: '2026-01-09' }), '2026-01-10')).toBe(false);
    expect(materialLate(m('ordered'), '2026-01-10')).toBe(false);
  });
  it('flags items to order when the need-by date is close', () => {
    expect(needsOrdering(m('needed', { needed_by: '2026-01-15' }), '2026-01-10')).toBe(true);
    expect(needsOrdering(m('needed', { needed_by: '2026-03-01' }), '2026-01-10')).toBe(false);
    expect(needsOrdering(m('ordered', { needed_by: '2026-01-15' }), '2026-01-10')).toBe(false);
  });
  it('totals what has been ordered, leaving out items not ordered yet', () => {
    const s = summarizeMaterials([m('needed', { cost_cents: 500 }), m('ordered', { cost_cents: 100, expected_date: '2026-01-01' }), m('arrived', { cost_cents: 200 })], '2026-01-10');
    expect(s).toEqual({ needed: 1, ordered: 1, arrived: 1, late: 1, orderedCost: 300 });
  });
  it('reads a pasted list, with a leading number as quantity', () => {
    expect(parseMaterialLines('120 2x4x8 studs\n\n  Joist hangers \n3 x exterior doors')).toEqual([
      { quantity: '120', name: '2x4x8 studs' },
      { quantity: '', name: 'Joist hangers' },
      { quantity: '3', name: 'exterior doors' },
    ]);
  });
  it('shows up on the needs-you list and in search', () => {
    const job: Job = { id: 'j', name: 'J', address: '', job_type: 'spec', status: 'active', sale_price_cents: 0, loan_amount_cents: 0, lender: '', start_date: null, target_finish: null, notes: '' };
    const d: WorkData = { jobs: [job], vendors: [], budget_lines: [], pos: [], bills: [], change_orders: [], draws: [], lien_waivers: [], tasks: [], materials: [m('ordered', { expected_date: '2026-01-01' })] };
    expect(attention(d, '2026-01-10', money)[0].label).toContain('Windows was due');
    const asked = attention({ ...d, materials: [m('needed', { name: 'Trim', quantity: '40 ft', requested_by_name: 'Jordan' })] }, '2026-01-10', money);
    expect(asked[0]).toMatchObject({ severity: 'act', label: 'Jordan asked for 40 ft Trim' });
    expect(attention({ ...d, materials: [m('needed', { name: 'Trim', requested_by_name: 'Jordan', needed_by: '2026-01-11' })] }, '2026-01-10', money)[0].severity).toBe('stop');
    expect(attention({ ...d, materials: [m('arrived', { name: 'Trim', requested_by_name: 'Jordan' })] }, '2026-01-10', money)).toEqual([]);
    const found = search({ jobs: [job], vendors: [], budget_lines: [], pos: [], bills: [], change_orders: [], lien_waivers: [], tasks: [], daily_logs: [], photos: [], selections: [], documents: [], job_steps: [], materials: [m('needed')], scope_items: [{ id: 's', job_id: 'j', title: 'Large back porch', location: '', details: '', status: 'todo', sort: 0 }] }, 'windows');
    expect(found[0].records[0].kind).toBe('material');
  });
});

describe('contractor messages', () => {
  it('normalizes US phone numbers and refuses bad ones', () => {
    expect(phoneDigits('(937) 555-0100')).toBe('+19375550100');
    expect(phoneDigits('1-937-555-0100')).toBe('+19375550100');
    expect(phoneDigits('555-0100')).toBe('');
    expect(phoneDigits('')).toBe('');
  });
  it('writes a message with the work, place, dates, and sender', () => {
    const msg = taskMessage({ firstName: 'Pat', task: { name: 'Rough plumbing', start_date: '2026-11-14', end_date: '2026-11-18' }, job: { name: 'Oak', address: '100 Ridge Rd' }, sender: 'Ryan' });
    expect(msg).toBe("Hi Pat, this is Ryan. You're scheduled for Rough plumbing at 100 Ridge Rd, Sat, Nov 14 to Wed, Nov 18. Can you confirm you'll be there?");
  });
  it('uses one date for a one-day task, and the job name with no address', () => {
    const msg = taskMessage({ firstName: '', task: { name: 'Inspect', start_date: '2026-11-14', end_date: '2026-11-14' }, job: { name: 'Oak', address: '' }, sender: 'Ryan' });
    expect(msg).toBe("Hi, this is Ryan. You're scheduled for Inspect at Oak, Sat, Nov 14. Can you confirm you'll be there?");
  });
  it('keeps special characters from breaking the links', () => {
    expect(smsLink('9375550100', 'A & B? #1')).toBe('sms:+19375550100?&body=A%20%26%20B%3F%20%231');
    expect(emailLink('a@b.com', 'Hi & bye', 'x=1')).toBe('mailto:a@b.com?subject=Hi%20%26%20bye&body=x%3D1');
  });
});

describe('private contacts in search and lookups', () => {
  const c = (id: string, vendor_id: string, extra: Partial<VendorContact> = {}): VendorContact =>
    ({ id, vendor_id, name: '', title: '', mobile: '', office_phone: '', email: '', address: '', notes: '', is_primary: false, ...extra });
  it('picks the main contact, then anyone reachable', () => {
    expect(primaryContact([c('a', 'v', { mobile: '1' }), c('b', 'v', { is_primary: true })], 'v')?.id).toBe('b');
    expect(primaryContact([c('a', 'v'), c('b', 'v', { email: 'x@y.z' })], 'v')?.id).toBe('b');
    expect(primaryContact([c('a', 'other')], 'v')).toBeUndefined();
  });
  it('prefers mobile over office', () => {
    expect(bestPhone({ mobile: '1', office_phone: '2' })).toBe('1');
    expect(bestPhone({ mobile: '', office_phone: '2' })).toBe('2');
    expect(bestPhone(undefined)).toBe('');
  });
  it('finds a job by contact phone only when contacts are loaded', () => {
    const job: Job = { id: 'j', name: 'J', address: '', job_type: 'spec', status: 'active', sale_price_cents: 0, loan_amount_cents: 0, lender: '', start_date: null, target_finish: null, notes: '' };
    const v: Vendor = { id: 'v', name: 'Acme', trade: '', coi_expires: null, w9_on_file: false, notes: '' };
    const base: SearchData = { jobs: [job], vendors: [v], budget_lines: [], pos: [], bills: [], change_orders: [], lien_waivers: [], tasks: [], daily_logs: [], photos: [], selections: [], documents: [], job_steps: [{ id: 's', job_id: 'j', step: 'Frame', vendor_id: 'v', other_name: '', start_date: null, end_date: null, cost_cents: null, notes: '' }] };
    expect(search({ ...base, vendor_contacts: [c('a', 'v', { mobile: '937-555-0100' })] }, '9375550100')).toHaveLength(1);
    expect(search(base, '9375550100')).toEqual([]);
  });
});

describe('photo review', () => {
  const job: Job = { id: 'j', name: 'J', address: '', job_type: 'spec', status: 'active', sale_price_cents: 0, loan_amount_cents: 0, lender: '', start_date: null, target_finish: null, notes: '' };
  const v: Vendor = { id: 'v', name: 'Acme', trade: '', coi_expires: '2030-01-01', w9_on_file: true, notes: '' };
  const ph = (id: string, review_status: Photo['review_status']): Photo =>
    ({ id, job_id: 'j', vendor_id: 'v', task_id: null, file_path: 'x.jpg', caption: `Cap ${id}`, review_status, review_note: '' });
  const d: WorkData = { jobs: [job], vendors: [v], budget_lines: [], pos: [], bills: [], change_orders: [], draws: [], lien_waivers: [], tasks: [] };
  it('asks for review, grouped by contractor, ignoring reviewed photos', () => {
    const out = attention({ ...d, photos: [ph('a', 'pending'), ph('b', 'pending'), ph('c', 'approved'), ph('e', 'rejected')] }, '2026-01-10', money);
    expect(out.map((x) => x.label)).toEqual(['Review 2 photos from Acme']);
    expect(out[0].tab).toBe('log');
  });
  it('leaves disapproved photos out of search', () => {
    const base: SearchData = { jobs: [job], vendors: [v], budget_lines: [], pos: [], bills: [], change_orders: [], lien_waivers: [], tasks: [], daily_logs: [], selections: [], documents: [], job_steps: [], photos: [ph('good', 'approved'), ph('bad', 'rejected')] };
    expect(search(base, 'cap good')).toHaveLength(1);
    expect(search(base, 'cap bad')).toEqual([]);
  });
});
