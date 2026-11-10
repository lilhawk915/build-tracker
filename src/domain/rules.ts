import type { Bill, BillStatus, Task, Vendor, Waiver, WaiverKind } from './types';

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The same gate the database enforces in bill_before_update. Returns the reasons a bill can't be paid.
export function payBlockers(vendor: Vendor | undefined, waivers: Waiver[], billId: string, paidDate: string): string[] {
  const out: string[] = [];
  if (!vendor?.coi_expires) out.push('no insurance certificate on file');
  else if (vendor.coi_expires < paidDate) out.push(`insurance expired ${vendor.coi_expires}`);
  if (!waivers.some((w) => w.bill_id === billId && w.status === 'received')) out.push('no lien waiver received');
  return out;
}

export function canMoveBill(from: BillStatus, to: BillStatus, isAdmin: boolean): boolean {
  if (from === 'submitted') return to === 'approved' || to === 'rejected';
  if (from === 'approved') return to === 'paid' || to === 'rejected' || to === 'submitted';
  if (from === 'rejected') return to === 'submitted';
  return to === 'approved' && isAdmin;
}

export function followUpWaiverKind(existing: Waiver[]): WaiverKind | null {
  if (existing.some((w) => w.kind.startsWith('unconditional'))) return null;
  return existing.some((w) => w.kind === 'conditional_final') ? 'unconditional_final' : 'unconditional_progress';
}

export type Flag = { severity: 'stop' | 'watch'; label: string; jobId?: string; to?: string };

export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export function coiFlag(v: Vendor, today: string): Flag | null {
  if (!v.coi_expires) return { severity: 'watch', label: `${v.name}: no insurance certificate on file` };
  const left = daysBetween(today, v.coi_expires);
  if (left < 0) return { severity: 'stop', label: `${v.name}: insurance expired ${v.coi_expires}` };
  if (left <= 30) return { severity: 'watch', label: `${v.name}: insurance expires in ${left} days` };
  return null;
}

export const isLate = (t: Task, today: string) => t.status !== 'done' && t.end_date < today;

export const billNeedsApproval = (b: Bill) => b.status === 'submitted';
