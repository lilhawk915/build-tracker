import { useState } from 'react';
import { Empty, FormModal, lineTape, money, Tape, TapeLegend } from '../../components/ui';
import { store, useData } from '../../data';
import { jobPctDone, lineProgress, rollupJob, rollupLines } from '../../domain/budget';
import { isOwnProject, type BudgetLine, type Job } from '../../domain/types';

export function BudgetTab({ job }: { job: Job }) {
  const { data, run } = useData();
  const [edit, setEdit] = useState<BudgetLine | 'new' | null>(null);
  const of = <T extends { job_id: string }>(rows: T[]) => rows.filter((r) => r.job_id === job.id);
  const lines = of(data.budget_lines);
  const draws = of(data.draws);
  const ids = new Set(draws.map((d) => d.id));
  const rolls = rollupLines(lines, of(data.pos), of(data.bills), of(data.change_orders));
  const r = rollupJob(job, lines, of(data.pos), of(data.bills), of(data.change_orders), draws, data.draw_lines.filter((l) => ids.has(l.draw_id)));
  const pctDone = jobPctDone(rolls);
  const leftTotal = rolls.reduce((s, x) => s + lineProgress(x).left, 0);
  const used = (id: string) =>
    [...data.pos, ...data.bills, ...data.change_orders, ...data.draw_lines].some((x) => x.budget_line_id === id);

  return (
    <div className="stack">
      <div className="panel stack">
        <dl className="figs strip">
          <div><dt>{isOwnProject(job.job_type) ? 'Expected sale' : 'Contract with changes'}</dt><dd>{money(r.salePrice)}</dd></div>
          <div><dt>Expected final cost</dt><dd>{money(r.forecast)}</dd></div>
          <div><dt>Expected profit</dt><dd>{money(r.forecastMargin)}</dd></div>
          <div><dt>Paid so far</dt><dd>{money(r.paid)}</dd></div>
          <div><dt>Left to finish</dt><dd>{money(leftTotal)}</dd></div>
          {pctDone != null && <div><dt>Work done, by budget</dt><dd>{pctDone}%</dd></div>}
          <div><dt>Waiting on approval</dt><dd>{money(r.pending)}</dd></div>
          {job.loan_amount_cents > 0 && <div><dt>Loan left to draw</dt><dd>{money(r.loanLeft)}</dd></div>}
          {job.loan_amount_cents > 0 && <div><dt>Out of pocket</dt><dd>{money(r.outOfPocket)}</dd></div>}
        </dl>
        <Tape budget={r.revised} paid={r.paid} billed={r.billed} committed={r.committed} />
        <TapeLegend />
        <p className="muted small">
          Expected final cost assumes each line uses its whole budget until you mark it bought out.
          Left to finish is expected final cost minus what's been billed. Set each line's % done to see if spending is running ahead of the work.
        </p>
      </div>
      <div className="row between">
        <h2>Budget lines</h2>
        <button className="btn" onClick={() => setEdit('new')}>Add a line</button>
      </div>
      {lines.length === 0 ? <Empty>Add budget lines to track this build's costs.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Code</th><th>Line</th><th className="right">Budget</th><th className="right">Committed</th>
                <th className="right">Billed</th><th className="right">Paid</th><th className="right">Done</th><th className="right">Left to finish</th><th style={{ minWidth: 130 }}>Progress</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {rolls.map((x) => (
                <tr key={x.line.id}>
                  <td className="num muted">{x.line.code}</td>
                  <td>{x.line.name}</td>
                  <td className="right num">{money(x.revised)}</td>
                  <td className="right num">{money(x.committed)}</td>
                  <td className="right num">{money(x.billed)}</td>
                  <td className="right num">{money(x.paid)}</td>
                  <td className="right num">{lineProgress(x).pct != null ? `${lineProgress(x).pct}%` : <span className="muted">-</span>}</td>
                  <td className="right num">{money(lineProgress(x).left)}</td>
                  <td>{lineTape(x)}</td>
                  <td>
                    {x.over > 0 ? <span className="flag">{money(x.over)} over</span>
                      : lineProgress(x).behind ? <span className="chip warn" title="Share of budget billed is well ahead of the share of work done">{lineProgress(x).spentPct}% spent, {lineProgress(x).pct}% done</span>
                      : x.line.bought_out ? <span className="chip good">Bought out</span> : null}
                  </td>
                  <td className="actions"><button className="btn tiny" onClick={() => setEdit(x.line)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td /><td>Total</td>
                <td className="right num">{money(r.revised)}</td>
                <td className="right num">{money(r.committed)}</td>
                <td className="right num">{money(r.billed)}</td>
                <td className="right num">{money(r.paid)}</td>
                <td className="right num">{pctDone != null ? `${pctDone}%` : ''}</td>
                <td className="right num">{money(leftTotal)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {edit && (
        <FormModal
          title={edit === 'new' ? 'Add a budget line' : `Edit ${edit.name}`}
          submit={edit === 'new' ? 'Add line' : 'Save line'}
          fields={[
            { key: 'code', label: 'Code' },
            { key: 'name', label: 'Name', required: true },
            { key: 'budget_cents', label: 'Original budget', type: 'money', help: 'Approved change orders are added on top of this.' },
            { key: 'pct_complete', label: '% done', type: 'number', help: 'How much of this work is finished, 0 to 100. Leave blank if not started.' },
            { key: 'bought_out', label: 'Bought out', type: 'check', help: 'All work on this line is under contract, so any savings count toward profit.' },
          ]}
          initial={edit === 'new' ? { budget_cents: 0 } : (edit as never)}
          onClose={() => setEdit(null)}
          intro={edit !== 'new' && !used(edit.id) ? (
            <button
              type="button"
              className="btn danger tiny"
              style={{ justifySelf: 'start' }}
              onClick={async () => {
                if (await run(() => store.remove('budget_lines', edit.id), 'Line deleted.')) setEdit(null);
              }}
            >
              Delete this line
            </button>
          ) : undefined}
          onSave={async (v) => {
            if (v.pct_complete != null) {
              const p = Number(v.pct_complete);
              if (p < 0 || p > 100) throw new Error('% done: enter 0 to 100.');
              v = { ...v, pct_complete: Math.round(p) };
            }
            const ok = await run(
              () => edit === 'new'
                ? store.insert('budget_lines', { ...v, job_id: job.id, sort: Math.max(0, ...lines.map((l) => l.sort)) + 1 } as never)
                : store.update('budget_lines', edit.id, v as never),
              'Line saved.',
            );
            if (ok) setEdit(null);
          }}
        />
      )}
    </div>
  );
}
