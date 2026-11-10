import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, FormModal, HealthChip, money, Status, Tape, TapeLegend } from '../components/ui';
import { store, useData } from '../data';
import { attention } from '../domain/attention';
import { rollupJob } from '../domain/budget';
import { todayIso } from '../domain/rules';
import { starterBudget, starterSchedule } from '../domain/templates';
import { isNewHouse, type JobType } from '../domain/types';
import { jobFields } from './jobFields';

export function Today() {
  const { data, run } = useData();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const today = todayIso();
  const needs = attention(data, today, money);
  const open = data.jobs.filter((j) => j.status !== 'closed');
  const closed = data.jobs.filter((j) => j.status === 'closed');
  const jobName = (id?: string) => data.jobs.find((j) => j.id === id)?.name;

  const card = (job: (typeof data.jobs)[number]) => {
    const of = <T extends { job_id: string }>(rows: T[]) => rows.filter((r) => r.job_id === job.id);
    const draws = of(data.draws);
    const ids = new Set(draws.map((d) => d.id));
    const r = rollupJob(job, of(data.budget_lines), of(data.pos), of(data.bills), of(data.change_orders), draws, data.draw_lines.filter((l) => ids.has(l.draw_id)));
    const tasks = of(data.tasks);
    const done = tasks.filter((t) => t.status === 'done').length;
    return (
      <Link key={job.id} to={`/jobs/${job.id}`} className="jobcard">
        <div className="head">
          <div>
            <h2>{job.name}</h2>
            <span className="muted small">{job.address}</span>
          </div>
          <div className="row">
            {job.status !== 'closed' && <HealthChip job={job} />}
            <Status s={job.status} />
          </div>
        </div>
        <Tape budget={r.revised} paid={r.paid} billed={r.billed} committed={r.committed} />
        <dl className="figs">
          <div><dt>Paid of budget</dt><dd>{money(r.paid)} / {money(r.revised)}</dd></div>
          <div><dt>Expected profit</dt><dd>{money(r.forecastMargin)}</dd></div>
          <div><dt>Tasks done</dt><dd>{done} of {tasks.length}</dd></div>
        </dl>
      </Link>
    );
  };

  return (
    <div className="stack">
      <div className="row between">
        <h1>Today</h1>
        <button className="btn primary" onClick={() => setAdding(true)}>Add a job</button>
      </div>
      <div className="today">
        <section className="stack" aria-label="Jobs">
          {open.length ? open.map(card) : <Empty>Add your first job to see its budget, schedule, and bills here.</Empty>}
          {open.length > 0 && <TapeLegend />}
          {closed.length > 0 && (
            <details>
              <summary>Closed jobs ({closed.length})</summary>
              <div className="stack" style={{ marginTop: 10 }}>{closed.map(card)}</div>
            </details>
          )}
        </section>
        <section className="stack" aria-label="Needs you">
          <h2>Needs you ({needs.length})</h2>
          {needs.length === 0 ? <Empty>Nothing needs you right now.</Empty> : (
            <ul className="needs">
              {needs.map((n, i) => {
                const body = (
                  <>
                    <span className={`tag ${n.severity}`}>{n.severity === 'stop' ? 'Stop' : n.severity === 'act' ? 'Do' : 'Watch'}</span>
                    <span>{n.label}{n.jobId && <span className="job">{jobName(n.jobId)}</span>}</span>
                  </>
                );
                return (
                  <li key={i}>
                    {n.jobId ? <Link to={`/jobs/${n.jobId}/${n.tab}`}>{body}</Link> : <Link to="/subs">{body}</Link>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      {adding && (
        <FormModal
          title="Add a job"
          submit="Add job"
          fields={[...jobFields, { key: 'template', label: 'New house: start with the standard budget and schedule', type: 'check', help: 'Only applies to spec homes and client builds. Other jobs start with one General budget line.' }]}
          initial={{ job_type: 'spec', status: 'planning', start_date: today, template: true }}
          onClose={() => setAdding(false)}
          onSave={async (v) => {
            const id = crypto.randomUUID();
            const { template, ...job } = v;
            const ok = await run(async () => {
              await store.insert('jobs', { ...job, id } as never);
              if (template && isNewHouse(job.job_type as JobType)) {
                await store.insert('budget_lines', starterBudget(id));
                if (job.start_date) await store.insert('tasks', starterSchedule(id, job.start_date as string));
              } else if (!isNewHouse(job.job_type as JobType)) {
                await store.insert('budget_lines', { job_id: id, code: '01', name: 'General', budget_cents: 0, bought_out: false, sort: 0 });
              }
            }, 'Job added.');
            if (ok) { setAdding(false); nav(`/jobs/${id}`); }
          }}
        />
      )}
    </div>
  );
}
