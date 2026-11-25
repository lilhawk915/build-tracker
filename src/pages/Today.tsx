import { standardChecksFor } from '../domain/checks';
import { standardInspectionsFor } from '../domain/inspections';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, FormModal, HealthChip, money, Tape, TapeLegend, JobStatus } from '../components/ui';
import { store, useData } from '../data';
import { attention, type Attention } from '../domain/attention';
import { ourShare, rollupJob } from '../domain/budget';
import { todayIso } from '../domain/rules';
import { copyPlan, starterBudget, starterSchedule } from '../domain/templates';
import { isNewHouse, type JobType } from '../domain/types';
import { jobFields } from './jobFields';

export function Today() {
  const { data, run } = useData();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const today = todayIso();
  const needs = attention(data, today, money);
  const urgent = needs.filter((n) => n.severity !== 'watch');
  const watch = needs.filter((n) => n.severity === 'watch');
  const open = data.jobs.filter((j) => j.status !== 'closed');
  const closed = data.jobs.filter((j) => j.status === 'closed');
  const jobName = (id?: string) => data.jobs.find((j) => j.id === id)?.name;
  // Any job with a schedule or budget can be the starting point for a new one.
  const startOptions = [
    { value: 'standard', label: 'Standard new-house budget and schedule' },
    ...data.jobs
      .filter((j) => data.tasks.some((t) => t.job_id === j.id) || data.budget_lines.some((l) => l.job_id === j.id))
      .map((j) => {
        const steps = data.tasks.filter((t) => t.job_id === j.id).length;
        const budget = data.budget_lines.filter((l) => l.job_id === j.id).reduce((s, l) => s + l.budget_cents, 0);
        return { value: `job:${j.id}`, label: `Copy ${j.name} (${steps} steps, ${money(budget)} budget)` };
      }),
    { value: 'blank', label: 'Nothing, start empty' },
  ];

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
            <JobStatus s={job.status} />
          </div>
        </div>
        <Tape budget={r.revised} paid={r.paid} billed={r.billed} committed={r.committed} />
        <dl className="figs">
          <div><dt>Paid of budget</dt><dd>{money(r.paid)} / {money(r.revised)}</dd></div>
          <div>
            <dt>Expected profit</dt>
            <dd>{money(r.forecastMargin)}</dd>
            {ourShare(r.forecastMargin, job.profit_share_pct) !== null && <div className="small">Your {job.profit_share_pct}%: <b>{money(ourShare(r.forecastMargin, job.profit_share_pct)!)}</b></div>}
          </div>
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
              <summary>Done jobs ({closed.length})</summary>
              <div className="stack" style={{ marginTop: 10 }}>{closed.map(card)}</div>
            </details>
          )}
        </section>
        <section className="stack" aria-label="Needs you">
          <h2>Needs you ({urgent.length})</h2>
          {urgent.length === 0 ? <Empty>Nothing needs you right now.</Empty> : <NeedList items={urgent} jobName={jobName} />}
          {watch.length > 0 && (
            <details className="watchlist">
              <summary>Keep an eye on ({watch.length})</summary>
              <NeedList items={watch} jobName={jobName} />
            </details>
          )}
        </section>
      </div>
      {adding && (
        <FormModal
          title="Add a job"
          submit="Add job"
          fields={[...jobFields, {
            key: 'start_from', label: 'Start this job from', type: 'select', options: startOptions,
            help: 'Copying a job brings over its steps in order, subs, budget and order list. Dates move to this job\'s start date. Nothing comes over as done, confirmed or ordered.',
          }]}
          initial={{ job_type: 'spec', status: 'planning', start_date: today, start_from: 'standard' }}
          onClose={() => setAdding(false)}
          onSave={async (v) => {
            const id = crypto.randomUUID();
            const { start_from, ...job } = v;
            const from = String(start_from ?? 'standard');
            const ok = await run(async () => {
              await store.insert('jobs', { ...job, id } as never);
              if (from.startsWith('job:')) {
                const src = from.slice(4);
                const of = <T extends { job_id: string }>(rows: T[]) => rows.filter((r) => r.job_id === src);
                const plan = copyPlan({ tasks: of(data.tasks), budget_lines: of(data.budget_lines), materials: of(data.materials), step_checks: of(data.step_checks), inspections: of(data.inspections) }, id, (job.start_date as string) || today);
                if (plan.budget_lines.length) await store.insert('budget_lines', plan.budget_lines);
                if (plan.tasks.length) await store.insert('tasks', plan.tasks);
                if (plan.materials.length) await store.insert('materials', plan.materials as never);
                if (plan.step_checks.length) await store.insert('step_checks', plan.step_checks);
                if (plan.inspections.length) await store.insert('inspections', plan.inspections);
              } else if (from === 'standard' && isNewHouse(job.job_type as JobType)) {
                await store.insert('budget_lines', starterBudget(id));
                if (job.start_date) {
                  const steps = starterSchedule(id, job.start_date as string);
                  await store.insert('tasks', steps);
                  await store.insert('step_checks', standardChecksFor(steps) as never);
                  await store.insert('inspections', standardInspectionsFor(id, steps) as never);
                }
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

function NeedList({ items, jobName }: { items: Attention[]; jobName: (id?: string) => string | undefined }) {
  return (
    <ul className="needs">
      {items.map((n, i) => {
        const body = (
          <>
            <span className={`tag ${n.severity}`}>{n.severity === 'stop' ? 'Stop' : n.severity === 'act' ? 'Do' : 'Watch'}</span>
            <span>{n.label}{n.jobId && <span className="job">{jobName(n.jobId)}</span>}</span>
          </>
        );
        return <li key={i}>{n.jobId ? <Link to={`/jobs/${n.jobId}/${n.tab}`}>{body}</Link> : <Link to="/subs">{body}</Link>}</li>;
      })}
    </ul>
  );
}
