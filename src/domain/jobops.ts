import { daysBetween } from './rules';
import { addDays } from './schedule';
import type { Job, Material, Task, VendorContact } from './types';

// ---------- schedule status ----------
export interface ScheduleHealth {
  state: 'none' | 'done' | 'on' | 'behind';
  daysBehind: number;
  projectedFinish: string | null;
  overTarget: number;  // days the projected finish runs past the target finish
  lateTasks: Task[];
  label: string;
}

// A task is behind if it should have finished, or should have started and hasn't.
// Unfinished work pushes the projected finish out by the worst delay.
export function scheduleHealth(job: Pick<Job, 'target_finish'>, tasks: Task[], today: string): ScheduleHealth {
  if (!tasks.length) return { state: 'none', daysBehind: 0, projectedFinish: null, overTarget: 0, lateTasks: [], label: 'No schedule' };
  const open = tasks.filter((t) => t.status !== 'done');
  const lastEnd = tasks.reduce((m, t) => (t.end_date > m ? t.end_date : m), tasks[0].end_date);
  if (!open.length) return { state: 'done', daysBehind: 0, projectedFinish: lastEnd, overTarget: 0, lateTasks: [], label: 'Schedule complete' };
  const delay = (t: Task) => {
    const finishLate = t.end_date < today ? daysBetween(t.end_date, today) : 0;
    const startLate = t.status === 'todo' && t.start_date < today ? daysBetween(t.start_date, today) : 0;
    return Math.max(finishLate, startLate);
  };
  const lateTasks = open.filter((t) => delay(t) > 0);
  const daysBehind = Math.max(0, ...open.map(delay));
  const projectedFinish = addDays(lastEnd, daysBehind);
  const overTarget = job.target_finish ? Math.max(0, daysBetween(job.target_finish, projectedFinish)) : 0;
  const behind = daysBehind > 0 || overTarget > 0;
  const n = daysBehind || overTarget;
  return {
    state: behind ? 'behind' : 'on', daysBehind, projectedFinish, overTarget, lateTasks,
    label: behind ? `${n} day${n === 1 ? '' : 's'} behind` : 'On schedule',
  };
}

// ---------- contractor call list ----------
export const CALL_WINDOW_DAYS = 14;

// Open sub tasks starting soon that aren't confirmed yet, soonest first.
export function callList(tasks: Task[], today: string, windowDays = CALL_WINDOW_DAYS): Task[] {
  const cutoff = addDays(today, windowDays);
  return tasks
    .filter((t) => t.vendor_id && t.status === 'todo' && t.contact_status !== 'confirmed' && t.start_date <= cutoff)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}

// ---------- materials ----------
export const materialLate = (m: Pick<Material, 'status' | 'expected_date'>, today: string) =>
  m.status === 'ordered' && Boolean(m.expected_date) && m.expected_date! < today;

export const needsOrdering = (m: Pick<Material, 'status' | 'needed_by'>, today: string, soonDays = 7) =>
  m.status === 'needed' && Boolean(m.needed_by) && m.needed_by! <= addDays(today, soonDays);

export interface MaterialSummary {
  needed: number; ordered: number; arrived: number; late: number; orderedCost: number;
}

export function summarizeMaterials(rows: Material[], today: string): MaterialSummary {
  return {
    needed: rows.filter((m) => m.status === 'needed').length,
    ordered: rows.filter((m) => m.status === 'ordered').length,
    arrived: rows.filter((m) => m.status === 'arrived').length,
    late: rows.filter((m) => materialLate(m, today)).length,
    orderedCost: rows.filter((m) => m.status !== 'needed').reduce((s, m) => s + (m.cost_cents ?? 0), 0),
  };
}

// "12 2x4x8 studs" becomes quantity 12 and the rest as the name. One item per line.
export function parseMaterialLines(text: string): { name: string; quantity: string }[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^(\d[\d,.]*)\s*(?:x\s+)?(\D.*)$/i);
    return m ? { quantity: m[1], name: m[2].trim() } : { quantity: '', name: line };
  });
}

// ---------- messages ----------
// Returns digits with country code for a text or call link, or '' if it can't be a US number.
export function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return '';
}

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

export function taskMessage(opts: {
  firstName: string; task: Pick<Task, 'name' | 'start_date' | 'end_date'>; job: { name: string; address: string }; sender: string;
}): string {
  const { firstName, task, job, sender } = opts;
  const place = job.address || job.name;
  const when = task.start_date === task.end_date
    ? shortDate(task.start_date)
    : `${shortDate(task.start_date)} to ${shortDate(task.end_date)}`;
  const hi = firstName ? `Hi ${firstName}, ` : 'Hi, ';
  return `${hi}this is ${sender}. You're scheduled for ${task.name} at ${place}, ${when}. Can you confirm you'll be there?`;
}

export const smsLink = (phone: string, body: string) => `sms:${phoneDigits(phone)}?&body=${encodeURIComponent(body)}`;

export const emailLink = (email: string, subject: string, body: string) =>
  `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export const firstNameOf = (c?: Pick<VendorContact, 'name'>) => c?.name.trim().split(/\s+/)[0] ?? '';

// The main contact for a sub: the one marked primary, or else the first with a way to reach them.
export function primaryContact(contacts: VendorContact[], vendorId: string | null): VendorContact | undefined {
  const mine = contacts.filter((c) => c.vendor_id === vendorId);
  return mine.find((c) => c.is_primary) ?? mine.find((c) => c.mobile || c.office_phone || c.email) ?? mine[0];
}

export const bestPhone = (c?: Pick<VendorContact, 'mobile' | 'office_phone'>) => c?.mobile || c?.office_phone || '';

export const isRequested = (m: Pick<Material, 'status' | 'requested_by_name'>) => m.status === 'needed' && Boolean(m.requested_by_name);
