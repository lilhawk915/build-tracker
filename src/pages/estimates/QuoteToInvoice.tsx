import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FormModal } from '../../components/ui';
import { store, useData } from '../../data';
import { money } from '../../domain/csv';
import { depositCents, depositLines, finalLines, invoiceBalance, invoiceStatus, invoiceTotal, linesFromQuote, pctText, unbilledChangeOrders, changeOrderLines, quoteRef } from '../../domain/invoice';
import { todayIso } from '../../domain/rules';
import type { Invoice, InvoiceKind } from '../../domain/types';
import type { EstimateRow } from '../../estimator/convert';
import type { priceProject } from '../../estimator/domain/pricing/resolve';
import type { Project } from '../../estimator/domain/types';

type Priced = ReturnType<typeof priceProject>;

export const KIND_WORD: Record<InvoiceKind, string> = { deposit: 'Deposit', final: 'Final', standard: '' };

/** The job budget a quote sets up: material and labor for each section, plus tax and contingency. */
export function budgetFromQuote(priced: Priced): { name: string; budget_cents: number }[] {
  const out: { name: string; budget_cents: number }[] = [];
  for (const d of priced.divisions) {
    if (d.material > 0) out.push({ name: `${d.division} - material`, budget_cents: Math.round(d.material * 100) });
    if (d.labor > 0) out.push({ name: `${d.division} - labor`, budget_cents: Math.round(d.labor * 100) });
  }
  if (priced.totals.tax > 0) out.push({ name: 'Sales tax on materials', budget_cents: Math.round(priced.totals.tax * 100) });
  if (priced.totals.contingency > 0) out.push({ name: 'Contingency', budget_cents: Math.round(priced.totals.contingency * 100) });
  return out;
}

/** Admins only. Quote → signed → deposit → final invoice → paid, from the estimate page. */
export function QuoteToInvoice({ row, project, priced, onStatus, acceptNow, onAcceptShown }: { row: EstimateRow; project: Project; priced: Priced; onStatus: (s: EstimateRow['status']) => void; acceptNow?: boolean; onAcceptShown?: () => void }) {
  const { data, run } = useData();
  const nav = useNavigate();
  const [accepting, setAccepting] = useState(false);
  // Picking "Won" in the status list opens the same dialog, so a won quote always lands on a job.
  useEffect(() => { if (acceptNow) { setAccepting(true); onAcceptShown?.(); } }, [acceptNow]);
  const job = data.jobs.find((j) => j.id === row.job_id);
  const invoices = data.invoices.filter((i) => i.estimate_id === row.id).sort((a, b) => a.number - b.number);
  const deposits = invoices.filter((i) => i.kind === 'deposit');
  const finals = invoices.filter((i) => i.kind !== 'deposit');
  const jobInvoices = data.invoices.filter((i) => job && i.job_id === job.id);
  const openCos = job ? unbilledChangeOrders(data.change_orders.filter((c) => c.job_id === job.id), jobInvoices) : [];
  const totalCents = Math.round(priced.totals.grandTotal * 100);
  const title = project.clientName || project.address || 'New job';
  const depositPct = project.depositPct ?? 0;
  const depositDue = deposits.some((d) => invoiceBalance(d) > 0);
  const depositPaid = deposits.length > 0 && !depositDue;
  const allPaid = finals.length > 0 && invoices.every((i) => invoiceBalance(i) <= 0);

  const markSent = () => run(async () => {
    await store.update('estimates', row.id, { status: 'sent' });
    onStatus('sent');
  }, 'Marked as sent to the client.');

  const makeInvoice = async (kind: InvoiceKind, lines: Invoice['lines'], done: string, terms = 'Due on receipt') => {
    const id = crypto.randomUUID();
    const ok = await run(() => store.insert('invoices', {
      id, kind, job_id: row.job_id, estimate_id: row.id, bill_to: job?.client_name || title, address: project.address,
      invoice_date: todayIso(), due_date: todayIso(), terms, lines,
    }), done);
    if (ok) nav(`/invoices/${id}`);
  };
  const quoteLines = () => linesFromQuote(title, priced.divisions, priced.lines, priced.totals.grandTotal);
  const makeDeposit = () => makeInvoice('deposit', depositLines(title, project.quoteNumber, totalCents, depositPct), 'Deposit invoice made. Send it with the signed quote.');
  const makeFinal = () => {
    if (depositDue && !window.confirm('The deposit is not marked paid yet, so it will not be taken off the final invoice. Make the final invoice anyway?')) return;
    void makeInvoice('final', finalLines(quoteLines(), project.quoteNumber, openCos, deposits), 'Final invoice made. Check the lines, then make the PDF.');
  };
  const billChanges = () => makeInvoice('standard', changeOrderLines(openCos), 'Change order invoice made.');

  const steps: [string, boolean][] = [
    ['Send the quote', row.status !== 'draft' || !!job],
    ['Client signs', !!job],
    ...(depositPct > 0 ? [[`Deposit ${pctText(depositPct)}`, depositPaid] as [string, boolean]] : []),
    ['Final invoice', finals.length > 0],
    ['Paid', allPaid],
  ];
  const nowAt = steps.findIndex(([, done]) => !done);

  return (
    <section className="panel" aria-label="Quote to invoice">
      <h3>Quote → job → invoice{project.quoteNumber ? ` · ${quoteRef(project.quoteNumber)}` : ''}</h3>
      <ol className="steps">
        {steps.map(([label, done], n) => <li key={label} className={done ? 'done' : n === nowAt ? 'now' : ''}>{label}{done ? ' ✓' : ''}</li>)}
      </ol>
      {!job && (
        <div className="stack">
          <div className="row">
            {row.status === 'draft' && <button className="btn" onClick={markSent}>Mark as sent</button>}
            <button className="btn primary" onClick={() => setAccepting(true)}>Job accepted</button>
            {row.status === 'lost' && <span className="muted">This quote is marked lost.</span>}
          </div>
          {row.status === 'sent' && <p className="muted small">Wait for the signed quote. The signed quote is the agreement, so don't order anything or schedule the job until you have it.</p>}
        </div>
      )}
      {job && (
        <div className="stack">
          <p>Accepted. Job: <Link to={`/jobs/${job.id}/invoices`}>{job.name}</Link></p>
          {invoices.length > 0 && (
            <ul className="plain">
              {invoices.map((i) => <li key={i.id}><Link to={`/invoices/${i.id}`}>{KIND_WORD[i.kind] ? `${KIND_WORD[i.kind]} invoice` : 'Invoice'} {i.number}</Link> · {money(invoiceTotal(i))} · {invoiceStatus(i)}</li>)}
            </ul>
          )}
          {depositPct > 0 && deposits.length === 0 && (
            <div className="alert warn">Send the deposit invoice next. Don't order material or put the job on the schedule until the deposit is paid.</div>
          )}
          {depositDue && <div className="alert warn">The deposit is not paid yet. Don't order material or put the job on the schedule until it is.</div>}
          {depositPaid && finals.length === 0 && <p className="muted small">Deposit received. Order material and schedule the crew. If the client adds anything, write a change order on the job and get it signed before doing the work.</p>}
          {allPaid && <div className="alert calm">Paid in full. Pay the crew now, so the job never costs you money out of pocket.</div>}
          <div className="row">
            {depositPct > 0 && deposits.length === 0 && (
              <button className="btn primary" onClick={makeDeposit}>Make deposit invoice ({pctText(depositPct)}: {money(depositCents(totalCents, depositPct))})</button>
            )}
            {finals.length === 0 && (
              <button className={`btn${depositPct > 0 && deposits.length === 0 ? '' : ' primary'}`} onClick={makeFinal}>{depositPct > 0 ? 'Make final invoice' : 'Make invoice'}</button>
            )}
            {finals.length > 0 && openCos.length > 0 && (
              <button className="btn primary" onClick={billChanges}>Bill {openCos.length} new change order{openCos.length === 1 ? '' : 's'} ({money(openCos.reduce((s, c) => s + Number(c.price_delta_cents), 0))})</button>
            )}
          </div>
          {finals.length === 0 && openCos.length > 0 && <p className="muted small">The final invoice will include {openCos.length} signed change order{openCos.length === 1 ? '' : 's'}.</p>}
        </div>
      )}
      {accepting && (
        <FormModal
          title="Job accepted"
          submit="Accept and set up the job"
          intro={<p>Use this once the client has signed the quote. It marks the quote as won and puts it on a job, so you can invoice it. Quote total: <b>{money(totalCents)}</b>.</p>}
          fields={[
            { key: 'job', label: 'Job', type: 'select', options: [{ value: 'new', label: 'Make a new job' }, ...data.jobs.filter((j) => j.status !== 'closed').map((j) => ({ value: j.id, label: `Add to ${j.name}` }))] },
            { key: 'name', label: 'New job name', help: 'Only used when making a new job.' },
            { key: 'add_price', label: "Add this quote's total to the job's contract price", type: 'check' },
            { key: 'add_budget', label: "Add this quote's costs to the job budget", type: 'check', help: 'Material and labor, so you can track spending, write change orders, and pay the crew.' },
          ]}
          initial={{ job: 'new', name: title, add_price: true, add_budget: true }}
          onClose={() => setAccepting(false)}
          onSave={async (v) => {
            const isNew = v.job === 'new';
            const jobId = isNew ? crypto.randomUUID() : (v.job as string);
            const name = String(v.name ?? '').trim() || title;
            const ok = await run(async () => {
              if (isNew) {
                await store.insert('jobs', { id: jobId, name, address: project.address, job_type: 'client', status: 'active', sale_price_cents: v.add_price ? totalCents : 0, start_date: todayIso(), notes: `From ${quoteRef(project.quoteNumber)}, "${title}".` } as never);
              } else if (v.add_price) {
                const existing = data.jobs.find((j) => j.id === jobId)!;
                await store.update('jobs', jobId, { sale_price_cents: Number(existing.sale_price_cents) + totalCents });
              }
              if (v.add_budget) {
                const start = data.budget_lines.filter((l) => l.job_id === jobId).reduce((m, l) => Math.max(m, l.sort), 0);
                const lines = budgetFromQuote(priced).map((l, n) => ({ ...l, job_id: jobId, sort: start + n + 1 }));
                if (lines.length) await store.insert('budget_lines', lines as never);
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
