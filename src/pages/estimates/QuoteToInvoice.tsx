import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FormModal } from '../../components/ui';
import { store, useData } from '../../data';
import { money } from '../../domain/csv';
import { invoiceStatus, linesFromQuote } from '../../domain/invoice';
import { todayIso } from '../../domain/rules';
import type { EstimateRow } from '../../estimator/convert';
import type { priceProject } from '../../estimator/domain/pricing/resolve';
import type { Project } from '../../estimator/domain/types';

type Priced = ReturnType<typeof priceProject>;

/** Admins only. Quote → sent → job accepted → invoice, from the estimate page. */
export function QuoteToInvoice({ row, project, priced, onStatus, acceptNow, onAcceptShown }: { row: EstimateRow; project: Project; priced: Priced; onStatus: (s: EstimateRow['status']) => void; acceptNow?: boolean; onAcceptShown?: () => void }) {
  const { data, run } = useData();
  const nav = useNavigate();
  const [accepting, setAccepting] = useState(false);
  // Picking "Won" in the status list opens the same dialog, so a won quote always lands on a job.
  useEffect(() => { if (acceptNow) { setAccepting(true); onAcceptShown?.(); } }, [acceptNow]);
  const job = data.jobs.find((j) => j.id === row.job_id);
  const invoices = data.invoices.filter((i) => i.estimate_id === row.id).sort((a, b) => a.number - b.number);
  const totalCents = Math.round(priced.totals.grandTotal * 100);
  const title = project.clientName || project.address || 'New job';

  const markSent = () => run(async () => {
    await store.update('estimates', row.id, { status: 'sent' });
    onStatus('sent');
  }, 'Marked as sent to the client.');

  const makeInvoice = async () => {
    const id = crypto.randomUUID();
    const ok = await run(() => store.insert('invoices', {
      id, job_id: row.job_id, estimate_id: row.id, bill_to: job?.client_name || title, address: project.address,
      invoice_date: todayIso(), due_date: todayIso(), terms: 'Due on receipt',
      lines: linesFromQuote(title, priced.divisions, priced.lines, priced.totals.grandTotal),
    }), 'Invoice made. Check the lines, then make the PDF.');
    if (ok) nav(`/invoices/${id}`);
  };

  const step = job ? 3 : row.status === 'sent' ? 2 : 1;
  return (
    <section className="panel" aria-label="Quote to invoice">
      <h3>Quote → job → invoice</h3>
      <ol className="steps">
        <li className={step > 1 ? 'done' : 'now'}>Send the quote{row.status !== 'draft' || job ? ' ✓' : ''}</li>
        <li className={step > 2 ? 'done' : step === 2 ? 'now' : ''}>Customer accepts{job ? ' ✓' : ''}</li>
        <li className={step === 3 ? 'now' : ''}>Invoice{invoices.length ? ' ✓' : ''}</li>
      </ol>
      {!job && (
        <div className="row">
          {row.status === 'draft' && <button className="btn" onClick={markSent}>Mark as sent</button>}
          <button className="btn primary" onClick={() => setAccepting(true)}>Job accepted</button>
          {row.status === 'lost' && <span className="muted">This quote is marked lost.</span>}
        </div>
      )}
      {job && (
        <div className="stack">
          <p>Accepted. Job: <Link to={`/jobs/${job.id}/invoices`}>{job.name}</Link></p>
          {invoices.length > 0 && (
            <ul className="plain">
              {invoices.map((i) => <li key={i.id}><Link to={`/invoices/${i.id}`}>Invoice {i.number}</Link> · {money(i.lines.reduce((s, l) => s + (Number(l.amount_cents) || 0), 0))} · {invoiceStatus(i)}</li>)}
            </ul>
          )}
          <div className="row">
            <button className="btn primary" onClick={makeInvoice}>{invoices.length ? 'Make another invoice' : 'Make invoice'}</button>
          </div>
        </div>
      )}
      {accepting && (
        <FormModal
          title="Job accepted"
          submit="Accept and set up the job"
          intro={<p>This marks the quote as won and puts it on a job, so you can invoice it. Quote total: <b>{money(totalCents)}</b>.</p>}
          fields={[
            { key: 'job', label: 'Job', type: 'select', options: [{ value: 'new', label: 'Make a new job' }, ...data.jobs.filter((j) => j.status !== 'closed').map((j) => ({ value: j.id, label: `Add to ${j.name}` }))] },
            { key: 'name', label: 'New job name', help: 'Only used when making a new job.' },
            { key: 'add_price', label: "Add this quote's total to the job's contract price", type: 'check' },
          ]}
          initial={{ job: 'new', name: title, add_price: true }}
          onClose={() => setAccepting(false)}
          onSave={async (v) => {
            const isNew = v.job === 'new';
            const jobId = isNew ? crypto.randomUUID() : (v.job as string);
            const name = String(v.name ?? '').trim() || title;
            const ok = await run(async () => {
              if (isNew) {
                await store.insert('jobs', { id: jobId, name, address: project.address, job_type: 'client', status: 'active', sale_price_cents: v.add_price ? totalCents : 0, start_date: todayIso(), notes: `From the quote "${title}".` } as never);
              } else if (v.add_price) {
                const existing = data.jobs.find((j) => j.id === jobId)!;
                await store.update('jobs', jobId, { sale_price_cents: Number(existing.sale_price_cents) + totalCents });
              }
              await store.update('estimates', row.id, { status: 'won', job_id: jobId });
              onStatus('won');
            }, isNew ? `Job accepted. "${name}" is set up.` : 'Job accepted and added to the job.');
            if (ok) setAccepting(false);
          }}
        />
      )}
    </section>
  );
}
