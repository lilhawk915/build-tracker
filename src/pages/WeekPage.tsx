import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Modal, money } from '../components/ui';
import { useData } from '../data';
import { shortDate } from '../domain/jobops';
import { todayIso } from '../domain/rules';
import { weekSummary, weekText, type JobWeek } from '../domain/weekly';
import type { Task } from '../domain/types';

/** The Monday look at every open job, on one page, with a copy to paste into an email. */
export function WeekPage() {
  const { data } = useData();
  const today = todayIso();
  const [sharing, setSharing] = useState(false);
  const s = weekSummary(data, today, money);
  const who = (t: Task) => data.vendors.find((v) => v.id === t.vendor_id)?.name
    ?? data.profiles.find((p) => p.id === t.assigned_to)?.name;
  const when = (t: Task) => (t.start_date === t.end_date ? shortDate(t.start_date) : `${shortDate(t.start_date)} to ${shortDate(t.end_date)}`);

  const card = (w: JobWeek) => (
    <section key={w.job.id} className="panel stack weekjob" aria-label={w.job.name}>
      <div className="row between">
        <h2><Link to={`/jobs/${w.job.id}`}>{w.job.name}</Link></h2>
        <span className={`chip ${w.health.state === 'behind' ? 'bad' : w.health.state === 'none' ? '' : 'good'}`}>{w.health.label}</span>
      </div>
      <p className="small">
        {w.health.projectedFinish && <>Finish {shortDate(w.health.projectedFinish)}</>}
        {w.job.target_finish && <> · target {shortDate(w.job.target_finish)}</>}
        {w.carryCents > 0 && <> · <b>about {money(w.carryCents)} more to carry</b></>}
      </p>
      {w.budget.revised > 0 && (
        <p className="small">
          {money(w.budget.billed)} billed of {money(w.budget.revised)} budget
          {w.budget.pctDone !== null && <> · {w.budget.pctDone}% of the work done</>}
          {w.budget.over > 0 && <> · <span className="flag">{money(w.budget.over)} over budget</span></>}
        </p>
      )}
      <div className="week-cols">
        <div>
          <h3>Since {shortDate(s.since)}</h3>
          {w.finished.length + w.arrived.length === 0 && !w.paidCents ? <p className="muted small">Nothing finished or delivered.</p> : (
            <ul>
              {w.finished.map((t) => <li key={t.id}>Finished: {t.name}{who(t) && <span className="muted"> · {who(t)}</span>}</li>)}
              {w.arrived.map((m) => <li key={m.id}>Delivered: {m.name}</li>)}
              {w.paidCents > 0 && <li>Paid out {money(w.paidCents)}</li>}
            </ul>
          )}
        </div>
        <div>
          <h3>This week</h3>
          {w.going.length + w.starting.length === 0 ? <p className="muted small">Nothing scheduled.</p> : (
            <ul>
              {w.going.map((t) => <li key={t.id}>{t.name} <span className="chip good">Going</span>{who(t) && <span className="muted"> · {who(t)}</span>}</li>)}
              {w.starting.map((t) => <li key={t.id}>{t.name}: {when(t)}{who(t) ? <span className="muted"> · {who(t)}</span> : <span className="flag">No one set</span>}</li>)}
            </ul>
          )}
          {w.toOrder.length > 0 && (
            <>
              <h3>Order</h3>
              <ul>{w.toOrder.map(({ m, flag }) => <li key={m.id}>{m.name}{flag.orderBy && <span className="muted"> · order by {shortDate(flag.orderBy)}</span>}</li>)}</ul>
            </>
          )}
        </div>
      </div>
      {w.stops.length > 0 && (
        <div className="stack">
          <h3>Problems</h3>
          <ul>{w.stops.map((n, i) => <li key={i}><Link to={`/jobs/${w.job.id}/${n.tab}`}>{n.label}</Link></li>)}</ul>
        </div>
      )}
      {w.acts > 0 && <p className="small muted">{w.acts} more thing{w.acts === 1 ? '' : 's'} to do on <Link to="/">Today</Link>.</p>}
    </section>
  );

  return (
    <div className="stack">
      <div className="row between">
        <h1>Monday summary</h1>
        <div className="row noprint">
          <button className="btn" onClick={() => window.print()}>Print</button>
          <button className="btn primary" onClick={() => setSharing(true)}>Copy as text</button>
        </div>
      </div>
      <p className="muted">Week of {shortDate(s.weekStart)}. Every open job: what got done since last Monday, what's on this week, money, and anything stopped.</p>
      {s.jobs.length === 0 ? <Empty>No open jobs.</Empty> : s.jobs.map(card)}
      {sharing && <ShareModal body={weekText(s, data.vendors, money)} onClose={() => setSharing(false)} />}
    </div>
  );
}

function ShareModal({ body, onClose }: { body: string; onClose: () => void }) {
  const [text, setText] = useState(body);
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Monday summary as text" onClose={onClose}>
      <label className="field">
        <span>Summary</span>
        <textarea rows={16} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="muted small">Edit it, then paste it into your own email or text. Nothing is sent from here.</p>
      <div className="row">
        <button className="btn primary" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined); }}>Copy</button>
        {copied && <span className="chip good">Copied</span>}
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
