import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, money } from '../../components/ui';
import { store, useData } from '../../data';
import { LEAD_KINDS, LEAD_STAGES, agenda, appointmentText, dateText, followUp, kindLabel, leadValue, nextAppointment, nextStage, pipeline, quickLead, stageLabel } from '../../domain/leads';
import { todayIso } from '../../domain/rules';
import type { Lead, LeadStage } from '../../domain/types';

const FOLLOW_WORD = { late: 'Late', today: 'Today', soon: 'Soon', week: 'This week' } as const;
const FOLLOW_CHIP = { late: 'bad', today: 'warn', soon: '', week: '' } as const;
const telOf = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Admins only. Every lead on one board, one column per stage. */
export function LeadsPage() {
  const { data, run } = useData();
  const nav = useNavigate();
  const today = todayIso();
  const [typed, setTyped] = useState('');
  const [kind, setKind] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<LeadStage | null>(null);
  const leads = data.leads.filter((l) => !kind || l.kind === kind);
  const totals = pipeline(leads);
  const todo = agenda(leads, data.lead_appointments, today);

  const add = async () => {
    const text = typed.trim();
    if (!text) return;
    const id = crypto.randomUUID();
    const ok = await run(() => store.insert('leads', { id, ...quickLead(text), stage: 'new' }), 'Lead added.');
    if (ok) { setTyped(''); nav(`/leads/${id}?new=1`); }
  };
  const move = (l: Lead, stage: LeadStage) => {
    if (l.stage === stage) return;
    return run(() => store.update('leads', l.id, { stage }), `${l.name} moved to ${stageLabel(stage)}.`);
  };

  const card = (l: Lead) => {
    const due = followUp(l, today);
    const appt = nextAppointment(data.lead_appointments, l.id, today);
    const value = leadValue(l);
    const next = nextStage(l.stage);
    return (
      <li
        key={l.id}
        className={`leadcard${dragging === l.id ? ' dragging' : ''}`}
        draggable
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; setDragging(l.id); }}
        onDragEnd={() => { setDragging(null); setOver(null); }}
      >
        <Link to={`/leads/${l.id}`} className="leadname">{l.name || 'No name yet'}</Link>
        <span className="muted small">{kindLabel(l.kind)}{l.houses > 1 ? ` · ${l.houses} houses` : ''}{l.county ? ` · ${l.county}` : ''}</span>
        {value != null && <span className="small"><b>{money(value)}</b> profit</span>}
        {appt && <span className="small appt">Meet {appointmentText(appt)}</span>}
        {(l.next_step || l.next_date) && (
          <span className="small">
            {due && <span className={`chip ${FOLLOW_CHIP[due]}`}>{FOLLOW_WORD[due]}</span>} {l.next_step || 'Follow up'}{l.next_date ? ` (${dateText(l.next_date)})` : ''}
          </span>
        )}
        {l.job_id && <span className="small">Job: <Link to={`/jobs/${l.job_id}`}>{data.jobs.find((j) => j.id === l.job_id)?.name ?? 'open'}</Link></span>}
        <span className="cardbtns">
          {l.phone && <a className="btn tiny" href={telOf(l.phone)} aria-label={`Call ${l.name}`}>Call</a>}
          {next && <button className="btn tiny" onClick={() => void move(l, next)} aria-label={`Move ${l.name} to ${stageLabel(next)}`}>{stageLabel(next)} →</button>}
        </span>
      </li>
    );
  };

  const column = (stage: LeadStage, label: string) => {
    const rows = leads.filter((l) => l.stage === stage).sort((a, b) => (a.next_date ?? '9999').localeCompare(b.next_date ?? '9999') || a.name.localeCompare(b.name));
    return (
      <section
        key={stage}
        className={`leadcol${rows.length ? '' : ' empty'}${over === stage ? ' over' : ''}`}
        aria-label={`${label} (${rows.length})`}
        onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(stage); } }}
        onDragLeave={() => setOver((s) => (s === stage ? null : s))}
        onDrop={(e) => {
          e.preventDefault();
          const l = data.leads.find((x) => x.id === e.dataTransfer.getData('text/plain'));
          setDragging(null); setOver(null);
          if (l) void move(l, stage);
        }}
      >
        <h2>{label} <span className="muted">{rows.length}</span></h2>
        {rows.length ? <ul>{rows.map(card)}</ul> : <p className="muted small">{dragging ? 'Drop here' : 'None'}</p>}
      </section>
    );
  };
  const lost = leads.filter((l) => l.stage === 'lost');

  return (
    <div className="stack">
      <div className="row between">
        <h1>Leads</h1>
        {data.leads.length > 0 && (
          <select aria-label="Show lead type" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Every type</option>
            {LEAD_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        )}
      </div>

      <form className="panel quickadd" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label htmlFor="newlead"><b>Got a new lead?</b> Type it the way you'd text it. Name, phone and a few words is plenty.</label>
        <div className="row">
          <input id="newlead" aria-label="New lead" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Sam Smith 937-555-0100 wants a barndominium in Adams County" />
          <button className="btn primary" disabled={!typed.trim()}>+ Add lead</button>
        </div>
      </form>

      {todo.length > 0 && (
        <section className="panel todo" aria-label="Do these next">
          <h2>Do these next</h2>
          <ul className="plain">
            {todo.map((t, n) => (
              <li key={n} className="row">
                <span className={`chip ${FOLLOW_CHIP[t.due]}`}>{t.due === 'late' ? 'Late' : dateText(t.date.slice(0, 10))}</span>
                <span><Link to={`/leads/${t.lead.id}`}>{t.meet ? t.what : `${t.lead.name}: ${t.what}`}</Link></span>
                {!t.meet && t.lead.phone ? <a className="btn tiny" href={telOf(t.lead.phone)}>Call</a> : <span />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="muted small" aria-label="Pipeline totals">
        {totals.open} open lead{totals.open === 1 ? '' : 's'} · {totals.houses} house{totals.houses === 1 ? '' : 's'} · <b>{money(totals.profit)}</b> projected profit
        {totals.unpriced > 0 && ` (${totals.unpriced} with no profit set yet)`}
      </p>
      {data.leads.length === 0 ? <Empty>No leads yet. Type your first one in the box above.</Empty> : (
        <>
          <p className="muted small dragtip">Tip: drag a card to another column to move it.</p>
          <div className="leadboard">
            {LEAD_STAGES.filter((s) => s.value !== 'lost').map((s) => column(s.value, s.label))}
          </div>
        </>
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
