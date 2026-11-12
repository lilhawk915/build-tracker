// Leads: who wants you to build, where each one stands, and what it could be worth.
import type { Lead, LeadAppointment, LeadKind, LeadStage } from './types';

export const LEAD_STAGES: { value: LeadStage; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'appointment', label: 'Appointment set' },
  { value: 'met', label: 'Met / walked it' },
  { value: 'waiting', label: 'Waiting on prices' },
  { value: 'quoted', label: 'Quote sent' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];
export const LEAD_KINDS: { value: LeadKind; label: string }[] = [
  { value: 'custom_home', label: 'Custom home' },
  { value: 'investor', label: 'Investor / partner builds' },
  { value: 'development', label: 'Development (many lots)' },
  { value: 'multi_family', label: 'Multi-family' },
  { value: 'remodel', label: 'Remodel or other work' },
  { value: 'other', label: 'Other' },
];
export const stageLabel = (s: LeadStage) => LEAD_STAGES.find((x) => x.value === s)?.label ?? s;
export const kindLabel = (k: LeadKind) => LEAD_KINDS.find((x) => x.value === k)?.label ?? k;
export const isOpenLead = (l: Pick<Lead, 'stage'>) => l.stage !== 'won' && l.stage !== 'lost';

/** What the lead could make you: houses × profit per house, in cents. Null when no profit is set. */
export const leadValue = (l: Pick<Lead, 'houses' | 'profit_per_house_cents'>) =>
  l.profit_per_house_cents == null ? null : Math.max(1, Number(l.houses) || 1) * Number(l.profit_per_house_cents);

/** Formats a 10-digit US number as 937-555-0100. Anything else is left as typed. */
export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : raw.trim();
}

const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const EMAIL = /[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}/i;
const HOUSES = /(\d{1,4})\s*(?:houses|homes|lots|units|builds|duplexes|triplexes|townhomes)\b/i;

/** Turns one typed line ("James O'Leary 5 lots 845-532-2471 split profit") into a new lead. Nothing typed is lost: it all goes in the notes. */
export function quickLead(text: string): Pick<Lead, 'name' | 'phone' | 'email' | 'houses' | 'notes'> {
  const typed = text.trim().replace(/\s+/g, ' ');
  const phone = typed.match(PHONE)?.[0] ?? '';
  const email = typed.match(EMAIL)?.[0] ?? '';
  const houses = Number(typed.match(HOUSES)?.[1] ?? 1) || 1;
  // A comma where the phone or email was, so the name stops there.
  let rest = phone ? typed.replace(phone, ',') : typed;
  if (email) rest = rest.replace(email, ',');
  // The name is what comes before the first comma, dash, colon or number.
  let name = rest.split(/[,;:(]|\s[-–—]\s|\d/)[0].trim().replace(/[\s.-]+$/, '');
  if (!name) name = rest.replace(/^[\s,]+|[\s,]+$/g, '').slice(0, 60);
  if (name.length > 60) name = `${name.slice(0, 57).trim()}…`;
  return { name: name || 'New lead', phone: phone ? formatPhone(phone) : '', email, houses, notes: typed };
}

/** Where the lead's next step stands against today: late, due today, or in the next 3 days. */
export function followUp(l: Pick<Lead, 'stage' | 'next_date'>, today: string): 'late' | 'today' | 'soon' | null {
  if (!isOpenLead(l) || !l.next_date) return null;
  if (l.next_date < today) return 'late';
  if (l.next_date === today) return 'today';
  const soon = new Date(`${today}T12:00:00`);
  soon.setDate(soon.getDate() + 3);
  return l.next_date <= soon.toISOString().slice(0, 10) ? 'soon' : null;
}

/** The lead's next appointment from today on, if any. */
export function nextAppointment(appts: LeadAppointment[], leadId: string, today: string): LeadAppointment | undefined {
  return appts
    .filter((a) => a.lead_id === leadId && a.appt_date >= today)
    .sort((a, b) => (a.appt_date + (a.appt_time ?? '')).localeCompare(b.appt_date + (b.appt_time ?? '')))[0];
}

/** "13:30:00" → "1:30 PM". */
export function timeText(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2026-11-15" → "Sun, Nov 15". */
export function dateText(d: string | null): string {
  if (!d) return '';
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export const appointmentText = (a: Pick<LeadAppointment, 'appt_date' | 'appt_time'>) =>
  [dateText(a.appt_date), timeText(a.appt_time)].filter(Boolean).join(', ');

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/**
 * A calendar file for one appointment, so it can be added to a phone's calendar. Nothing is sent to anyone.
 * A time is "floating": 1:30 PM shows as 1:30 PM on whatever phone opens it. No time means an all-day event.
 */
export function appointmentIcs(lead: Pick<Lead, 'name' | 'phone' | 'address'>, a: LeadAppointment, stamp = new Date()): string {
  const day = a.appt_date.replace(/-/g, '');
  let when: string[];
  if (a.appt_time) {
    const [h, m] = a.appt_time.split(':').map(Number);
    const end = h * 60 + m + 60;
    const t = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}${String(mins % 60).padStart(2, '0')}00`;
    // An hour-long meeting. One that would run past midnight just ends at 11:59 PM.
    when = [`DTSTART:${day}T${t(h * 60 + m)}`, `DTEND:${day}T${end >= 24 * 60 ? '235900' : t(end)}`];
  } else {
    const next = new Date(`${a.appt_date}T12:00:00`);
    next.setDate(next.getDate() + 1);
    when = [`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`];
  }
  const details = [lead.phone && `Phone: ${lead.phone}`, a.who && `Going: ${a.who}`, a.notes].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Build Tracker//Leads//EN', 'BEGIN:VEVENT',
    `UID:${a.id}@build-tracker`,
    `DTSTAMP:${stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    ...when,
    `SUMMARY:${icsEscape(`Meet ${lead.name || 'lead'}`)}`,
    ...(a.place || lead.address ? [`LOCATION:${icsEscape(a.place || lead.address)}`] : []),
    ...(details ? [`DESCRIPTION:${icsEscape(details)}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** Totals for the board: open leads, the houses they could become, and their projected profit. */
export function pipeline(leads: Lead[]) {
  const open = leads.filter(isOpenLead);
  return {
    open: open.length,
    houses: open.reduce((s, l) => s + (Number(l.houses) || 1), 0),
    profit: open.reduce((s, l) => s + (leadValue(l) ?? 0), 0),
    unpriced: open.filter((l) => leadValue(l) == null).length,
  };
}
