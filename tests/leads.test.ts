import { describe, expect, it } from 'vitest';
import { appointmentIcs, appointmentText, followUp, formatPhone, leadValue, nextAppointment, pipeline, quickLead, timeText } from '../src/domain/leads';
import type { Lead, LeadAppointment } from '../src/domain/types';

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 'l1', name: 'Sample Client', phone: '', email: '', kind: 'custom_home', stage: 'new', address: '', county: '',
  houses: 1, profit_per_house_cents: null, deal_terms: '', source: '', next_step: '', next_date: null, lost_reason: '',
  notes: '', log: [], job_id: null, estimate_id: null, created_at: '', updated_at: '', ...over,
});
const appt = (over: Partial<LeadAppointment> = {}): LeadAppointment => ({
  id: 'a1', lead_id: 'l1', appt_date: '2026-11-15', appt_time: '13:30:00', place: '100 Sample Rd', who: 'Ryan', notes: '', ...over,
});

describe('quick add', () => {
  it('pulls the name, phone and house count out of a typed line, and keeps all of it in the notes', () => {
    const typed = '5 lots being bought by Sam Sample - 555-532-2471 wants to split profit or $30k a build';
    const l = quickLead(typed);
    expect(l.phone).toBe('555-532-2471');
    expect(l.houses).toBe(5);
    expect(l.notes).toBe(typed);
  });
  it('takes the name from before the first comma or number', () => {
    expect(quickLead('Sam Sample, new build in Greene County').name).toBe('Sam Sample');
    expect(quickLead('Sam Sample 937 555 0100 barndominium').name).toBe('Sam Sample');
    expect(quickLead('Sam Sample - possible duplex').name).toBe('Sam Sample');
  });
  it('finds an email, and never leaves the name blank', () => {
    const l = quickLead('sam@example.com');
    expect(l.email).toBe('sam@example.com');
    expect(l.name).not.toBe('');
    expect(quickLead('potential 15 houses in a subdivision').houses).toBe(15);
  });
});

describe('lead money and dates', () => {
  it('values a lead at houses times profit per house', () => {
    expect(leadValue(lead({ houses: 5, profit_per_house_cents: 3000000 }))).toBe(15000000);
    expect(leadValue(lead())).toBeNull();
  });
  it('totals only open leads', () => {
    const t = pipeline([
      lead({ houses: 5, profit_per_house_cents: 3000000 }),
      lead({ houses: 15 }),
      lead({ stage: 'won', houses: 2, profit_per_house_cents: 100 }),
      lead({ stage: 'lost', houses: 3 }),
    ]);
    expect(t).toEqual({ open: 2, houses: 20, profit: 15000000, unpriced: 1 });
  });
  it('flags late, today and soon follow-ups, but not on won or lost leads', () => {
    const today = '2026-11-12';
    expect(followUp(lead({ next_date: '2026-11-10' }), today)).toBe('late');
    expect(followUp(lead({ next_date: today }), today)).toBe('today');
    expect(followUp(lead({ next_date: '2026-11-15' }), today)).toBe('soon');
    expect(followUp(lead({ next_date: '2026-11-30' }), today)).toBeNull();
    expect(followUp(lead({ next_date: '2026-11-10', stage: 'won' }), today)).toBeNull();
  });
  it('picks the next appointment from today on, earliest first', () => {
    const list = [appt({ id: 'old', appt_date: '2026-11-01' }), appt({ id: 'b', appt_date: '2026-11-20' }), appt({ id: 'a', appt_date: '2026-11-15' })];
    expect(nextAppointment(list, 'l1', '2026-11-12')?.id).toBe('a');
    expect(nextAppointment(list, 'other', '2026-11-12')).toBeUndefined();
  });
  it('writes times and phones the way people read them', () => {
    expect(timeText('13:30:00')).toBe('1:30 PM');
    expect(timeText('00:05')).toBe('12:05 AM');
    expect(appointmentText(appt())).toBe('Sun, Nov 15, 1:30 PM');
    expect(formatPhone('(937) 555-0100')).toBe('937-555-0100');
    expect(formatPhone('1 937 555 0100')).toBe('937-555-0100');
    expect(formatPhone('ext 12')).toBe('ext 12');
  });
});

describe('calendar file', () => {
  it('makes an hour-long event at the local time, with the place and phone', () => {
    const ics = appointmentIcs(lead({ phone: '937-555-0100' }), appt(), new Date('2026-11-12T15:00:00Z'));
    expect(ics).toContain('DTSTART:20261115T133000');
    expect(ics).toContain('DTEND:20261115T143000');
    expect(ics).toContain('SUMMARY:Meet Sample Client');
    expect(ics).toContain('LOCATION:100 Sample Rd');
    expect(ics).toContain('Phone: 937-555-0100');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
  it('makes an all-day event when there is no time', () => {
    const ics = appointmentIcs(lead(), appt({ appt_time: null, appt_date: '2026-11-30' }));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261130');
    expect(ics).toContain('DTEND;VALUE=DATE:20261201');
  });
  it('escapes commas and semicolons', () => {
    expect(appointmentIcs(lead({ name: 'Sam, Pat; Lee' }), appt())).toContain('SUMMARY:Meet Sam\\, Pat\\; Lee');
  });
});

describe('making it easy', () => {
  it('counts days and knows the next stage', async () => {
    const { addDays, nextStage } = await import('../src/domain/leads');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-11-12', 7)).toBe('2026-11-19');
    expect(nextStage('new')).toBe('appointment');
    expect(nextStage('quoted')).toBe('won');
    expect(nextStage('won')).toBeNull();
    expect(nextStage('lost')).toBeNull();
  });
  it('lists what needs you: late first, then meetings and follow-ups by date, nothing past a week', async () => {
    const { agenda } = await import('../src/domain/leads');
    const today = '2026-11-12';
    const list = agenda(
      [
        lead({ id: 'late', name: 'Late Lead', next_step: 'Call back', next_date: '2026-11-10' }),
        lead({ id: 'meet', name: 'Pat Sample' }),
        lead({ id: 'far', next_step: 'Later', next_date: '2026-12-20' }),
        lead({ id: 'won', stage: 'won', next_date: '2026-11-01' }),
      ],
      [appt({ lead_id: 'meet' }), appt({ id: 'a2', lead_id: 'meet', appt_date: '2026-12-01' })],
      today,
    );
    expect(list.map((x) => x.lead.id)).toEqual(['late', 'meet']);
    expect(list[0].what).toBe('Call back');
    expect(list[1].what).toBe('Meet Pat Sample at 1:30 PM, 100 Sample Rd');
  });
});
