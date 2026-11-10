// Sample data for demo mode only. Dates are relative to today so the demo always has live flags.
import { todayIso } from '../domain/rules';
import { addDays } from '../domain/schedule';
import { starterBudget, starterSchedule } from '../domain/templates';
import type { Tables } from '../domain/types';

export type DB = { [K in keyof Tables]: Tables[K][] };

const AMOUNTS: Record<string, number> = {
  '01': 60000, '02': 6000, '03': 9000, '04': 14000, '05': 12000, '06': 32000, '07': 62000, '08': 14000, '09': 18000,
  '10': 22000, '11': 19000, '12': 18000, '13': 21000, '14': 7000, '15': 16000, '16': 14000, '17': 24000, '18': 11000,
  '19': 18000, '20': 13000, '21': 15000, '22': 3000, '23': 1000, '24': 16000, '25': 15000,
};

export function seed(): DB {
  const today = todayIso();
  const d = (n: number) => addDays(today, n);
  const db: DB = {
    vendors: [], profiles: [], team_invites: [], jobs: [], budget_lines: [], pos: [], bills: [], change_orders: [],
    draws: [], draw_lines: [], lien_waivers: [], tasks: [], daily_logs: [], photos: [], selections: [], documents: [], job_steps: [], scope_items: [], materials: [], notifications: [], vendor_contacts: [], auto_texts: [],
    auto_text_settings: [{ id: 'main', enabled: false, sender_name: 'H3 Office', notice_days: 7, reminder_days: 1, start_hour: 9, end_hour: 18, daily_cap: 25 }],
  };
  const vendor = (id: string, name: string, trade: string, contact_name: string, coi: string | null) => {
    db.vendors.push({ id, name, trade, coi_expires: coi, w9_on_file: true, notes: '' });
    db.vendor_contacts.push({ id: `c-${id}`, vendor_id: id, name: contact_name, title: 'Owner', mobile: '937-555-0100', office_phone: '', email: `${id}@example.com`, address: '', notes: '', is_primary: true, auto_text_ok: id === 'framing' });
  };
  vendor('framing', 'Sample Framing Co', 'Framing', 'Sam', d(120));
  vendor('plumbing', 'Sample Plumbing', 'Plumbing', 'Pat', d(14));
  vendor('electric', 'Sample Electric', 'Electrical', 'Lee', d(-5));
  vendor('concrete', 'Sample Concrete', 'Foundation', 'Dana', d(200));
  vendor('hvac', 'Sample HVAC', 'HVAC', 'Alex', null);

  db.profiles.push(
    { id: 'demo-admin', email: 'owner@example.com', name: 'Owner', role: 'admin', vendor_id: null },
    { id: 'demo-sub', email: 'sam@example.com', name: 'Sam (Sample Framing)', role: 'sub', vendor_id: 'framing' },
    { id: 'demo-office', email: 'casey@example.com', name: 'Casey', role: 'staff', vendor_id: null, phone: '', can_view_contacts: true },
    { id: 'demo-staff', email: 'morgan@example.com', name: 'Morgan', role: 'staff', vendor_id: null, phone: '' },
    { id: 'demo-crew', email: 'jordan@example.com', name: 'Jordan', role: 'crew', vendor_id: null, phone: '937-555-0177' },
  );

  const job = (id: string, name: string, address: string, job_type: Tables['jobs']['job_type'], status: Tables['jobs']['status'], sale: number, loan: number, start: string, finish: string) =>
    db.jobs.push({ id, name, address, job_type, status, sale_price_cents: sale * 100, loan_amount_cents: loan * 100, lender: 'Sample Lender', start_date: start, target_finish: finish, notes: '' });
  job('oak', 'Oak Ridge spec', '100 Sample Ridge Rd', 'spec', 'active', 485000, 300000, d(-50), d(110));
  job('maple', 'Maple Ct custom', '22 Sample Ct', 'client', 'active', 540000, 0, d(-25), d(130));
  job('cedar', 'Cedar Lot 4', 'Lot 4, Sample Dr', 'spec', 'planning', 450000, 280000, d(21), d(200));

  const lineId: Record<string, Record<string, string>> = {};
  for (const j of db.jobs) {
    const lines = starterBudget(j.id).map((l) => ({ ...l, budget_cents: AMOUNTS[l.code] * 100 }));
    db.budget_lines.push(...lines);
    lineId[j.id] = Object.fromEntries(lines.map((l) => [l.code, l.id]));
    db.tasks.push(...starterSchedule(j.id, j.start_date!));
  }

  // Oak Ridge: work through framing, one late task, and a line running over.
  const oakTasks = db.tasks.filter((t) => t.job_id === 'oak');
  oakTasks.forEach((t) => {
    if (t.end_date < d(-8)) t.status = 'done';
    if (t.name === 'Frame house') { t.vendor_id = 'framing'; t.status = 'in_progress'; }
    if (t.name === 'Rough plumbing') t.vendor_id = 'plumbing';
    if (t.name === 'Rough electrical') t.vendor_id = 'electric';
  });
  db.tasks.filter((t) => t.job_id === 'maple').forEach((t) => {
    if (t.end_date < today) t.status = 'done';
    if (t.name === 'Frame house') t.vendor_id = 'framing';
  });

  const po = (id: string, job_id: string, vendor_id: string, code: string, number: number, description: string, dollars: number, status: Tables['pos']['status']) =>
    db.pos.push({ id, job_id, vendor_id, budget_line_id: lineId[job_id][code], number, description, amount_cents: dollars * 100, approved_co_cents: 0, status });
  po('oak-found', 'oak', 'concrete', '06', 1, 'Footers, walls, and slab', 31500, 'closed');
  po('oak-frame', 'oak', 'framing', '07', 2, 'Frame house, labor and material', 67500, 'accepted');
  po('oak-plumb', 'oak', 'plumbing', '10', 3, 'Rough and finish plumbing', 21000, 'accepted');
  po('oak-elec', 'oak', 'electric', '12', 4, 'Rough and finish electrical', 17500, 'sent');
  po('maple-found', 'maple', 'concrete', '06', 1, 'Footers and foundation walls', 33000, 'accepted');
  po('maple-frame', 'maple', 'framing', '07', 2, 'Frame house', 61000, 'sent');

  const bill = (id: string, job_id: string, vendor_id: string, po_id: string, code: string, invoice_no: string, dollars: number, status: Tables['bills']['status'], days: number) =>
    db.bills.push({ id, job_id, vendor_id, po_id, budget_line_id: lineId[job_id][code], invoice_no, amount_cents: dollars * 100, bill_date: d(days), status, notes: '', file_path: null, paid_date: status === 'paid' ? d(days + 5) : null, override_reason: null });
  bill('b1', 'oak', 'concrete', 'oak-found', '06', '1041', 31500, 'paid', -20);
  bill('b2', 'oak', 'framing', 'oak-frame', '07', 'F-210', 30000, 'paid', -10);
  bill('b3', 'oak', 'framing', 'oak-frame', '07', 'F-218', 22000, 'approved', -3);
  bill('b4', 'oak', 'plumbing', 'oak-plumb', '10', 'P-77', 8400, 'submitted', -1);
  bill('b5', 'maple', 'concrete', 'maple-found', '06', '1102', 16500, 'approved', -2);

  const waiver = (job_id: string, vendor_id: string, bill_id: string, kind: Tables['lien_waivers']['kind'], dollars: number, status: 'requested' | 'received') =>
    db.lien_waivers.push({ id: crypto.randomUUID(), job_id, vendor_id, bill_id, kind, amount_cents: dollars * 100, through_date: d(-3), status, file_path: null });
  waiver('oak', 'concrete', 'b1', 'conditional_progress', 31500, 'received');
  waiver('oak', 'concrete', 'b1', 'unconditional_progress', 31500, 'received');
  waiver('oak', 'framing', 'b2', 'conditional_progress', 30000, 'received');
  waiver('oak', 'framing', 'b2', 'unconditional_progress', 30000, 'requested');
  waiver('oak', 'framing', 'b3', 'conditional_progress', 22000, 'requested');
  waiver('maple', 'concrete', 'b5', 'conditional_progress', 16500, 'received');

  db.change_orders.push({ id: 'co1', job_id: 'maple', budget_line_id: lineId.maple['17'], po_id: null, number: 1, description: 'Quartz upgrade in kitchen', cost_delta_cents: 480000, price_delta_cents: 750000, status: 'pending' });

  db.draws.push(
    { id: 'draw1', job_id: 'oak', number: 1, status: 'funded', requested_date: d(-14), funded_date: d(-10), funded_cents: 8500000, notes: 'Foundation complete' },
    { id: 'draw2', job_id: 'oak', number: 2, status: 'requested', requested_date: d(-2), funded_date: null, funded_cents: 0, notes: 'Framing 75%' },
  );
  const dl = (draw_id: string, code: string, dollars: number) =>
    db.draw_lines.push({ id: crypto.randomUUID(), draw_id, budget_line_id: lineId.oak[code], amount_cents: dollars * 100 });
  dl('draw1', '01', 40000); dl('draw1', '04', 14000); dl('draw1', '06', 31000);
  dl('draw2', '07', 46000);

  db.daily_logs.push({ id: 'log1', job_id: 'oak', log_date: d(-1), weather: 'Clear, 48°', notes: 'Second-floor walls up. Trusses delivered; crane set for tomorrow.', author: 'Owner' });
  // Running the job: what it needs, who's on it, materials, contractor confirmations.
  const scope = (job_id: string, title: string, location: string, details: string, status: Tables['scope_items']['status'] = 'todo') =>
    db.scope_items.push({ id: crypto.randomUUID(), job_id, title, location, details, status, sort: db.scope_items.length });
  scope('oak', 'Large back porch', 'Rear of house', '16 x 24 covered, tongue-and-groove ceiling', 'in_progress');
  scope('oak', 'Tile', 'Kitchen backsplash, primary bath', 'Subway tile, 1/8 inch joint');
  scope('oak', 'Kitchen cabinets', 'Kitchen', 'White shaker, soft close');
  const oakAll = db.tasks.filter((t) => t.job_id === 'oak');
  const named = (n: string) => oakAll.find((t) => t.name === n)!;
  named('Dry-in and roof').assigned_to = 'demo-crew';
  named('Set windows and doors').assigned_to = 'demo-crew';
  named('Rough plumbing').contact_status = 'contacted';
  const mat = (job_id: string, name: string, quantity: string, supplier: string, status: Tables['materials']['status'], extra: Partial<Tables['materials']> = {}) =>
    db.materials.push({ id: crypto.randomUUID(), job_id, name, quantity, supplier, order_number: '', status, needed_by: null, ordered_date: null, expected_date: null, arrived_date: null, cost_cents: null, notes: '', ...extra });
  mat('oak', 'Roof trusses', '32', 'Sample Truss Co', 'arrived', { ordered_date: d(-30), expected_date: d(-3), arrived_date: d(-2), cost_cents: 1140000, order_number: 'T-4471' });
  mat('oak', 'Exterior doors', '3', 'Sample Building Supply', 'ordered', { ordered_date: d(-12), expected_date: d(-1), cost_cents: 285000, order_number: 'SB-2210' });
  mat('oak', 'Windows', '18', 'Sample Window Co', 'ordered', { ordered_date: d(-20), expected_date: d(4), cost_cents: 960000, order_number: 'W-8830' });
  mat('oak', 'Kitchen cabinets', '1 set', 'Sample Cabinet Co', 'needed', { needed_by: d(5) });
  mat('oak', 'Baseboard trim', '40 ft', '', 'needed', { requested_by: 'demo-crew', requested_by_name: 'Jordan', notes: 'Short on the back bedroom.' });
  mat('oak', 'Backsplash tile', '60 sq ft', '', 'needed', { needed_by: d(45) });

  db.photos.push(
    { id: 'ph1', job_id: 'oak', vendor_id: 'framing', task_id: named('Frame house').id, file_path: 'demo/second-floor-walls.jpg', caption: 'Second-floor walls up', review_status: 'pending', review_note: '' },
    { id: 'ph2', job_id: 'oak', vendor_id: 'concrete', task_id: null, file_path: 'demo/foundation-poured.jpg', caption: 'Foundation poured', review_status: 'approved', review_note: '' },
  );

  // A job finished before this app, entered by hand.
  job('birch', 'Birch Ln ranch', '48 Sample Ln', 'client', 'planning', 398000, 0, '2024-03-11', '2024-10-01');
  const birch = db.jobs.find((j) => j.id === 'birch')!;
  Object.assign(birch, {
    status: 'closed', finish_date: '2024-09-27', client_name: 'Sample Client', client_phone: '937-555-0123', plan_name: 'The Sample Ranch',
    square_feet: 1850, bedrooms: 3, bathrooms: 2, stories: 1, permit_number: 'SAMPLE-24-0312',
    notes: 'Buyer loved the open kitchen. Basement stayed dry through spring rains.',
  });
  const oak = db.jobs.find((j) => j.id === 'oak')!;
  Object.assign(oak, { plan_name: 'The Sample Two-Story', square_feet: 2400, bedrooms: 4, bathrooms: 2.5, stories: 2 });

  job('deck', 'Sample St deck repair', '310 Sample St', 'repair', 'closed', 12500, 0, '2025-06-02', '2025-06-13');
  Object.assign(db.jobs.find((j) => j.id === 'deck')!, { type_note: 'Deck and railing', finish_date: '2025-06-12', client_name: 'Sample Neighbor' });
  const step = (job_id: string, name: string, vendor_id: string | null, other_name: string, start: string, end: string, dollars: number, notes = '') =>
    db.job_steps.push({ id: crypto.randomUUID(), job_id, step: name, vendor_id, other_name, start_date: start, end_date: end, cost_cents: dollars * 100, notes });
  step('deck', 'Rebuilt deck and railing', 'framing', '', '2025-06-02', '2025-06-12', 8400);
  step('birch', 'Foundation', 'concrete', '', '2024-03-25', '2024-04-05', 28500);
  step('birch', 'Framing', 'framing', '', '2024-04-08', '2024-04-26', 51000, 'Clean work, on time.');
  step('birch', 'Plumbing', 'plumbing', '', '2024-05-01', '2024-05-07', 18500);
  step('birch', 'Painting', null, 'Sample Paint Crew', '2024-07-15', '2024-07-22', 9200, 'Not in the sub list anymore.');

  const pick = (job_id: string, category: string, room: string, item: string, brand: string, color_name: string, color_code: string, finish: string, supplier: string, vendor_id: string | null = null, notes = '') =>
    db.selections.push({ id: crypto.randomUUID(), job_id, category, room, item, brand, color_name, color_code, finish, supplier, vendor_id, notes, file_path: null });
  pick('birch', 'Paint', 'Whole house', 'Walls', 'Sherwin-Williams', 'Alabaster', 'SW-7008', 'Eggshell', 'Sherwin-Williams store');
  pick('birch', 'Paint', 'Exterior', 'Front door', 'Sherwin-Williams', 'Tricorn Black', 'SW-6258', 'Satin', 'Sherwin-Williams store');
  pick('birch', 'Countertops', 'Kitchen', 'Island and perimeter', 'Sample Quartz', 'Calacatta Sample', '', 'Polished', 'Sample Stone Yard');
  pick('birch', 'Flooring', 'Main level', 'LVP', 'Sample Floors', 'Weathered Oak', 'WO-220', 'Matte', 'Sample Flooring Supply');
  pick('oak', 'Paint', 'Whole house', 'Walls', 'Sherwin-Williams', 'Agreeable Gray', 'SW-7029', 'Eggshell', 'Sherwin-Williams store');
  pick('oak', 'Siding', 'Exterior', 'Lap siding', 'Sample Siding', 'Iron Sample', '', 'Smooth', 'Sample Building Supply');

  const file = (job_id: string, category: string, title: string, name: string, revision: string, doc_date: string) =>
    db.documents.push({ id: crypto.randomUUID(), job_id, category, title, file_path: `demo/${name}`, file_name: name, revision, doc_date, notes: '' });
  file('birch', 'Drawings', 'Architectural plan set', 'birch-plans.pdf', 'C', '2024-02-20');
  file('birch', 'Drawings', 'Foundation plan', 'birch-foundation.pdf', 'B', '2024-02-20');
  file('birch', 'Permits and inspections', 'Final occupancy certificate', 'birch-occupancy.pdf', '', '2024-09-25');
  file('oak', 'Drawings', 'Architectural plan set', 'oak-plans.pdf', 'A', d(-60));
  return db;
}
