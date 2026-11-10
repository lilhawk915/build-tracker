import { Link, useParams } from 'react-router-dom';
import { money, WAIVER_LABEL } from '../components/ui';
import { useData } from '../data';
import { drawSheet, rollupLines } from '../domain/budget';

export function DrawSheetPage() {
  const { jobId, drawId } = useParams();
  const { data } = useData();
  const job = data.jobs.find((j) => j.id === jobId);
  const draw = data.draws.find((d) => d.id === drawId);
  if (!job || !draw) return <div className="alert" role="alert">This draw no longer exists.</div>;
  const of = <T extends { job_id: string }>(rows: T[]) => rows.filter((r) => r.job_id === job.id);
  const lines = of(data.budget_lines);
  const draws = of(data.draws);
  const ids = new Set(draws.map((d) => d.id));
  const rolls = rollupLines(lines, of(data.pos), of(data.bills), of(data.change_orders));
  const sheet = drawSheet(draw, lines, rolls, draws, data.draw_lines.filter((l) => ids.has(l.draw_id)));
  const add = (f: (s: (typeof sheet)[number]) => number) => sheet.reduce((t, s) => t + f(s), 0);
  const waivers = of(data.lien_waivers).filter((w) => w.status === 'received');
  const vendor = (id: string) => data.vendors.find((v) => v.id === id)?.name ?? '';

  return (
    <div className="stack">
      <div className="row between noprint">
        <Link to={`/jobs/${job.id}/draws`}>Back to draws</Link>
        <button className="btn primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <article className="sheet stack">
        <div>
          <h1>Draw request {draw.number}: {job.name}</h1>
          <p>{job.address}</p>
          <p className="muted">
            {job.lender && `Lender: ${job.lender}. `}Loan: {money(job.loan_amount_cents)}.
            {draw.requested_date && ` Requested ${draw.requested_date}.`}
          </p>
          {draw.notes && <p>{draw.notes}</p>}
        </div>
        {sheet.some((s) => s.overdrawn) && <div className="alert">One or more lines would be drawn past their budget.</div>}
        <div className="tablewrap">
          <table>
            <thead><tr><th>Code</th><th>Line</th><th className="right">Budget</th><th className="right">Prior draws</th><th className="right">This draw</th><th className="right">Total drawn</th><th className="right">Balance</th></tr></thead>
            <tbody>
              {sheet.map((s) => (
                <tr key={s.line.id}>
                  <td className="num">{s.line.code}</td>
                  <td>{s.line.name}</td>
                  <td className="right num">{money(s.budget)}</td>
                  <td className="right num">{money(s.prior)}</td>
                  <td className="right num">{s.thisDraw ? money(s.thisDraw) : ''}</td>
                  <td className="right num">{money(s.total)}</td>
                  <td className="right num">{money(s.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td /><td>Total</td>
                <td className="right num">{money(add((s) => s.budget))}</td>
                <td className="right num">{money(add((s) => s.prior))}</td>
                <td className="right num">{money(add((s) => s.thisDraw))}</td>
                <td className="right num">{money(add((s) => s.total))}</td>
                <td className="right num">{money(add((s) => s.balance))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <section className="stack">
          <h3>Lien waivers on file</h3>
          {waivers.length === 0 ? <p className="muted">None received yet.</p> : (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Sub</th><th>Type</th><th>Through</th><th className="right">Amount</th></tr></thead>
                <tbody>
                  {waivers.map((w) => (
                    <tr key={w.id}><td>{vendor(w.vendor_id)}</td><td>{WAIVER_LABEL[w.kind]}</td><td className="num">{w.through_date}</td><td className="right num">{money(w.amount_cents)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </article>
    </div>
  );
}
