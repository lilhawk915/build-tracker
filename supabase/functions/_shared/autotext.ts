// Decides which automatic texts are due, and sends them only if every lock is open.
// No imports, so the same file runs in the app (preview) and on the server (sending).

export interface AutoTextSettings {
  id: string; enabled: boolean; sender_name: string; notice_days: number; reminder_days: number;
  start_hour: number; end_hour: number; daily_cap: number;
}
export interface PlanTask {
  id: string; job_id: string; vendor_id: string | null; name: string; start_date: string; end_date: string;
  status: string; contact_status: string;
}
export interface PlanJob { id: string; name: string; address: string; status: string }
export interface PlanVendor { id: string; name: string }
export interface PlanContact {
  vendor_id: string; name: string; mobile: string; is_primary: boolean; auto_text_ok?: boolean;
}
export interface LogRow { task_id: string | null; kind: string; start_date: string; vendor_id: string | null; status: string; created_at: string }

export interface PlannedText {
  taskId: string; jobId: string; vendorId: string; kind: 'notice' | 'reminder'; startDate: string;
  jobName: string; taskName: string; recipient: string; phone: string; body: string;
  blocked: string;  // empty means ready to send
}

const DAY = 86400000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export function mobileDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return '';
}

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

export function autoTextBody(kind: 'notice' | 'reminder', firstName: string, sender: string, task: Pick<PlanTask, 'name' | 'start_date' | 'end_date'>, place: string): string {
  const hi = firstName ? `Hi ${firstName}, ` : 'Hi, ';
  const when = task.start_date === task.end_date ? shortDate(task.start_date) : `${shortDate(task.start_date)} to ${shortDate(task.end_date)}`;
  const lead = kind === 'reminder' ? `Reminder: you start ${task.name} at ${place}, ${when}.` : `You're scheduled for ${task.name} at ${place}, ${when}.`;
  return `${hi}this is ${sender || '[sender name]'}. ${lead} Can you confirm? Reply STOP to opt out.`;
}

// Time in Ohio, whatever computer or server this runs on.
export function easternClock(now: Date): { date: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), weekday };
}

export function sendWindowProblem(s: Pick<AutoTextSettings, 'start_hour' | 'end_hour'>, now: Date): string {
  const c = easternClock(now);
  if (c.weekday === 0 || c.weekday === 6) return 'Weekend. Texts wait for Monday.';
  if (c.hour < s.start_hour || c.hour >= s.end_hour) return `Outside sending hours (${s.start_hour}:00 to ${s.end_hour}:00 Eastern).`;
  return '';
}

export function planAutoTexts(input: {
  tasks: PlanTask[]; jobs: PlanJob[]; vendors: PlanVendor[]; contacts: PlanContact[]; log: LogRow[];
  settings: Pick<AutoTextSettings, 'notice_days' | 'reminder_days' | 'sender_name'>; today: string;
}): PlannedText[] {
  const { tasks, jobs, vendors, contacts, log, settings, today } = input;
  const out: PlannedText[] = [];
  const accepted = (t: PlanTask, kind: string) => log.some((l) =>
    l.status === 'accepted' && l.task_id === t.id && l.kind === kind && l.start_date === t.start_date && l.vendor_id === t.vendor_id);
  for (const t of tasks) {
    if (!t.vendor_id || t.status !== 'todo' || t.contact_status === 'confirmed' || t.start_date < today) continue;
    const job = jobs.find((j) => j.id === t.job_id);
    if (!job || job.status === 'closed') continue;
    // The reminder takes over from the notice, so someone added late never gets both at once.
    let kind: 'notice' | 'reminder' | null = null;
    if (today >= addDays(t.start_date, -settings.reminder_days)) kind = 'reminder';
    else if (today >= addDays(t.start_date, -settings.notice_days)) kind = 'notice';
    if (!kind || accepted(t, kind)) continue;
    const mine = contacts.filter((c) => c.vendor_id === t.vendor_id);
    const c = mine.find((x) => x.is_primary) ?? mine[0];
    const phone = mobileDigits(c?.mobile ?? '');
    const blocked = !settings.sender_name.trim() ? 'No sender name set'
      : !c ? 'No contact on file'
      : !phone ? 'No valid mobile number'
      : !c.auto_text_ok ? 'Contact has not agreed to automatic texts'
      : '';
    out.push({
      taskId: t.id, jobId: t.job_id, vendorId: t.vendor_id, kind, startDate: t.start_date, jobName: job.name, taskName: t.name,
      recipient: vendors.find((v) => v.id === t.vendor_id)?.name ?? '', phone,
      body: autoTextBody(kind, (c?.name ?? '').trim().split(/\s+/)[0] ?? '', settings.sender_name.trim(), t, job.address || job.name),
      blocked,
    });
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export interface RunResult { state: 'off' | 'waiting' | 'ran'; reason: string; sent: number; failed: number; held: number }

const MAX_FAILURES = 3;

// Sending happens only when the setting is on AND the server switch is on AND it's within sending hours.
export async function runAutoTexts(deps: {
  live: boolean; now: Date;
  load: () => Promise<{ settings: AutoTextSettings; tasks: PlanTask[]; jobs: PlanJob[]; vendors: PlanVendor[]; contacts: PlanContact[]; log: LogRow[] }>;
  send: (phone: string, body: string) => Promise<void>;
  record: (text: PlannedText, status: 'accepted' | 'failed', error: string) => Promise<void>;
}): Promise<RunResult> {
  const none = { sent: 0, failed: 0, held: 0 };
  if (!deps.live) return { state: 'off', reason: 'Server switch is off.', ...none };
  const d = await deps.load();
  if (!d.settings.enabled) return { state: 'off', reason: 'Automatic texts are turned off in settings.', ...none };
  const waitReason = sendWindowProblem(d.settings, deps.now);
  if (waitReason) return { state: 'waiting', reason: waitReason, ...none };
  const clock = easternClock(deps.now);
  const plan = planAutoTexts({ ...d, today: clock.date });
  const ready = plan.filter((p) => !p.blocked).filter((p) => d.log.filter((l) =>
    l.status === 'failed' && l.task_id === p.taskId && l.kind === p.kind && l.start_date === p.startDate).length < MAX_FAILURES);
  const usedToday = d.log.filter((l) => l.status === 'accepted' && easternClock(new Date(l.created_at)).date === clock.date).length;
  const room = Math.max(0, d.settings.daily_cap - usedToday);
  const batch = ready.slice(0, room);
  let sent = 0;
  let failed = 0;
  for (const p of batch) {
    try {
      await deps.send(p.phone, p.body);
    } catch (e) {
      failed++;
      await deps.record(p, 'failed', (e as Error).message);
      continue;
    }
    sent++;
    await deps.record(p, 'accepted', '');
  }
  return { state: 'ran', reason: '', sent, failed, held: ready.length - batch.length };
}

// Kixie reports success when it accepts a text. That doesn't prove the text arrived.
export function kixieRequest(cfg: { url: string; apiKey: string; businessId: string; senderEmail: string }, phone: string, body: string) {
  return {
    url: `${cfg.url}?apikey=${encodeURIComponent(cfg.apiKey)}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessid: cfg.businessId, email: cfg.senderEmail, target: phone.replace(/^\+1/, ''), eventname: 'sms', message: body, apikey: cfg.apiKey }),
    },
  };
}
