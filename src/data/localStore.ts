// Demo mode. Mirrors the database rules closely enough to try the whole app; real enforcement is in the migration.
import { canMoveBill, followUpWaiverKind, payBlockers, todayIso } from '../domain/rules';
import type { Bill, ChangeOrder, Photo, Profile, TableName, Tables, Waiver } from '../domain/types';
import { seed, type DB } from './seed';
import { rowKey, type Store } from './store';

const KEY = 'build-tracker-demo-v7';
const WHO = 'build-tracker-demo-who';
const NUMBERED = new Set<TableName>(['pos', 'change_orders', 'draws']);
const files = new Map<string, string>();
let listener: () => void = () => {};

function storage(k: string, v?: string): string | null {
  try {
    if (v !== undefined) localStorage.setItem(k, v);
    return localStorage.getItem(k);
  } catch {
    return v ?? null;
  }
}

let memory: DB | null = null;
function load(): DB {
  if (memory) return memory;
  const raw = storage(KEY);
  try {
    memory = raw ? (JSON.parse(raw) as DB) : seed();
  } catch {
    memory = seed();
  }
  return memory;
}
const save = () => storage(KEY, JSON.stringify(memory));
const who = () => storage(WHO) ?? 'demo-admin';
const me = (): Profile => load().profiles.find((p) => p.id === who()) ?? load().profiles[0];

function crewJobs(db: DB, id: string) {
  const open = new Set(db.jobs.filter((j) => j.status !== 'closed').map((j) => j.id));
  return new Set(db.tasks.filter((t) => t.assigned_to === id && open.has(t.job_id)).map((t) => t.job_id));
}

function visible<T extends TableName>(table: T, rows: Tables[T][]): Tables[T][] {
  const p = me();
  if (p.role === 'crew') {
    const db = load();
    const jobs = crewJobs(db, p.id);
    const onJob = (r: unknown) => jobs.has((r as { job_id: string }).job_id);
    switch (table) {
      case 'tasks': case 'scope_items': case 'selections': return rows.filter(onJob);
      case 'documents': return rows.filter((r) => onJob(r) && ['Drawings', 'Engineering', 'Permits and inspections'].includes((r as Tables['documents']).category));
      case 'profiles': return rows.filter((r) => (r as Profile).id === p.id);
      default: return [];
    }
  }
  if (p.role === 'staff') {
    if (['vendor_contacts', 'auto_text_settings', 'auto_texts'].includes(table) && !p.can_view_contacts) return [];
    if (['estimate_markups', 'estimate_versions', 'markup_defaults', 'invoices', 'leads', 'lead_appointments'].includes(table)) return [];
    if (table === 'profiles' && !p.can_view_contacts) return rows.filter((r) => (r as Profile).role !== 'sub');
    return rows;
  }
  if (p.role !== 'sub') return rows;
  const own = (r: unknown) => (r as { vendor_id: string | null }).vendor_id === p.vendor_id;
  switch (table) {
    case 'vendors': return rows.filter((r) => (r as Tables['vendors']).id === p.vendor_id);
    case 'pos': return rows.filter((r) => own(r) && (r as Tables['pos']).status !== 'draft');
    case 'bills': case 'lien_waivers': case 'tasks': case 'photos': return rows.filter(own);
    case 'profiles': return rows.filter((r) => (r as Profile).id === p.id);
    default: return [];
  }
}

function afterBillChange(db: DB, bill: Bill, before?: Bill) {
  const mine = db.lien_waivers.filter((w) => w.bill_id === bill.id);
  const base = { id: crypto.randomUUID(), job_id: bill.job_id, vendor_id: bill.vendor_id, bill_id: bill.id, amount_cents: bill.amount_cents, status: 'requested' as const, file_path: null };
  if (bill.status === 'approved' && before?.status !== 'approved' && !mine.length) {
    db.lien_waivers.push({ ...base, kind: 'conditional_progress', through_date: bill.bill_date });
  }
  if (bill.status === 'paid' && before?.status !== 'paid') {
    const kind = followUpWaiverKind(mine);
    if (kind) db.lien_waivers.push({ ...base, kind, through_date: bill.paid_date });
  }
}

function syncCo(db: DB) {
  for (const p of db.pos) {
    p.approved_co_cents = db.change_orders
      .filter((c: ChangeOrder) => c.po_id === p.id && c.status === 'approved')
      .reduce((s, c) => s + c.cost_delta_cents, 0);
  }
}

function guardBill(db: DB, b: Bill, patch: Partial<Bill>): Partial<Bill> {
  const next = { ...patch };
  const moved = next.status && next.status !== b.status;
  const money = ['amount_cents', 'vendor_id', 'job_id', 'po_id', 'budget_line_id'] as const;
  if (b.status !== 'submitted' && money.some((k) => k in next && next[k] !== b[k])) {
    throw new Error(`This bill is already ${b.status}. Reject it and enter a new one to change the amount or vendor.`);
  }
  if (!moved) return next;
  const admin = me().role === 'admin';
  if (!canMoveBill(b.status, next.status!, admin)) {
    if (b.status === 'paid') throw new Error('Only an admin can undo a payment.');
    throw new Error(`A bill cannot go from ${b.status} to ${next.status}.`);
  }
  if (next.status === 'approved') { next.paid_date = null; next.override_reason = null; }
  if (next.status === 'paid') {
    const date = next.paid_date ?? todayIso();
    next.paid_date = date;
    const blocks = payBlockers(db.vendors.find((v) => v.id === b.vendor_id), db.lien_waivers, b.id, date);
    const reason = next.override_reason?.trim();
    if (blocks.length && (!reason || !admin)) {
      throw new Error(`Cannot pay this bill: ${blocks.join(', ')}. An admin can override with a reason.`);
    }
    next.override_reason = blocks.length ? reason! : null;
  }
  return next;
}

export const localStore: Store = {
  mode: 'local',
  async me() { return me(); },
  onAuthChange(cb) { listener = cb; },
  async signIn() { return ''; },
  async verifyCode() {},
  async signOut() {},
  async list(table) {
    return visible(table, (load()[table] ?? []) as never) as never; // older saved demos lack newer tables
  },
  async insert(table, rows) {
    const db = load();
    for (const raw of Array.isArray(rows) ? rows : [rows]) {
      const row = { id: crypto.randomUUID(), ...(raw as object) } as Record<string, unknown>;
      if (NUMBERED.has(table)) {
        const nums = (db[table] as unknown as { job_id: string; number: number }[])
          .filter((r) => r.job_id === row.job_id).map((r) => r.number);
        row.number = Math.max(0, ...nums) + 1;
      }
      if (table === 'bills') {
        row.status ??= 'submitted'; row.notes ??= ''; row.file_path ??= null; row.paid_date = null; row.override_reason = null;
        row.bill_date ??= todayIso();
        if (me().role === 'sub') {
          const po = db.pos.find((p) => p.id === row.po_id);
          if (!po || po.vendor_id !== me().vendor_id) throw new Error('That work order is not yours.');
          if (po.status !== 'accepted') throw new Error('Accept the work order before billing it.');
          Object.assign(row, { vendor_id: po.vendor_id, job_id: po.job_id, budget_line_id: po.budget_line_id, status: 'submitted' });
        }
      }
      if (table === 'pos') row.approved_co_cents = 0;
      // Demos saved before a table existed don't have it yet.
      (db as Record<string, unknown[]>)[table] ??= [];
      if (table === 'leads') {
        row.created_at ??= new Date().toISOString(); row.updated_at ??= row.created_at;
        for (const k of ['name', 'phone', 'email', 'address', 'county', 'deal_terms', 'source', 'next_step', 'lost_reason', 'notes']) row[k] ??= '';
        row.kind ??= 'custom_home'; row.stage ??= 'new'; row.houses ??= 1; row.log ??= [];
        for (const k of ['profit_per_house_cents', 'next_date', 'job_id', 'estimate_id']) row[k] ??= null;
      }
      if (table === 'lead_appointments') {
        if (!row.appt_date) throw new Error('Pick a date for the appointment.');
        row.appt_time ??= null; row.place ??= ''; row.who ??= ''; row.notes ??= '';
      }
      if (table === 'invoices') {
        row.number ??= Math.max(1000, ...db.invoices.map((i) => i.number)) + 1;
        if (db.invoices.some((i) => i.number === row.number)) throw new Error(`Invoice ${row.number} already exists.`);
        row.lines ??= []; row.paid_cents ??= 0; row.paid_date ??= null; row.terms ??= 'Due on receipt'; row.notes ??= '';
        row.bill_to ??= ''; row.address ??= ''; row.job_id ??= null; row.estimate_id ??= null; row.due_date ??= null;
        row.invoice_date ??= todayIso(); row.created_at ??= new Date().toISOString(); row.kind ??= 'standard';
      }
      if (table === 'estimates') {
        row.number ??= Math.max(1000, ...db.estimates.map((e) => e.number ?? 0)) + 1;
        row.deposit_pct ??= 0;
        const d = db.markup_defaults[0];
        db.estimate_markups.push({ estimate_id: row.id as string, sales_tax_pct: d.sales_tax_pct, contingency_pct: d.contingency_pct, overhead_pct: d.overhead_pct, profit_pct: d.profit_pct, profit_amount: null });
      }
      if (table === 'tasks') row.contact_status ??= 'not_contacted';
      if (table === 'budget_lines') { row.code ??= ''; row.bought_out ??= false; row.budget_cents ??= 0; row.sort ??= 0; }
      if (table === 'photos') {
        row.review_status = me().role === 'sub' ? 'pending' : 'approved';
        row.review_note = '';
        row.vendor_id ??= null;
        row.task_id ??= null;
      }
      if (table === 'materials') {
        for (const k of ['order_number', 'notes', 'quantity', 'supplier']) row[k] ??= '';
        for (const k of ['needed_by', 'ordered_date', 'expected_date', 'arrived_date', 'cost_cents']) row[k] ??= null;
        row.status ??= 'needed';
      }
      (db[table] as unknown[]).push(row);
      if (table === 'bills') afterBillChange(db, row as unknown as Bill);
    }
    syncCo(db);
    save();
  },
  async update(table, id, patch) {
    const db = load();
    const idKey = rowKey(table);
    const row = (db[table] as unknown as Record<string, unknown>[]).find((r) => r[idKey] === id);
    if (!row) throw new Error('That record no longer exists.');
    if (table === 'bills') {
      const before = { ...(row as unknown as Bill) };
      Object.assign(row, guardBill(db, before, patch as Partial<Bill>));
      afterBillChange(db, row as unknown as Bill, before);
    } else if (table === 'photos') {
      const p = patch as Partial<Photo>;
      if (p.review_status === 'rejected' && !p.review_note?.trim()) throw new Error('Say why this photo is disapproved, so the contractor knows what to fix.');
      Object.assign(row, p);
      if (p.review_status === 'approved') row.review_note = '';
    } else if (table === 'tasks') {
      // Same rule as the database: new dates or a new sub means they need to hear about it again.
      const before = { ...row };
      Object.assign(row, patch);
      if (['start_date', 'end_date', 'vendor_id'].some((k) => row[k] !== before[k])) row.contact_status = 'not_contacted';
    } else {
      Object.assign(row, patch);
    }
    syncCo(db);
    save();
  },
  async remove(table, id) {
    const db = load();
    const idKey = rowKey(table);
    const rows = db[table] as unknown as Record<string, unknown>[];
    const i = rows.findIndex((r) => r[idKey] === id);
    if (i < 0) return;
    if (table === 'bills') {
      if ((rows[i] as unknown as Bill).status === 'paid' && me().role !== 'admin') {
        throw new Error('Only an admin can delete a paid bill.');
      }
      db.lien_waivers = db.lien_waivers.filter((w: Waiver) => w.bill_id !== id);
    }
    if (table === 'jobs') {
      for (const t of ['budget_lines', 'pos', 'bills', 'change_orders', 'draws', 'lien_waivers', 'tasks', 'daily_logs', 'photos', 'selections', 'documents', 'job_steps', 'scope_items', 'materials', 'notifications'] as const) {
        (db[t] as unknown as { job_id: string }[]) = (db[t] as unknown as { job_id: string }[]).filter((r) => r.job_id !== id);
      }
    }
    if (table === 'leads') db.lead_appointments = (db.lead_appointments ?? []).filter((a) => a.lead_id !== id);
    if (table === 'jobs') for (const l of db.leads ?? []) if (l.job_id === id) l.job_id = null;
    rows.splice(i, 1);
    syncCo(db);
    save();
  },
  async myJobs() {
    const db = load();
    const v = me().vendor_id;
    if (me().role === 'crew') {
      const jobs = crewJobs(db, me().id);
      return db.jobs.filter((j) => jobs.has(j.id)).map(({ id, name, address }) => ({ id, name, address }));
    }
    return db.jobs
      .filter((j) => db.pos.some((p) => p.job_id === j.id && p.vendor_id === v && p.status !== 'draft')
        || db.tasks.some((t) => t.job_id === j.id && t.vendor_id === v))
      .map(({ id, name, address }) => ({ id, name, address }));
  },
  async respondPo(id, accept) {
    const db = load();
    const p = db.pos.find((x) => x.id === id && x.vendor_id === me().vendor_id && x.status === 'sent');
    if (!p) throw new Error('This work order is not waiting on your answer.');
    p.status = accept ? 'accepted' : 'declined';
    save();
  },
  async submitWaiver(id, path) {
    const db = load();
    const w = db.lien_waivers.find((x) => x.id === id && x.vendor_id === me().vendor_id && x.status === 'requested');
    if (!w) throw new Error('This waiver is not waiting on you.');
    w.status = 'received';
    w.file_path = path;
    save();
  },
  async setTaskStatus(id, status) {
    const db = load();
    const p = me();
    const t = db.tasks.find((x) => x.id === id && (p.role === 'crew' ? x.assigned_to === p.id : x.vendor_id === p.vendor_id));
    if (!t) throw new Error('This task is not assigned to you.');
    t.status = status as typeof t.status;
    save();
  },
  async crewMaterials() {
    const db = load();
    const jobs = crewJobs(db, me().id);
    return db.materials.filter((m) => jobs.has(m.job_id)).map((m) => ({ ...m, cost_cents: null, order_number: '' }));
  },
  async markMaterialArrived(id) {
    const db = load();
    const jobs = crewJobs(db, me().id);
    const m = db.materials.find((x) => x.id === id && x.status !== 'arrived' && jobs.has(x.job_id));
    if (!m) throw new Error('This material is not on one of your jobs, or it already arrived.');
    m.status = 'arrived';
    m.arrived_date = todayIso();
    save();
  },
  async requestMaterial(job, name, quantity, neededBy, notes) {
    const db = load();
    const p = me();
    const mineJobs = p.role === 'sub'
      ? new Set(db.jobs.filter((j) => db.pos.some((x) => x.job_id === j.id && x.vendor_id === p.vendor_id && x.status !== 'draft') || db.tasks.some((t) => t.job_id === j.id && t.vendor_id === p.vendor_id)).map((j) => j.id))
      : crewJobs(db, p.id);
    if (!mineJobs.has(job)) throw new Error('This job is not one of yours.');
    if (!name.trim()) throw new Error('Say what you need.');
    db.materials.push({
      id: crypto.randomUUID(), job_id: job, name: name.trim(), quantity: quantity.trim(), supplier: '', order_number: '', status: 'needed',
      needed_by: neededBy, ordered_date: null, expected_date: null, arrived_date: null, cost_cents: null, notes,
      requested_by: p.id, requested_by_name: p.role === 'sub' ? (db.vendors.find((v) => v.id === p.vendor_id)?.name ?? p.name) : p.name || p.email,
    });
    save();
  },
  async myMaterialRequests() {
    return load().materials.filter((m) => m.requested_by === me().id).map(({ id, job_id, name, quantity, status, needed_by, expected_date, arrived_date, notes }) => ({ id, job_id, name, quantity, status, needed_by, expected_date, arrived_date, notes }));
  },
  async inviteUser() {},
  async confirmTask(id) {
    const db = load();
    const t = db.tasks.find((x) => x.id === id && x.vendor_id === me().vendor_id);
    if (!t) throw new Error('This task is not assigned to you.');
    t.contact_status = 'confirmed';
    save();
  },
  async upload(path, file) {
    files.set(path, URL.createObjectURL(file));
    return path;
  },
  async removeFile(path) {
    files.delete(path);
  },
  async fileUrl(path) {
    if (path.startsWith('demo/')) {
      const name = path.split('/').pop();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200"><rect width="640" height="200" fill="#eef0ed"/><text x="24" y="100" font-family="sans-serif" font-size="20">Sample file: ${name}</text></svg>`;
      return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    }
    const url = files.get(path);
    if (!url) throw new Error('Demo mode keeps files only until you reload the page.');
    return url;
  },
  demoSwitch(id) {
    storage(WHO, id);
    listener();
  },
  demoReset() {
    memory = seed();
    save();
    listener();
  },
};
