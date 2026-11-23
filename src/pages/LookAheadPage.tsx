import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CONTACT_LABEL } from '../components/CallList';
import { Empty, Modal } from '../components/ui';
import { useData } from '../data';
import { firstNameOf, LOOKAHEAD_DAYS, lookAhead, lookAheadGroups, lookAheadText, primaryContact, shortDate } from '../domain/jobops';
import { todayIso } from '../domain/rules';
import { checkStatus } from '../domain/checks';
import type { Task } from '../domain/types';

const CHIP = { not_contacted: 'bad', contacted: 'warn', confirmed: 'good' } as const;

// Who is on a step: the sub if there is one, otherwise the person it's assigned to.
const whoKey = (t: Task) => (t.vendor_id ? `v:${t.vendor_id}` : t.assigned_to ? `p:${t.assigned_to}` : 'none');

export function LookAheadPage() {
  const { data } = useData();
  const today = todayIso();
  const [who, setWho] = useState('');
  const [texting, setTexting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const open = new Set(data.jobs.filter((j) => j.status !== 'closed').map((j) => j.id));
  const all = lookAhead(data.tasks.filter((t) => open.has(t.job_id)), today);
  const rows = who ? all.filter((t) => whoKey(t) === who) : all;

  const vendor = (id: string | null) => data.vendors.find((v) => v.id === id);
  const person = (id?: string | null) => data.profiles.find((p) => p.id === id);
  const job = (id: string) => data.jobs.find((j) => j.id === id);
  const nameOf = (key: string) => {
    if (key === 'none') return 'No one set';
    const [kind, id] = [key.slice(0, 1), key.slice(2)];
    return kind === 'v' ? vendor(id)?.name ?? 'Unknown sub' : person(id)?.name || person(id)?.email || 'Team member';
  };
  const people = [...new Set(all.map(whoKey))].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const unset = all.filter((t) => whoKey(t) === 'none').length;
  const unconfirmedSoon = all.filter((t) => t.vendor_id && t.status === 'todo' && t.contact_status !== 'confirmed').length;

  const textFor = (key: string) => {
    const id = key.slice(2);
    const greet = key.startsWith('v:') ? firstNameOf(primaryContact(data.vendor_contacts, id)) || nameOf(key) : (person(id)?.name ?? '').split(' ')[0];
    return lookAheadText({ who: greet, tasks: all.filter((t) => whoKey(t) === key), jobs: data.jobs });
  };

  return (
    <div className="stack">
      <h1>Next 2 weeks</h1>
      <p className="muted">
        Every step on an open job that isn't done and falls between {shortDate(today)} and the next {LOOKAHEAD_DAYS} days, across all jobs.
        Use it on Monday to line up the week, and to send each sub their dates.
      </p>
      <div className="row">
        <label className="field" style={{ minWidth: 220 }}>
          <span>Show</span>
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Show">
            <option value="">Everyone ({all.length})</option>
            {people.map((k) => <option key={k} value={k}>{nameOf(k)} ({all.filter((t) => whoKey(t) === k).length})</option>)}
          </select>
        </label>
        {who && who !== 'none' && <button className="btn" onClick={() => { setCopied(false); setTexting(who); }}>Their two weeks as a text</button>}
      </div>
      {(unset > 0 || unconfirmedSoon > 0) && (
        <p className="small">
          {unset > 0 && <span className="chip bad">{unset} step{unset === 1 ? '' : 's'} with no one set</span>}{' '}
          {unconfirmedSoon > 0 && <span className="chip warn">{unconfirmedSoon} sub step{unconfirmedSoon === 1 ? '' : 's'} not confirmed</span>}{' '}
          {unconfirmedSoon > 0 && <Link to="/calls">Open the call list</Link>}
        </p>
      )}
      {rows.length === 0 ? <Empty>Nothing scheduled on open jobs in the next {LOOKAHEAD_DAYS} days.</Empty> : lookAheadGroups(rows, today).map((g) => (
        <section key={g.key} className="stack" aria-label={g.label}>
          <h2>{g.label}</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Dates</th><th>Job</th><th>Work</th><th>Who</th><th>Status</th></tr></thead>
              <tbody>
                {g.tasks.map((t) => {
                  const key = whoKey(t);
                  return (
                    <tr key={t.id}>
                      <td className="num">{t.start_date === t.end_date ? shortDate(t.start_date) : `${shortDate(t.start_date)} to ${shortDate(t.end_date)}`}</td>
                      <td><Link to={`/jobs/${t.job_id}/schedule`}>{job(t.job_id)?.name}</Link></td>
                      <td>{t.name}{t.notes && <div className="small muted">{t.notes}</div>}</td>
                      <td>{key === 'none' ? <span className="flag">No one set</span> : nameOf(key)}</td>
                      <td>
                        {t.status === 'in_progress' && <span className="chip good">Started</span>}
                        {t.status === 'todo' && t.vendor_id && <span className={`chip ${CHIP[t.contact_status]}`}>{CONTACT_LABEL[t.contact_status]}</span>}
                        {t.status === 'todo' && !t.vendor_id && t.assigned_to && <span className="chip">Our crew</span>}
                        {(() => { const c = checkStatus(data.step_checks, t.id); return c.total && !c.complete ? <div><span className="chip warn">Checklist {c.done}/{c.total}</span></div> : null; })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {texting && (
        <Modal title={`${nameOf(texting)}: next two weeks`} onClose={() => setTexting(null)}>
          <TextBox body={textFor(texting)} copied={copied} onCopy={() => setCopied(true)} />
          <p className="muted small">Copy this into your own texts or email. Nothing is sent from here.</p>
          <button className="btn" onClick={() => setTexting(null)}>Close</button>
        </Modal>
      )}
    </div>
  );
}

function TextBox({ body, copied, onCopy }: { body: string; copied: boolean; onCopy: () => void }) {
  const [text, setText] = useState(body);
  return (
    <div className="stack">
      <label className="field">
        <span>Message</span>
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn primary" onClick={() => { void navigator.clipboard?.writeText(text).then(onCopy, () => undefined); }}>Copy</button>
        {copied && <span className="chip good">Copied</span>}
      </div>
    </div>
  );
}
