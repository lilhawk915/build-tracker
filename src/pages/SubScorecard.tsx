import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Modal, money } from '../components/ui';
import { useData } from '../data';
import { shortDate } from '../domain/jobops';
import { todayIso } from '../domain/rules';
import { BAD_BELOW, daysLate, GOOD_AT, GRADE_LABEL, localDay, MIN_RATED, promisedEnd, scorecards, type SubScore } from '../domain/scorecard';

const GRADE_CHIP = { good: 'good', watch: 'warn', bad: 'bad', new: '' } as const;

/** How each sub has done: finishing on time, work sent back, bills past the PO, extras. */
export function SubScorecard() {
  const { data } = useData();
  const today = todayIso();
  const [open, setOpen] = useState<SubScore | null>(null);
  const cards = scorecards(data, today);
  const ratedAny = cards.some((c) => c.rated.length > 0);

  return (
    <section className="stack" aria-label="Scorecard">
      <h2>Scorecard</h2>
      <p className="muted small">
        On time means the step was marked done by the end date it had when it started, so delays before the sub got there don't count against them.
        Steps finished before the app kept finish dates aren't scored.
      </p>
      {cards.length === 0 ? <Empty>Add subs to see how they're doing.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Sub</th><th>Grade</th><th className="right">Steps scored</th><th className="right">On time</th><th className="right">Avg days late</th>
                <th className="right">Late now</th><th className="right">Photos sent back</th><th className="right">Failed inspections</th><th className="right">Bills past PO</th><th className="right">Extras</th><th />
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.vendor.id}>
                  <td><b>{c.vendor.name}</b>{c.vendor.trade && <div className="small muted">{c.vendor.trade}</div>}</td>
                  <td><span className={`chip ${GRADE_CHIP[c.grade]}`}>{GRADE_LABEL[c.grade]}</span></td>
                  <td className="right num">{c.rated.length}{c.unrated > 0 && <div className="small muted">+{c.unrated} not scored</div>}</td>
                  <td className="right num">{c.onTimePct === null ? '–' : `${c.onTimePct}%`}</td>
                  <td className="right num">{c.late ? c.avgDaysLate : '–'}</td>
                  <td className="right num">{c.lateNow.length ? <span className="flag">{c.lateNow.length}</span> : 0}</td>
                  <td className="right num">{c.redos}</td>
                  <td className="right num">{c.failedInspections}</td>
                  <td className="right num">{c.overPo}</td>
                  <td className="right num">{c.extras ? <>{c.extras}<div className="small muted">{money(c.extrasCents)}</div></> : 0}</td>
                  <td className="actions"><button className="btn tiny" onClick={() => setOpen(c)}>Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!ratedAny && cards.length > 0 && <p className="small muted">Grades start once a sub has {MIN_RATED} finished steps with finish dates.</p>}
      <p className="small muted">
        Strong: {GOOD_AT}%+ on time, nothing sent back or failed, no bills past the PO. Problem: under {BAD_BELOW}% on time, or 2+ photos sent back or failed inspections. Everyone else: Watch.
      </p>
      {open && <ScoreDetails score={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function ScoreDetails({ score, onClose }: { score: SubScore; onClose: () => void }) {
  const { data } = useData();
  const job = (id: string) => data.jobs.find((j) => j.id === id)?.name ?? 'Job';
  const steps = [...score.rated].sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const redos = data.photos.filter((p) => p.vendor_id === score.vendor.id && p.review_status === 'rejected');
  return (
    <Modal title={`${score.vendor.name}: scorecard`} wide onClose={onClose}>
      <p>
        <span className={`chip ${GRADE_CHIP[score.grade]}`}>{GRADE_LABEL[score.grade]}</span>{' '}
        {score.onTimePct !== null && <>{score.onTime} of {score.rated.length} steps on time ({score.onTimePct}%). </>}
        {money(score.billedCents)} billed across all jobs.
      </p>
      {score.lateNow.length > 0 && (
        <div className="alert" role="status">
          Running late now: {score.lateNow.map((t) => `${t.name} on ${job(t.job_id)} (was due ${shortDate(t.end_date)})`).join('; ')}
        </div>
      )}
      <h3>Finished steps</h3>
      {steps.length === 0 ? <Empty>No finished steps with a finish date yet.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Job</th><th>Step</th><th>Due</th><th>Finished</th><th>Result</th></tr></thead>
            <tbody>
              {steps.map((t) => {
                const late = daysLate(t) ?? 0;
                return (
                  <tr key={t.id}>
                    <td><Link to={`/jobs/${t.job_id}/schedule`}>{job(t.job_id)}</Link></td>
                    <td>{t.name}</td>
                    <td className="num">{shortDate(promisedEnd(t))}</td>
                    <td className="num">{shortDate(localDay(t.completed_at!))}</td>
                    <td>{late ? <span className="chip warn">{late} day{late === 1 ? '' : 's'} late</span> : <span className="chip good">On time</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {redos.length > 0 && (
        <>
          <h3>Photos sent back</h3>
          <ul>{redos.map((p) => <li key={p.id}>{job(p.job_id)}: {p.caption || 'Photo'}{p.review_note && <span className="muted"> · {p.review_note}</span>}</li>)}</ul>
        </>
      )}
      <button className="btn" onClick={onClose}>Close</button>
    </Modal>
  );
}
