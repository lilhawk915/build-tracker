import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FormModal, money } from '../../components/ui';
import { store, useData } from '../../data';
import { LEAD_KINDS, LEAD_STAGES, appointmentIcs, appointmentText, formatPhone, leadValue, stageLabel } from '../../domain/leads';
import { todayIso } from '../../domain/rules';
import { starterBudget, starterSchedule } from '../../domain/templates';
import { JOB_TYPES, isNewHouse, type JobType, type Lead, type LeadAppointment, type LeadKind, type LeadStage } from '../../domain/types';
import { NumberCell, TextBlock, TextCell, downloadFile, safeName } from '../../estimator/ui';

/** Admins only. One lead: who they are, what they want, appointments, and a log of every talk. */
export function LeadPage() {
  const { leadId } = useParams();
  const { data, run } = useData();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const [making, setMaking] = useState(false);
  const [entry, setEntry] = useState('');
  const lead = data.leads.find((l) => l.id === leadId);
  if (!lead) return <div className="alert" role="alert">This lead no longer exists. <Link to="/leads">Back to leads</Link></div>;

  const today = todayIso();
  const job = data.jobs.find((j) => j.id === lead.job_id);
  const appts = data.lead_appointments.filter((a) => a.lead_id === lead.id)
    .sort((a, b) => (a.appt_date + (a.appt_time ?? '')).localeCompare(b.appt_date + (b.appt_time ?? '')));
  const value = leadValue(lead);
  const set = (patch: Partial<Lead>, done?: string) => run(() => store.update('leads', lead.id, patch), done);
  const text = (label: string, key: 'name' | 'email' | 'address' | 'county' | 'source' | 'deal_terms' | 'next_step' | 'lost_reason') => (
    <div className="inrow"><span>{label}</span><TextCell className="field" label={label} value={lead[key]} onCommit={(v) => set({ [key]: v.trim() })} /></div>
  );

  const addLog = async () => {
    const t = entry.trim();
    if (!t) return;
    if (await set({ log: [{ at: new Date().toISOString(), text: t }, ...(lead.log ?? [])] }, 'Added to the log.')) setEntry('');
  };
  const calendar = (a: LeadAppointment) =>
    downloadFile(`Meet_${safeName(lead.name)}_${a.appt_date}.ics`, new Blob([appointmentIcs(lead, a)], { type: 'text/calendar' }));

  return (
    <div className="stack">
      <Link to="/leads">← All leads</Link>
      <div className="panel estimatehead">
        <h1 style={{ margin: 0 }}>{lead.name || 'New lead'} <span className="chip">{stageLabel(lead.stage)}</span></h1>
        {text('Name', 'name')}
        <div className="inrow">
          <span>Phone</span>
          <span className="row nowrap">
            <TextCell className="field" label="Phone" value={lead.phone} onCommit={(v) => set({ phone: v.trim() ? formatPhone(v) : '' })} />
            {lead.phone && <a className="btn tiny" href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}>Call</a>}
          </span>
        </div>
        {text('Email', 'email')}
        <div className="inrow">
          <span>Type</span>
          <select aria-label="Type" value={lead.kind} onChange={(e) => void set({ kind: e.target.value as LeadKind })}>
            {LEAD_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div className="inrow">
          <span>Stage</span>
          <select aria-label="Stage" value={lead.stage} onChange={(e) => void set({ stage: e.target.value as LeadStage }, `Moved to ${stageLabel(e.target.value as LeadStage)}.`)}>
            {LEAD_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {lead.stage === 'lost' && text('Why lost', 'lost_reason')}
        {text('Lot or property', 'address')}
        {text('County', 'county')}
        {text('Came from', 'source')}
        <div className="inrow"><span>Houses</span><NumberCell className="field num" label="Houses" value={lead.houses} min={1} decimals={0} onCommit={(v) => set({ houses: Math.max(1, Math.round(v ?? 1)) })} /></div>
        <div className="inrow"><span>Profit per house ($)</span><NumberCell className="field num" label="Profit per house" nullable placeholder="Not set" value={lead.profit_per_house_cents == null ? null : lead.profit_per_house_cents / 100} onCommit={(v) => set({ profit_per_house_cents: v == null ? null : Math.round(v * 100) })} /></div>
        {text('Deal terms', 'deal_terms')}
        {text('Next step', 'next_step')}
        <div className="inrow"><span>Next step date</span><TextCell className="field" type="date" label="Next step date" value={lead.next_date ?? ''} onCommit={(v) => set({ next_date: v || null })} /></div>
        <dl className="figs strip">
          <div><dt>Houses</dt><dd>{lead.houses}</dd></div>
          <div><dt>Projected profit</dt><dd>{value == null ? 'Not set' : money(value)}</dd></div>
          <div><dt>Added</dt><dd>{lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-US') : ''}</dd></div>
        </dl>
      </div>

      <section className="panel stack" aria-label="Appointments">
        <div className="row between">
          <h3>Appointments</h3>
          <button className="btn" onClick={() => setAdding(true)}>Add an appointment</button>
        </div>
        {appts.length === 0 ? <p className="muted small">No appointments yet.</p> : (
          <ul className="plain stack" style={{ gap: 8 }}>
            {appts.map((a) => (
              <li key={a.id} className={`row between appt-row${a.appt_date < today ? ' past' : ''}`}>
                <span>
                  <b>{appointmentText(a)}</b>{a.appt_date < today ? ' (past)' : ''}
                  {a.place && ` · ${a.place}`}{a.who && ` · ${a.who} going`}
                  {a.notes && <span className="muted small"> · {a.notes}</span>}
                </span>
                <span className="row">
                  <button className="btn tiny" onClick={() => calendar(a)}>Add to calendar</button>
                  <button className="btn tiny danger" aria-label={`Remove appointment on ${appointmentText(a)}`} onClick={() => {
                    if (window.confirm('Remove this appointment?')) void run(() => store.remove('lead_appointments', a.id), 'Appointment removed.');
                  }}>Remove</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel stack" aria-label="Notes and log">
        <h3>What they want</h3>
        <TextBlock label="What they want" rows={4} value={lead.notes} onCommit={(v) => set({ notes: v })} />
        <h3>Log</h3>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void addLog(); }}>
          <input aria-label="Log entry" style={{ flex: 1, minWidth: 200 }} value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="Called, left a voicemail…" />
          <button className="btn" disabled={!entry.trim()}>Add to log</button>
        </form>
        {(lead.log ?? []).length > 0 && (
          <ul className="plain">
            {lead.log.map((e, n) => <li key={n}><span className="muted small">{new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span> {e.text}</li>)}
          </ul>
        )}
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
          if (!window.confirm(`Delete the lead "${lead.name}" and its appointments? This cannot be undone.`)) return;
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
            if (!v.appt_date) throw new Error('Pick a date for the appointment.');
            const ok = await run(async () => {
              await store.insert('lead_appointments', { lead_id: lead.id, appt_date: v.appt_date as string, appt_time: (v.appt_time as string) || null, place: String(v.place ?? '').trim(), who: String(v.who ?? '').trim(), notes: String(v.notes ?? '').trim() });
              if (lead.stage === 'new') await store.update('leads', lead.id, { stage: 'appointment' });
            }, 'Appointment added.');
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
