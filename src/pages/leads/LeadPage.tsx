import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FormModal, money } from '../../components/ui';
import { store, useData } from '../../data';
import { LEAD_KINDS, LEAD_STAGES, QUICK_LOGS, addDays, appointmentIcs, appointmentText, dateText, followUp, formatPhone, googleCalendarUrl, kindLabel, leadValue, stageLabel } from '../../domain/leads';
import { todayIso } from '../../domain/rules';
import { starterBudget, starterSchedule } from '../../domain/templates';
import { JOB_TYPES, isNewHouse, type JobType, type Lead, type LeadAppointment, type LeadKind } from '../../domain/types';
import { NumberCell, TextBlock, TextCell, downloadFile, safeName } from '../../estimator/ui';

const Field = ({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) => (
  <div className={`leadfield${wide ? ' wide' : ''}`}><span>{label}</span>{children}</div>
);

/** Admins only. One lead: who they are, where it stands, what's next, meetings, and a log of every talk. */
export function LeadPage() {
  const { leadId } = useParams();
  const [params, setParams] = useSearchParams();
  const { data, run } = useData();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const [making, setMaking] = useState(false);
  const [entry, setEntry] = useState('');
  const nextRef = useRef<HTMLDivElement>(null);
  const justAdded = params.get('new') === '1';
  useEffect(() => {
    if (justAdded) nextRef.current?.querySelector('input')?.focus();
  }, [justAdded, leadId]);

  const lead = data.leads.find((l) => l.id === leadId);
  if (!lead) return <div className="alert" role="alert">This lead no longer exists. <Link to="/leads">Back to leads</Link></div>;

  const today = todayIso();
  const job = data.jobs.find((j) => j.id === lead.job_id);
  const appts = data.lead_appointments.filter((a) => a.lead_id === lead.id)
    .sort((a, b) => (a.appt_date + (a.appt_time ?? '')).localeCompare(b.appt_date + (b.appt_time ?? '')));
  const value = leadValue(lead);
  const due = followUp(lead, today);
  const digits = lead.phone.replace(/[^\d+]/g, '');
  const set = (patch: Partial<Lead>, done?: string) => run(() => store.update('leads', lead.id, patch), done);
  const text = (label: string, key: 'name' | 'email' | 'address' | 'county' | 'source' | 'deal_terms' | 'lost_reason', wide = false) => (
    <Field label={label} wide={wide}><TextCell className="field" label={label} value={lead[key]} onCommit={(v) => set({ [key]: v.trim() })} /></Field>
  );
  const phoneBox = <TextCell className="field" label="Phone" value={lead.phone} onCommit={(v) => set({ phone: v.trim() ? formatPhone(v) : '' })} />;

  const log = (t: string, done = 'Added to the log.') => set({ log: [{ at: new Date().toISOString(), text: t }, ...(lead.log ?? [])] }, done);
  const addLog = async () => {
    const t = entry.trim();
    if (t && (await log(t))) setEntry('');
  };
  const finishStep = () => set({
    next_step: '', next_date: null,
    log: [{ at: new Date().toISOString(), text: `Done: ${lead.next_step || 'follow-up'}` }, ...(lead.log ?? [])],
  }, 'Nice. Marked done and put in the log. What\'s next?');
  const calendar = (a: LeadAppointment) =>
    downloadFile(`Meet_${safeName(lead.name)}_${a.appt_date}.ics`, new Blob([appointmentIcs(lead, a)], { type: 'text/calendar' }));
  const when = [
    { label: 'Today', day: today }, { label: 'Tomorrow', day: addDays(today, 1) },
    { label: 'In 3 days', day: addDays(today, 3) }, { label: 'Next week', day: addDays(today, 7) },
  ];

  return (
    <div className="stack">
      <Link to="/leads">← All leads</Link>

      <section className="panel leadhead" aria-label="Lead">
        <div>
          <h1>{lead.name || 'New lead'}</h1>
          <p className="muted">
            {kindLabel(lead.kind)}{lead.houses > 1 ? ` · ${lead.houses} houses` : ''}{lead.county ? ` · ${lead.county} County` : ''}
            {value != null && <> · <b>{money(value)} projected profit</b></>}
          </p>
        </div>
        <div className="row contactbtns">
          {digits ? (
            <>
              <a className="btn primary big" href={`tel:${digits}`}>Call {lead.phone}</a>
              <a className="btn big" href={`sms:${digits}`}>Text</a>
            </>
          ) : (
            <label className="row addphone"><span>Add their phone:</span>{phoneBox}</label>
          )}
          {lead.email && <a className="btn big" href={`mailto:${lead.email}`}>Email</a>}
        </div>
      </section>

      {justAdded && (
        <div className="alert calm" role="status">
          Saved. Now jot down the next step so it doesn't slip.{' '}
          <button className="linkish" onClick={() => setParams({}, { replace: true })}>Got it</button>
        </div>
      )}

      <section className="panel stack" aria-label="Where it stands">
        <h3>Where it stands</h3>
        <div className="stagebar" role="group" aria-label="Stage">
          {LEAD_STAGES.map((s) => (
            <button
              key={s.value}
              className={`btn${s.value === lead.stage ? ' on' : ''}${s.value === 'lost' ? ' lostbtn' : ''}`}
              aria-pressed={s.value === lead.stage}
              onClick={() => { if (s.value !== lead.stage) void set({ stage: s.value }, `Moved to ${s.label}.`); }}
            >{s.label}</button>
          ))}
        </div>
        {lead.stage === 'lost' && text('Why did we lose it?', 'lost_reason', true)}
      </section>

      <section className={`panel stack nextstep${due ? ` ${due}` : ''}`} aria-label="What's next" ref={nextRef}>
        <div className="row between">
          <h3>What's next?</h3>
          {due === 'late' && <span className="chip bad">Late, was due {dateText(lead.next_date)}</span>}
          {due === 'today' && <span className="chip warn">Due today</span>}
        </div>
        <TextCell className="field" label="Next step" placeholder="Call back about plans, send the quote, walk the lot…" value={lead.next_step} onCommit={(v) => set({ next_step: v.trim() })} />
        <div className="row">
          <span className="muted small">When:</span>
          {when.map((w) => (
            <button key={w.label} className={`btn tiny${lead.next_date === w.day ? ' on' : ''}`} onClick={() => void set({ next_date: w.day }, `Next step set for ${dateText(w.day)}.`)}>{w.label}</button>
          ))}
          <TextCell className="field datebox" type="date" label="Next step date" value={lead.next_date ?? ''} onCommit={(v) => set({ next_date: v || null })} />
        </div>
        {(lead.next_step || lead.next_date) && (
          <div className="row">
            <button className="btn" onClick={() => void finishStep()}>✓ Done</button>
            <span className="muted small">Puts it in the log and clears it, so you can write the next one.</span>
          </div>
        )}
      </section>

      <section className="panel stack" aria-label="Appointments">
        <div className="row between">
          <h3>Meetings</h3>
          <button className="btn" onClick={() => setAdding(true)}>+ Add an appointment</button>
        </div>
        {appts.length === 0 ? <p className="muted small">No meetings yet.</p> : (
          <ul className="plain stack" style={{ gap: 8 }}>
            {appts.map((a) => (
              <li key={a.id} className={`row between appt-row${a.appt_date < today ? ' past' : ''}`}>
                <span>
                  <b>{appointmentText(a)}</b>{a.appt_date < today ? ' (past)' : ''}
                  {a.place && ` · ${a.place}`}{a.who && ` · ${a.who} going`}
                  {a.notes && <span className="muted small"> · {a.notes}</span>}
                </span>
                <span className="row">
                  <a className="btn tiny" href={googleCalendarUrl(lead, a)} target="_blank" rel="noreferrer">Add to Google Calendar</a>
                  <button className="btn tiny" onClick={() => calendar(a)}>Add to calendar</button>
                  <button className="btn tiny danger" aria-label={`Remove appointment on ${appointmentText(a)}`} onClick={() => {
                    if (window.confirm('Remove this meeting?')) void run(() => store.remove('lead_appointments', a.id), 'Meeting removed.');
                  }}>Remove</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel stack" aria-label="Log">
        <h3>Log</h3>
        <div className="row">
          {QUICK_LOGS.map((q) => <button key={q} className="btn tiny" onClick={() => void log(q)}>{q}</button>)}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void addLog(); }}>
          <input aria-label="Log entry" style={{ flex: 1, minWidth: 200 }} value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="Or type what happened…" />
          <button className="btn" disabled={!entry.trim()}>Add to log</button>
        </form>
        {(lead.log ?? []).length > 0 && (
          <ul className="plain loglist">
            {lead.log.map((e, n) => <li key={n}><span className="muted small">{new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span> {e.text}</li>)}
          </ul>
        )}
      </section>

      <section className="panel stack" aria-label="What they want">
        <h3>What they want</h3>
        <TextBlock label="What they want" rows={4} value={lead.notes} onCommit={(v) => set({ notes: v })} />
      </section>

      <section className="panel stack" aria-label="Details">
        <h3>Details</h3>
        <div className="leadfields">
          {text('Name', 'name')}
          {digits ? <Field label="Phone">{phoneBox}</Field> : null}
          {text('Email', 'email')}
          <Field label="Type">
            <select aria-label="Type" value={lead.kind} onChange={(e) => void set({ kind: e.target.value as LeadKind })}>
              {LEAD_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </Field>
          {text('Lot or property', 'address')}
          {text('County', 'county')}
          {text('Came from', 'source')}
          <Field label="Houses"><NumberCell className="field num" label="Houses" value={lead.houses} min={1} decimals={0} onCommit={(v) => set({ houses: Math.max(1, Math.round(v ?? 1)) })} /></Field>
          <Field label="Profit per house ($)"><NumberCell className="field num" label="Profit per house" nullable placeholder="Not set" value={lead.profit_per_house_cents == null ? null : lead.profit_per_house_cents / 100} onCommit={(v) => set({ profit_per_house_cents: v == null ? null : Math.round(v * 100) })} /></Field>
          {text('Deal terms', 'deal_terms', true)}
        </div>
        <p className="muted small">Projected profit: <b>{value == null ? 'not set' : money(value)}</b> · Added {lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-US') : ''}</p>
      </section>

      <section className="panel stack" aria-label="Job">
        <h3>Job</h3>
        {job ? (
          <p>This lead is the job <Link to={`/jobs/${job.id}`}>{job.name}</Link>.</p>
        ) : (
          <div className="row">
            <button className="btn primary" onClick={() => setMaking(true)}>Make it a job</button>
            <span className="muted small">When it's a sure thing. It marks the lead won and sets up the job.</span>
          </div>
        )}
      </section>

      <p className="muted small">
        <button className="linkish danger" onClick={async () => {
          if (!window.confirm(`Delete the lead "${lead.name}" and its meetings? This cannot be undone.`)) return;
          if (await run(() => store.remove('leads', lead.id), 'Lead deleted.')) nav('/leads');
        }}>Delete this lead</button>
      </p>

      {adding && (
        <FormModal
          title="Add an appointment"
          submit="Add appointment"
          fields={[
            { key: 'appt_date', label: 'Date', type: 'date', required: true },
            { key: 'appt_time', label: 'Time', type: 'time', help: 'Leave blank if the time isn\'t set yet.' },
            { key: 'place', label: 'Where', help: 'The lot, the office, a phone call…' },
            { key: 'who', label: "Who's going" },
            { key: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          initial={{ appt_date: today, place: lead.address }}
          onClose={() => setAdding(false)}
          onSave={async (v) => {
            if (!v.appt_date) throw new Error('Pick a date for the meeting.');
            const ok = await run(async () => {
              await store.insert('lead_appointments', { lead_id: lead.id, appt_date: v.appt_date as string, appt_time: (v.appt_time as string) || null, place: String(v.place ?? '').trim(), who: String(v.who ?? '').trim(), notes: String(v.notes ?? '').trim() });
              if (lead.stage === 'new') await store.update('leads', lead.id, { stage: 'appointment' });
            }, 'Meeting added. Tap "Add to Google Calendar" to save it and invite your team.');
            if (ok) setAdding(false);
          }}
        />
      )}
      {making && (
        <FormModal
          title="Make it a job"
          submit="Make the job"
          intro={<p>This marks <b>{lead.name}</b> as won and sets up the job.{lead.houses > 1 ? ` This lead is ${lead.houses} houses. Make one job now; add the others from Today when they start.` : ''}</p>}
          fields={[
            { key: 'name', label: 'Job name', required: true },
            { key: 'address', label: 'Address' },
            { key: 'job_type', label: 'Type', type: 'select', options: JOB_TYPES },
            { key: 'status', label: 'Status', type: 'select', options: [{ value: 'planning', label: 'Planning' }, { value: 'active', label: 'Active' }] },
            { key: 'sale_price_cents', label: 'Contract or expected sale price', type: 'money' },
            { key: 'template', label: 'New house: start with the standard budget and schedule', type: 'check' },
          ]}
          initial={{ name: lead.address ? `${lead.address} - ${lead.name}` : lead.name, address: lead.address, job_type: lead.kind === 'remodel' ? 'remodel' : 'client', status: 'planning', sale_price_cents: 0, template: true }}
          onClose={() => setMaking(false)}
          onSave={async (v) => {
            const id = crypto.randomUUID();
            const type = v.job_type as JobType;
            const ok = await run(async () => {
              await store.insert('jobs', {
                id, name: String(v.name).trim(), address: String(v.address ?? '').trim(), job_type: type, status: v.status, sale_price_cents: v.sale_price_cents,
                start_date: today, client_name: lead.name, client_phone: lead.phone, client_email: lead.email, notes: lead.notes,
              } as never);
              if (v.template && isNewHouse(type)) {
                await store.insert('budget_lines', starterBudget(id));
                await store.insert('tasks', starterSchedule(id, today));
              } else {
                await store.insert('budget_lines', { job_id: id, code: '01', name: 'General', budget_cents: 0, bought_out: false, sort: 0 });
              }
              await store.update('leads', lead.id, { job_id: id, stage: 'won' });
            }, `${lead.name} is won. The job is set up.`);
            if (ok) { setMaking(false); nav(`/jobs/${id}`); }
          }}
        />
      )}
    </div>
  );
}
