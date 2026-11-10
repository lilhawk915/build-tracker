import { describe, expect, it, vi } from 'vitest';
import { autoTextBody, easternClock, kixieRequest, mobileDigits, planAutoTexts, runAutoTexts, sendWindowProblem, type AutoTextSettings, type LogRow, type PlanContact, type PlanTask } from '../supabase/functions/_shared/autotext';

const settings: AutoTextSettings = { id: 'main', enabled: true, sender_name: 'H3 Office', notice_days: 7, reminder_days: 1, start_hour: 9, end_hour: 18, daily_cap: 25 };
const task = (start: string, extra: Partial<PlanTask> = {}): PlanTask =>
  ({ id: 't', job_id: 'j', vendor_id: 'v', name: 'Rough plumbing', start_date: start, end_date: start, status: 'todo', contact_status: 'not_contacted', ...extra });
const contact = (extra: Partial<PlanContact> = {}): PlanContact =>
  ({ vendor_id: 'v', name: 'Pat Smith', mobile: '937-555-0100', is_primary: true, auto_text_ok: true, ...extra });
const base = { jobs: [{ id: 'j', name: 'Oak', address: '100 Ridge Rd', status: 'active' }], vendors: [{ id: 'v', name: 'Acme Plumbing' }], contacts: [contact()], log: [] as LogRow[], settings };
const plan = (t: PlanTask, today: string, over = {}) => planAutoTexts({ ...base, tasks: [t], today, ...over });

// A Tuesday at 10am Eastern, and the same-day date string.
const TUE_10AM = new Date('2026-11-10T15:00:00Z');
const TODAY = '2026-11-10';

describe('which texts are due', () => {
  it('sends nothing before the notice window', () => expect(plan(task('2026-11-20'), TODAY)).toEqual([]));
  it('sends a notice inside the window', () => expect(plan(task('2026-11-17'), TODAY)[0].kind).toBe('notice'));
  it('sends a reminder the day before', () => expect(plan(task('2026-11-11'), TODAY)[0].kind).toBe('reminder'));
  it('sends only the reminder for work added at the last minute', () => {
    const out = plan(task('2026-11-10'), TODAY);
    expect(out.map((p) => p.kind)).toEqual(['reminder']);
  });
  it('skips confirmed, started, finished, past, closed-job, and unassigned work', () => {
    expect(plan(task('2026-11-12', { contact_status: 'confirmed' }), TODAY)).toEqual([]);
    expect(plan(task('2026-11-12', { status: 'in_progress' }), TODAY)).toEqual([]);
    expect(plan(task('2026-11-12', { status: 'done' }), TODAY)).toEqual([]);
    expect(plan(task('2026-11-09'), TODAY)).toEqual([]);
    expect(plan(task('2026-11-12', { vendor_id: null }), TODAY)).toEqual([]);
    expect(plan(task('2026-11-12'), TODAY, { jobs: [{ id: 'j', name: 'O', address: '', status: 'closed' }] })).toEqual([]);
  });
  it('still texts someone already contacted but not confirmed', () => {
    expect(plan(task('2026-11-12', { contact_status: 'contacted' }), TODAY)).toHaveLength(1);
  });
  it('does not repeat an accepted text', () => {
    const log: LogRow[] = [{ task_id: 't', kind: 'notice', start_date: '2026-11-17', vendor_id: 'v', status: 'accepted', created_at: '2026-11-10T15:00:00Z' }];
    expect(plan(task('2026-11-17'), TODAY, { log })).toEqual([]);
  });
  it('sends a fresh notice when the dates move', () => {
    const log: LogRow[] = [{ task_id: 't', kind: 'notice', start_date: '2026-11-15', vendor_id: 'v', status: 'accepted', created_at: '2026-11-10T15:00:00Z' }];
    expect(plan(task('2026-11-17'), TODAY, { log })).toHaveLength(1);
  });
  it('sends a notice to the new sub when the sub changes', () => {
    const log: LogRow[] = [{ task_id: 't', kind: 'notice', start_date: '2026-11-17', vendor_id: 'other', status: 'accepted', created_at: '2026-11-10T15:00:00Z' }];
    expect(plan(task('2026-11-17'), TODAY, { log })).toHaveLength(1);
  });
});

describe('who can be texted', () => {
  const blocked = (over: object) => plan(task('2026-11-12'), TODAY, over)[0].blocked;
  it('blocks a contact who has not agreed', () => expect(blocked({ contacts: [contact({ auto_text_ok: false })] })).toMatch(/not agreed/));
  it('blocks a missing or bad mobile number', () => {
    expect(blocked({ contacts: [contact({ mobile: '' })] })).toMatch(/mobile/);
    expect(blocked({ contacts: [contact({ mobile: '555-0100' })] })).toMatch(/mobile/);
  });
  it('blocks when there is no contact', () => expect(blocked({ contacts: [] })).toMatch(/No contact/));
  it('blocks when no sender name is set', () => expect(blocked({ settings: { ...settings, sender_name: ' ' } })).toMatch(/sender/));
  it('uses the main contact, not a second person who agreed', () => {
    const out = plan(task('2026-11-12'), TODAY, { contacts: [contact({ name: 'Other', mobile: '9375550111', is_primary: false }), contact({ auto_text_ok: false })] });
    expect(out[0].blocked).toMatch(/not agreed/);
  });
  it('normalizes numbers', () => {
    expect(mobileDigits('(937) 555-0100')).toBe('+19375550100');
    expect(mobileDigits('19375550100')).toBe('+19375550100');
    expect(mobileDigits('12345')).toBe('');
  });
});

describe('message wording', () => {
  it('names the person, sender, work, place, dates, and opt-out', () => {
    expect(autoTextBody('notice', 'Pat', 'H3 Office', { name: 'Rough plumbing', start_date: '2026-11-17', end_date: '2026-11-19' }, '100 Ridge Rd'))
      .toBe("Hi Pat, this is H3 Office. You're scheduled for Rough plumbing at 100 Ridge Rd, Tue, Nov 17 to Thu, Nov 19. Can you confirm? Reply STOP to opt out.");
  });
  it('words reminders differently', () => {
    expect(autoTextBody('reminder', '', 'H3', { name: 'Paint', start_date: '2026-11-17', end_date: '2026-11-17' }, 'Oak')).toContain('Reminder: you start Paint at Oak, Tue, Nov 17.');
  });
});

describe('sending hours in Ohio time', () => {
  it('reads Eastern time on any machine, across daylight saving', () => {
    expect(easternClock(new Date('2026-11-10T15:00:00Z'))).toEqual({ date: '2026-11-10', hour: 10, weekday: 2 });
    expect(easternClock(new Date('2026-07-10T15:00:00Z')).hour).toBe(11);
  });
  it('gets the date right late at night', () => {
    expect(easternClock(new Date('2026-11-11T03:00:00Z')).date).toBe('2026-11-10');
  });
  it('holds on weekends, early, and late', () => {
    expect(sendWindowProblem(settings, TUE_10AM)).toBe('');
    expect(sendWindowProblem(settings, new Date('2026-11-14T15:00:00Z'))).toMatch(/Weekend/);
    expect(sendWindowProblem(settings, new Date('2026-11-10T13:59:00Z'))).toMatch(/Outside/);
    expect(sendWindowProblem(settings, new Date('2026-11-10T23:00:00Z'))).toMatch(/Outside/);
  });
});

describe('the locks: nothing leaves unless every one is open', () => {
  const loader = (over: object = {}) => async () => ({ tasks: [task('2026-11-12')], ...base, ...over });
  const harness = (live: boolean, over: object = {}, now = TUE_10AM) => {
    const send = vi.fn(async (_phone: string, _body: string) => {});
    const record = vi.fn(async (_t: unknown, _status: string, _err: string) => {});
    return { send, record, go: () => runAutoTexts({ live, now, load: loader(over), send, record }) };
  };
  it('does nothing with the server switch off, even with the setting on', async () => {
    const h = harness(false);
    const r = await h.go();
    expect(r.state).toBe('off');
    expect(h.send).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });
  it('does nothing with the setting off, even with the server switch on', async () => {
    const h = harness(true, { settings: { ...settings, enabled: false } });
    expect((await h.go()).state).toBe('off');
    expect(h.send).not.toHaveBeenCalled();
  });
  it('does nothing outside sending hours', async () => {
    const h = harness(true, {}, new Date('2026-11-14T15:00:00Z'));
    expect((await h.go()).state).toBe('waiting');
    expect(h.send).not.toHaveBeenCalled();
  });
  it('sends and records when every lock is open', async () => {
    const h = harness(true);
    expect(await h.go()).toEqual({ state: 'ran', reason: '', sent: 1, failed: 0, held: 0 });
    expect(h.send).toHaveBeenCalledWith('+19375550100', expect.stringContaining('Rough plumbing'));
    expect(h.record.mock.calls[0][1]).toBe('accepted');
  });
  it('never sends to someone who has not agreed', async () => {
    const h = harness(true, { contacts: [contact({ auto_text_ok: false })] });
    expect((await h.go()).sent).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });
  it('stops at the daily limit and counts what was held', async () => {
    const tasks = ['a', 'b', 'c'].map((id) => task('2026-11-12', { id }));
    const h = harness(true, { tasks, settings: { ...settings, daily_cap: 2 } });
    expect(await h.go()).toMatchObject({ sent: 2, held: 1 });
    expect(h.send).toHaveBeenCalledTimes(2);
  });
  it('counts texts already sent today toward the limit', async () => {
    const log: LogRow[] = [{ task_id: 'old', kind: 'notice', start_date: '2026-11-20', vendor_id: 'v', status: 'accepted', created_at: '2026-11-10T14:30:00Z' }];
    const h = harness(true, { log, settings: { ...settings, daily_cap: 1 } });
    expect((await h.go()).sent).toBe(0);
  });
  it('records a failure, keeps going, and gives up after three tries', async () => {
    const tasks = [task('2026-11-12', { id: 'a' }), task('2026-11-12', { id: 'b' })];
    const send = vi.fn().mockRejectedValueOnce(new Error('Kixie down')).mockResolvedValue(undefined);
    const record = vi.fn(async (_t: unknown, _status: string, _err: string) => {});
    const r = await runAutoTexts({ live: true, now: TUE_10AM, load: loader({ tasks }), send, record });
    expect(r).toMatchObject({ sent: 1, failed: 1 });
    expect(record.mock.calls[0]).toEqual([expect.anything(), 'failed', 'Kixie down']);
    const log: LogRow[] = [1, 2, 3].map(() => ({ task_id: 't', kind: 'reminder', start_date: '2026-11-11', vendor_id: 'v', status: 'failed', created_at: '2026-11-09T15:00:00Z' }));
    const h = harness(true, { tasks: [task('2026-11-11')], log });
    expect((await h.go()).sent).toBe(0);
  });
  it('builds the Kixie request with the key out of the text body', () => {
    const { url, init } = kixieRequest({ url: 'https://k.test/e', apiKey: 'K', businessId: '1', senderEmail: 'a@b.c' }, '+19375550100', 'Hi');
    expect(url).toBe('https://k.test/e?apikey=K');
    expect(JSON.parse(init.body)).toEqual({ businessid: '1', email: 'a@b.c', target: '9375550100', eventname: 'sms', message: 'Hi', apikey: 'K' });
  });
});
