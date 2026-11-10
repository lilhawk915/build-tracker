import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Empty, FormModal, Modal, money, Status } from '../../components/ui';
import { store, useData } from '../../data';
import { drawSheet, rollupJob, rollupLines } from '../../domain/budget';
import { centsToDecimal, parseMoney } from '../../domain/csv';
import { todayIso } from '../../domain/rules';
import type { Draw, Job } from '../../domain/types';

export function DrawsTab({ job }: { job: Job }) {
  const { data, run } = useData();
  const [editing, setEditing] = useState<Draw | null>(null);
  const [funding, setFunding] = useState<Draw | null>(null);
  const of = <T extends { job_id: string }>(rows: T[]) => rows.filter((r) => r.job_id === job.id);
  const draws = of(data.draws).sort((a, b) => a.number - b.number);
  const ids = new Set(draws.map((d) => d.id));
  const drawLines = data.draw_lines.filter((l) => ids.has(l.draw_id));
  const r = rollupJob(job, of(data.budget_lines), of(data.pos), of(data.bills), of(data.change_orders), draws, drawLines);
  const total = (id: string) => drawLines.filter((l) => l.draw_id === id).reduce((s, l) => s + l.amount_cents, 0);

  return (
    <div className="stack">
      <div className="row between">
        <h2>Lender draws</h2>
        <button
          className="btn primary"
          onClick={async () => { await run(() => store.insert('draws', { job_id: job.id, status: 'draft', funded_cents: 0, notes: '' }), 'Draft draw added. Enter its amounts.'); }}
        >
          Start a draw
        </button>
      </div>
      <div className="panel">
        <dl className="figs strip">
          <div><dt>Loan amount</dt><dd>{money(job.loan_amount_cents)}</dd></div>
          <div><dt>Requested so far</dt><dd>{money(r.drawnRequested)}</dd></div>
          <div><dt>Funded so far</dt><dd>{money(r.drawnFunded)}</dd></div>
          <div><dt>Left to draw</dt><dd>{money(r.loanLeft)}</dd></div>
          <div><dt>Paid out of pocket</dt><dd>{money(r.outOfPocket)}</dd></div>
        </dl>
      </div>
      {draws.length === 0 ? <Empty>Start a draw to build the sheet your lender needs.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Draw</th><th>Requested</th><th className="right">Amount</th><th>Funded on</th><th className="right">Funded</th><th>Notes</th><th>Status</th><th /></tr></thead>
            <tbody>
              {draws.map((d) => (
                <tr key={d.id}>
                  <td className="num">{d.number}</td>
                  <td className="num">{d.requested_date}</td>
                  <td className="right num">{money(total(d.id))}</td>
                  <td className="num">{d.funded_date}</td>
                  <td className="right num">{d.status === 'funded' ? money(d.funded_cents) : ''}</td>
                  <td>{d.notes}</td>
                  <td><Status s={d.status} /></td>
                  <td className="actions">
                    <Link className="btn tiny" to={`/jobs/${job.id}/draws/${d.id}/sheet`}>Open sheet</Link>
                    {d.status === 'draft' && <button className="btn tiny" onClick={() => setEditing(d)}>Enter amounts</button>}
                    {d.status === 'draft' && <button className="btn tiny" disabled={total(d.id) === 0} onClick={() => run(() => store.update('draws', d.id, { status: 'requested', requested_date: todayIso() }), `Draw ${d.number} marked requested.`)}>Mark requested</button>}
                    {d.status === 'draft' && <button className="btn tiny danger" onClick={() => run(() => store.remove('draws', d.id), `Draw ${d.number} deleted.`)}>Delete</button>}
                    {d.status === 'requested' && <button className="btn tiny" onClick={() => setFunding(d)}>Mark funded</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <DrawEditor job={job} draw={editing} onClose={() => setEditing(null)} />}
      {funding && (
        <FormModal
          title={`Mark draw ${funding.number} funded`}
          submit="Mark funded"
          fields={[
            { key: 'funded_cents', label: 'Amount the lender funded', type: 'money', required: true, help: 'Enter what reached your account, after any fees or holdback.' },
            { key: 'funded_date', label: 'Date funded', type: 'date', required: true },
          ]}
          initial={{ funded_cents: total(funding.id), funded_date: todayIso() }}
          onClose={() => setFunding(null)}
          onSave={async (v) => {
            const ok = await run(() => store.update('draws', funding.id, { status: 'funded', funded_cents: v.funded_cents as number, funded_date: v.funded_date as string }), `Draw ${funding.number} marked funded.`);
            if (ok) setFunding(null);
          }}
        />
      )}
    </div>
  );
}

function DrawEditor({ job, draw, onClose }: { job: Job; draw: Draw; onClose: () => void }) {
  const { data, run } = useData();
  const of = <T extends { job_id: string }>(rows: T[]) => rows.filter((r) => r.job_id === job.id);
  const lines = of(data.budget_lines);
  const rolls = rollupLines(lines, of(data.pos), of(data.bills), of(data.change_orders));
  const draws = of(data.draws);
  const ids = new Set(draws.map((d) => d.id));
  const drawLines = data.draw_lines.filter((l) => ids.has(l.draw_id));
  const sheet = drawSheet(draw, lines, rolls, draws, drawLines);
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(sheet.map((s) => [s.line.id, s.thisDraw ? centsToDecimal(s.thisDraw) : ''])),
  );
  const [notes, setNotes] = useState(draw.notes);
  const [err, setErr] = useState('');
  const cents = (id: string) => parseMoney(vals[id] ?? '');
  const sum = sheet.reduce((s, x) => s + (cents(x.line.id) ?? 0), 0);

  async function save(e: FormEvent) {
    e.preventDefault();
    const bad = sheet.find((s) => { const c = cents(s.line.id); return c == null || c < 0; });
    if (bad) { setErr(`${bad.line.name}: enter a dollar amount like 12500.50`); return; }
    const ok = await run(async () => {
      for (const l of data.draw_lines.filter((x) => x.draw_id === draw.id)) await store.remove('draw_lines', l.id);
      const rows = sheet.filter((s) => cents(s.line.id)).map((s) => ({ draw_id: draw.id, budget_line_id: s.line.id, amount_cents: cents(s.line.id)! }));
      if (rows.length) await store.insert('draw_lines', rows);
      await store.update('draws', draw.id, { notes });
    }, `Draw ${draw.number} saved.`);
    if (ok) onClose();
  }

  return (
    <Modal title={`Draw ${draw.number} amounts`} wide onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="tablewrap" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
          <table>
            <thead><tr><th>Line</th><th className="right">Budget</th><th className="right">Drawn before</th><th className="right">Billed</th><th className="right" style={{ width: 130 }}>This draw</th></tr></thead>
            <tbody>
              {sheet.map((s) => {
                const c = cents(s.line.id) ?? 0;
                const over = s.prior + c > s.budget;
                return (
                  <tr key={s.line.id}>
                    <td>{s.line.name}{over && <div><span className="flag">Over budget</span></div>}</td>
                    <td className="right num">{money(s.budget)}</td>
                    <td className="right num">{money(s.prior)}</td>
                    <td className="right num">{money(rolls.find((r) => r.line.id === s.line.id)?.billed ?? 0)}</td>
                    <td>
                      <input aria-label={`${s.line.name} this draw`} inputMode="decimal" value={vals[s.line.id] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [s.line.id]: e.target.value }))} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p><b>This draw: <span className="num">{money(sum)}</span></b></p>
        <label className="field">Notes for the lender<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {err && <div className="alert" role="alert">{err}</div>}
        <div className="row">
          <button className="btn primary">Save draw</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
