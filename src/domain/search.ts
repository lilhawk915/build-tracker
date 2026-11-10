import { money } from './csv';
import { stepsFor } from './record';
import { jobTypeLabel } from './types';
import type {
  Bill, BudgetLine, ChangeOrder, DailyLog, Document, Job, JobStep, Material, Photo, Po, ScopeItem, Selection, Task, Vendor, VendorContact, Waiver,
} from './types';

export interface SearchData {
  jobs: Job[]; vendors: Vendor[]; budget_lines: BudgetLine[]; pos: Po[]; bills: Bill[]; change_orders: ChangeOrder[];
  lien_waivers: Waiver[]; tasks: Task[]; daily_logs: DailyLog[]; photos: Photo[]; selections: Selection[];
  documents: Document[]; job_steps: JobStep[]; materials?: Material[]; scope_items?: ScopeItem[]; vendor_contacts?: VendorContact[];
}


export type SearchKind = 'job' | 'scope' | 'material' | 'selection' | 'document' | 'step' | 'task' | 'po' | 'bill' | 'change' | 'log' | 'photo' | 'waiver';

export const KIND_LABEL: Record<SearchKind, string> = {
  job: 'Job', scope: 'What it needs', material: 'Materials', selection: 'Colors and selections', document: 'Drawings and files', step: 'Who did it', task: 'Schedule',
  po: 'POs', bill: 'Bills', change: 'Change orders', log: 'Site log', photo: 'Photos', waiver: 'Lien waivers',
};

const KIND_TAB: Record<SearchKind, string> = {
  job: 'record', scope: 'scope', material: 'materials', selection: 'selections', document: 'files', step: 'record', task: 'schedule',
  po: 'pos', bill: 'bills', change: 'changes', log: 'log', photo: 'log', waiver: 'waivers',
};

export interface SearchRecord {
  key: string; kind: SearchKind; jobId: string; title: string; detail: string; tab: string;
  filePath: string | null;
  own: string;  // squeezed text of this record
  vendorIds: string[];
}

// Lowercase with spaces and punctuation gone, so "SW-7006", "SW 7006", and "sw7006" all match.
export const squeeze = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export const jobYear = (j: Job) => (j.finish_date ?? j.start_date ?? j.target_finish ?? '').slice(0, 4);

const join = (...parts: (string | number | null | undefined)[]) =>
  parts.filter((p) => p !== null && p !== undefined && p !== '').join(' · ');

export function buildIndex(d: SearchData): { records: SearchRecord[]; jobText: Map<string, string> } {
  const vendor = (id: string | null) => d.vendors.find((v) => v.id === id);
  const vendorText = (id: string | null) => {
    const v = vendor(id);
    if (!v) return '';
    const people = (d.vendor_contacts ?? []).filter((c) => c.vendor_id === id).map((c) => `${c.name} ${c.mobile} ${c.office_phone} ${c.email}`).join(' ');
    return `${v.name} ${v.trade} ${people}`;
  };
  const line = (id: string) => d.budget_lines.find((l) => l.id === id)?.name ?? '';
  const records: SearchRecord[] = [];
  const add = (kind: SearchKind, id: string, jobId: string, title: string, detail: string, text: string, vendorIds: (string | null)[] = [], filePath: string | null = null) =>
    records.push({
      key: `${kind}-${id}`, kind, jobId, title, detail, tab: KIND_TAB[kind], filePath,
      own: squeeze(`${title} ${detail} ${text}`),
      vendorIds: vendorIds.filter((v): v is string => Boolean(v)),
    });

  const jobText = new Map<string, string>();
  for (const j of d.jobs) {
    const beds = j.bedrooms != null ? `${j.bedrooms} bed` : '';
    const baths = j.bathrooms != null ? `${j.bathrooms} bath` : '';
    jobText.set(j.id, squeeze(join(
      j.name, j.address, jobTypeLabel(j), j.status, j.lender, j.notes, j.client_name,
      j.client_phone, j.client_email, j.plan_name, j.permit_number, j.square_feet, beds, baths, jobYear(j),
    )));
    add('job', j.id, j.id, j.name, join(j.address, j.plan_name, j.client_name), '');
  }
  for (const s of d.scope_items ?? []) {
    add('scope', s.id, s.job_id, s.title, join(s.location, s.details), '');
  }
  for (const m of d.materials ?? []) {
    add('material', m.id, m.job_id, m.name, join(m.quantity, m.supplier, m.status === 'ordered' ? 'on order' : m.status, m.order_number), m.notes);
  }
  for (const s of d.selections) {
    add('selection', s.id, s.job_id,
      join(s.room, s.item || s.category),
      join(s.brand, s.color_name, s.color_code, s.finish, s.supplier),
      `${s.category} ${s.notes} ${vendorText(s.vendor_id)}`, [s.vendor_id], s.file_path);
  }
  for (const f of d.documents) {
    add('document', f.id, f.job_id, f.title, join(f.category, f.revision && `Rev ${f.revision}`, f.doc_date), `${f.file_name} ${f.notes}`, [], f.file_path);
  }
  for (const j of d.jobs) {
    for (const r of stepsFor(j, d.budget_lines, d.pos, d.bills, d.tasks, d.job_steps, d.vendors)) {
      add('step', r.key, j.id, r.step, join(r.who, r.amount != null ? money(r.amount) : null, r.start), `${vendorText(r.vendorId)} ${r.notes}`, [r.vendorId]);
    }
  }
  for (const t of d.tasks) {
    add('task', t.id, t.job_id, t.name, join(vendor(t.vendor_id)?.name, t.start_date, t.end_date), `${t.notes} ${vendorText(t.vendor_id)}`, [t.vendor_id]);
  }
  for (const p of d.pos) {
    add('po', p.id, p.job_id, `PO ${p.number}: ${p.description}`, join(vendor(p.vendor_id)?.name, money(p.amount_cents + p.approved_co_cents), line(p.budget_line_id)), vendorText(p.vendor_id), [p.vendor_id]);
  }
  for (const b of d.bills) {
    add('bill', b.id, b.job_id, join(vendor(b.vendor_id)?.name, b.invoice_no && `Invoice ${b.invoice_no}`), join(money(b.amount_cents), line(b.budget_line_id), b.bill_date, b.status), `${b.notes} ${vendorText(b.vendor_id)}`, [b.vendor_id], b.file_path);
  }
  for (const c of d.change_orders) {
    add('change', c.id, c.job_id, `Change order ${c.number}: ${c.description}`, join(line(c.budget_line_id), money(c.cost_delta_cents), c.status), '');
  }
  for (const l of d.daily_logs) {
    add('log', l.id, l.job_id, l.notes.slice(0, 90), join(l.log_date, l.weather, l.author), l.notes);
  }
  for (const p of d.photos.filter((x) => x.review_status !== 'rejected')) {
    add('photo', p.id, p.job_id, p.caption || 'Photo', vendor(p.vendor_id)?.name ?? '', vendorText(p.vendor_id), [p.vendor_id], p.file_path);
  }
  for (const w of d.lien_waivers) {
    add('waiver', w.id, w.job_id, `${w.kind.replace('_', ' ')} waiver`, join(vendor(w.vendor_id)?.name, money(w.amount_cents), w.status), vendorText(w.vendor_id), [w.vendor_id], w.file_path);
  }
  return { records, jobText };
}

export interface SearchOptions { kind?: SearchKind | ''; year?: string; vendorId?: string; jobType?: string }

export interface JobHit { job: Job; jobMatched: boolean; records: SearchRecord[] }

const tokensOf = (q: string) => q.split(/\s+/).map(squeeze).filter(Boolean);

const RANK: SearchKind[] = ['job', 'scope', 'material', 'selection', 'document', 'step', 'po', 'task', 'change', 'bill', 'log', 'photo', 'waiver'];

// Every word must appear somewhere in a record or its job, and at least one must be in the record itself.
// So "oak ridge alabaster" finds Alabaster on Oak Ridge, but "oak ridge" doesn't list every record on Oak Ridge.
export function search(d: SearchData, query: string, opts: SearchOptions = {}): JobHit[] {
  const { records, jobText } = buildIndex(d);
  const tokens = tokensOf(query);
  const jobs = d.jobs.filter((j) => (!opts.year || jobYear(j) === opts.year) && (!opts.jobType || j.job_type === opts.jobType));
  const hits: JobHit[] = [];
  for (const job of jobs) {
    const jt = jobText.get(job.id) ?? '';
    const mine = records.filter((r) => r.jobId === job.id);
    const usedVendor = !opts.vendorId || mine.some((r) => r.vendorIds.includes(opts.vendorId!));
    if (!usedVendor) continue;
    const jobMatched = tokens.every((t) => jt.includes(t));
    const found = !tokens.length ? [] : mine.filter((r) => {
      if (r.kind === 'job') return false;
      if (!tokens.every((t) => r.own.includes(t) || jt.includes(t))) return false;
      return tokens.some((t) => r.own.includes(t));
    }).filter((r) => !opts.kind || r.kind === opts.kind)
      .filter((r) => !opts.vendorId || r.vendorIds.includes(opts.vendorId));
    const narrowed = Boolean(opts.kind);
    if (found.length || (jobMatched && !narrowed)) {
      found.sort((a, b) => RANK.indexOf(a.kind) - RANK.indexOf(b.kind));
      hits.push({ job, jobMatched, records: found });
    }
  }
  return hits.sort((a, b) => Number(b.jobMatched) - Number(a.jobMatched) || jobYear(b.job).localeCompare(jobYear(a.job)) || a.job.name.localeCompare(b.job.name));
}

// Pieces of text for highlighting: words from the query are marked, ignoring case.
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const words = query.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return [{ text, hit: false }];
  const re = new RegExp(`(${words.join('|')})`, 'gi');
  return text.split(re).filter(Boolean).map((p) => ({ text: p, hit: words.some((w) => new RegExp(`^${w}$`, 'i').test(p)) }));
}
