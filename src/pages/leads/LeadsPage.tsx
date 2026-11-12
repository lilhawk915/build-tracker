import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, money } from '../../components/ui';
import { store, useData } from '../../data';
import { LEAD_KINDS, LEAD_STAGES, appointmentText, dateText, followUp, kindLabel, leadValue, nextAppointment, pipeline, quickLead } from '../../domain/leads';
import { todayIso } from '../../domain/rules';
import type { Lead, LeadStage } from '../../domain/types';

const FOLLOW_WORD = { late: 'Late', today: 'Today', soon: 'Soon' } as const;
const FOLLOW_CHIP = { late: 'bad', today: 'warn', soon: '' } as const;

/** Admins only. Every lead on one board, one column per stage. */
export function LeadsPage() {
  const { data, run } = useData();
  const nav = useNavigate();
  const today = todayIso();
  const [typed, setTyped] = useState('');
  const [kind, setKind] = useState('');
  const leads = data.leads.filter((l) => !kind || l.kind === kind);
  const totals = pipeline(leads);

  const add = async () => {
    const text = typed.trim();
    if (!text) return;
    const id = crypto.randomUUID();
    const ok = await run(() => store.insert('leads', { id, ...quickLead(text), stage: 'new' }), 'Lead added. Fill in the rest when you can.');
    if (ok) { setTyped(''); nav(`/leads/${id}`); }
  };
  const move = (l: Lead, stage: LeadStage) => run(() => store.update('leads', l.id, { stage }), `${l.name} moved to ${LEAD_STAGES.find((s) => s.value === stage)?.label}.`);

  const card = (l: Lead) => {
    const due = followUp(l, today);
    const appt = nextAppointment(data.lead_appointments, l.id, today);
    const value = leadValue(l);
    return (
      <li key={l.id} className="leadcard">
        <Link to={`/leads/${l.id}`} className="leadname">{l.name || 'No name yet'}</Link>
        <span className="muted small">{kindLabel(l.kind)}{l.houses > 1 ? ` · ${l.houses} houses` : ''}{l.county ? ` · ${l.county}` : ''}</span>
        {value != null && <span className="small"><b>{money(value)}</b> projected profit</span>}
        {appt && <span className="small appt">Meet {appointmentText(appt)}</span>}
        {(l.next_step || l.next_date) && (
          <span className="small">
            {due && <span className={`chip ${FOLLOW_CHIP[due]}`}>{FOLLOW_WORD[due]}</span>} {l.next_step}{l.next_date ? ` (${dateText(l.next_date)})` : ''}
          </span>
        )}
        {l.job_id && <span className="small">Job: <Link to={`/jobs/${l.job_id}`}>{data.jobs.find((j) => j.id === l.job_id)?.name ?? 'open'}</Link></span>}
        <select aria-label={`Stage for ${l.name}`} className="small" value={l.stage} onChange={(e) => void move(l, e.target.value as LeadStage)}>
          {LEAD_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </li>
    );
  };

  const column = (stage: LeadStage, label: string) => {
    const rows = leads.filter((l) => l.stage === stage).sort((a, b) => (a.next_date ?? '9999').localeCompare(b.next_date ?? '9999') || a.name.localeCompare(b.name));
    return (
      <section key={stage} className="leadcol" aria-label={`${label} (${rows.length})`}>
        <h2>{label} <span className="muted">{rows.length}</span></h2>
        {rows.length ? <ul>{rows.map(card)}</ul> : <p className="muted small">None</p>}
      </section>
    );
  };
  const lost = leads.filter((l) => l.stage === 'lost');

  return (
    <div className="stack">
      <div className="row between">
        <h1>Leads</h1>
        <select aria-label="Show lead type" style={{ width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Every type</option>
          {LEAD_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <form className="row quickadd" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input aria-label="New lead" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type it like a text: Sam Smith, new build in Greene County, 937-555-0100" />
        <button className="btn primary" disabled={!typed.trim()}>Add lead</button>
      </form>
      <p className="muted small" aria-label="Pipeline totals">
        {totals.open} open lead{totals.open === 1 ? '' : 's'} · {totals.houses} house{totals.houses === 1 ? '' : 's'} · <b>{money(totals.profit)}</b> projected profit
        {totals.unpriced > 0 && ` (${totals.unpriced} with no profit set yet)`}
      </p>
      {data.leads.length === 0 ? <Empty>Type your first lead above. A name and a few words are enough.</Empty> : (
        <div className="leadboard">
          {LEAD_STAGES.filter((s) => s.value !== 'lost').map((s) => column(s.value, s.label))}
        </div>
      )}
      {lost.length > 0 && (
        <details>
          <summary>Lost ({lost.length})</summary>
          <ul className="plain">
            {lost.map((l) => <li key={l.id}><Link to={`/leads/${l.id}`}>{l.name}</Link>{l.lost_reason ? ` · ${l.lost_reason}` : ''}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
