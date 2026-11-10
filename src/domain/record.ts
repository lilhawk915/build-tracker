import type { Bill, BudgetLine, Job, JobStep, Po, Task, Vendor } from './types';

export interface StepRow {
  key: string;
  step: string;
  vendorId: string | null;
  who: string;
  start: string | null;
  end: string | null;
  amount: number | null;  // paid, or the agreed amount if nothing is paid yet
  notes: string;
  stepId?: string;        // set on hand-entered rows, which can be edited
}

const LIVE_PO = new Set(['sent', 'accepted', 'closed']);

// One row per step and person: hand-entered history, then budget lines with POs or bills, then assigned tasks.
export function stepsFor(
  job: Job, lines: BudgetLine[], pos: Po[], bills: Bill[], tasks: Task[], steps: JobStep[], vendors: Vendor[],
): StepRow[] {
  const name = (id: string | null) => vendors.find((v) => v.id === id)?.name ?? '';
  const rows: StepRow[] = steps.filter((s) => s.job_id === job.id).map((s) => ({
    key: `step-${s.id}`, step: s.step, vendorId: s.vendor_id, who: name(s.vendor_id) || s.other_name,
    start: s.start_date, end: s.end_date, amount: s.cost_cents, notes: s.notes, stepId: s.id,
  }));

  const jobLines = lines.filter((l) => l.job_id === job.id).sort((a, b) => a.sort - b.sort);
  const livePos = pos.filter((p) => p.job_id === job.id && LIVE_PO.has(p.status));
  const costBills = bills.filter((b) => b.job_id === job.id && (b.status === 'approved' || b.status === 'paid'));
  const lineRows: StepRow[] = [];
  for (const line of jobLines) {
    const linePos = livePos.filter((p) => p.budget_line_id === line.id);
    const lineBills = costBills.filter((b) => b.budget_line_id === line.id);
    for (const vendorId of new Set([...linePos.map((p) => p.vendor_id), ...lineBills.map((b) => b.vendor_id)])) {
      const paid = lineBills.filter((b) => b.vendor_id === vendorId && b.status === 'paid').reduce((s, b) => s + b.amount_cents, 0);
      const agreed = linePos.filter((p) => p.vendor_id === vendorId).reduce((s, p) => s + p.amount_cents + p.approved_co_cents, 0);
      lineRows.push({
        key: `line-${line.id}-${vendorId}`, step: line.name, vendorId, who: name(vendorId),
        start: null, end: null, amount: paid || agreed, notes: '',
      });
    }
  }

  // A sub's tasks add dates to their row when they did only one budget line. Otherwise each task is its own row.
  const taskRows: StepRow[] = [];
  for (const t of tasks.filter((x) => x.job_id === job.id && x.vendor_id)) {
    const theirs = lineRows.filter((r) => r.vendorId === t.vendor_id);
    if (theirs.length === 1) {
      const r = theirs[0];
      r.start = !r.start || t.start_date < r.start ? t.start_date : r.start;
      r.end = !r.end || t.end_date > r.end ? t.end_date : r.end;
    } else {
      taskRows.push({
        key: `task-${t.id}`, step: t.name, vendorId: t.vendor_id, who: name(t.vendor_id),
        start: t.start_date, end: t.end_date, amount: null, notes: t.notes,
      });
    }
  }
  const all = [...rows, ...lineRows, ...taskRows];
  // Dated work in order, then undated rows in the order built.
  return all
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.start ?? '9999').localeCompare(b.r.start ?? '9999') || a.i - b.i)
    .map((x) => x.r);
}
