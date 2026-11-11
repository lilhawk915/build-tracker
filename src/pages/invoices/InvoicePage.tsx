import { Link, useNavigate, useParams } from 'react-router-dom';
import { store, useData } from '../../data';
import { money } from '../../domain/csv';
import { invoiceBalance, invoiceTotal } from '../../domain/invoice';
import { todayIso } from '../../domain/rules';
import type { Invoice, InvoiceLine } from '../../domain/types';
import { safeFileName } from '../../data/store';
import { NumberCell, TextBlock, TextCell, downloadFile, invoiceFileName, useEstimating, useInvoicePdf } from '../../estimator/ui';
import { statusChip } from './InvoicesPage';

const TERMS = ['Due on receipt', 'Net 7', 'Net 15', 'Net 30'];

export function InvoicePage() {
  const { invoiceId } = useParams();
  const { data, run } = useData();
  const nav = useNavigate();
  const { settings } = useEstimating();
  const pdf = useInvoicePdf();
  const inv = data.invoices.find((i) => i.id === invoiceId);
  if (!inv) return <div className="alert" role="alert">This invoice no longer exists or you don't have access to it.</div>;

  const job = data.jobs.find((j) => j.id === inv.job_id);
  const quote = data.estimates.find((e) => e.id === inv.estimate_id);
  const total = invoiceTotal(inv);
  const balance = invoiceBalance(inv);
  const set = (patch: Partial<Invoice>, done?: string) => run(() => store.update('invoices', inv.id, patch), done);
  const setLines = (lines: InvoiceLine[]) => set({ lines });
  const setLine = (n: number, patch: Partial<InvoiceLine>) => setLines(inv.lines.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  const company = settings.company;

  const download = async () => {
    const blob = await pdf.make(inv, company);
    if (blob) downloadFile(invoiceFileName(inv), blob);
  };
  // Keeps one copy per invoice in the job's files: saving again replaces the old copy.
  const saveToJob = async () => {
    if (!job) return;
    const blob = await pdf.make(inv, company);
    if (!blob) return;
    const title = `Invoice ${inv.number}`;
    const name = invoiceFileName(inv);
    await run(async () => {
      const old = data.documents.filter((d) => d.job_id === job.id && d.category === 'Invoices' && d.title === title);
      const file_path = await store.upload(`${job.id}/${crypto.randomUUID()}-${safeFileName(name)}`, new File([blob], name, { type: 'application/pdf' }));
      await store.insert('documents', { job_id: job.id, category: 'Invoices', title, file_name: name, file_path, revision: '', doc_date: inv.invoice_date, notes: `${inv.bill_to} ${money(total)}` } as never);
      for (const d of old) {
        await store.remove('documents', d.id);
        await store.removeFile(d.file_path).catch(() => {});
      }
    }, `Invoice ${inv.number} saved to ${job.name}'s files.`);
  };

  return (
    <div className="stack">
      <div className="row between">
        <Link to="/invoices">← All invoices</Link>
        <div className="row">
          <button className="btn" disabled={pdf.busy} onClick={download}>{pdf.busy ? 'Making PDF…' : 'Invoice PDF'}</button>
          {job && <button className="btn primary" disabled={pdf.busy} onClick={saveToJob}>Save PDF to job files</button>}
        </div>
      </div>

      <div className="panel estimatehead">
        <h1 style={{ margin: 0 }}>Invoice {inv.number} {statusChip(inv)}</h1>
        <div className="inrow"><span>Bill to</span><TextCell className="field" label="Bill to" value={inv.bill_to} onCommit={(v) => set({ bill_to: v })} /></div>
        <div className="inrow"><span>Property address</span><TextCell className="field" label="Property address" value={inv.address} onCommit={(v) => set({ address: v })} /></div>
        <div className="inrow"><span>Invoice date</span><TextCell className="field" type="date" label="Invoice date" value={inv.invoice_date} onCommit={(v) => v && set({ invoice_date: v })} /></div>
        <div className="inrow">
          <span>Terms</span>
          <select aria-label="Terms" value={TERMS.includes(inv.terms) ? inv.terms : 'Due on receipt'} onChange={(e) => {
            const terms = e.target.value;
            const days = Number(terms.replace(/\D/g, '')) || 0;
            const due = new Date(`${inv.invoice_date}T12:00:00`);
            due.setDate(due.getDate() + days);
            void set({ terms, due_date: due.toISOString().slice(0, 10) });
          }}>
            {TERMS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="inrow"><span>Due date</span><TextCell className="field" type="date" label="Due date" value={inv.due_date ?? ''} onCommit={(v) => set({ due_date: v || null })} /></div>
        <div className="inrow">
          <span>Job</span>
          <span className="row nowrap">
            <select aria-label="Job" value={inv.job_id ?? ''} onChange={(e) => void set({ job_id: e.target.value || null }, 'Job changed.')}>
              <option value="">No job</option>
              {data.jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
            {job && <Link to={`/jobs/${job.id}/invoices`}>Open job</Link>}
          </span>
        </div>
        {quote && <div className="inrow"><span>From quote</span><Link to={`/estimates/${quote.id}`}>{quote.client_name || quote.address}</Link></div>}
      </div>

      <section className="panel" aria-label="Invoice lines">
        <h3>What you're billing for</h3>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Description</th><th>Details</th><th className="right">Amount ($)</th><th /></tr></thead>
            <tbody>
              {inv.lines.map((l, n) => (
                <tr key={n}>
                  <td><TextCell label={`Line ${n + 1} description`} value={l.description} onCommit={(v) => setLine(n, { description: v })} /></td>
                  <td><TextBlock label={`Line ${n + 1} details`} rows={2} value={l.detail} onCommit={(v) => setLine(n, { detail: v })} /></td>
                  <td className="right"><NumberCell label={`Line ${n + 1} amount`} value={(Number(l.amount_cents) || 0) / 100} min={-1e9} onCommit={(v) => setLine(n, { amount_cents: Math.round((v ?? 0) * 100) })} /></td>
                  <td className="actions"><button className="btn tiny danger" aria-label={`Remove line ${n + 1}`} onClick={() => setLines(inv.lines.filter((_, i) => i !== n))}>Remove</button></td>
                </tr>
              ))}
              <tr><td colSpan={2}><b>Total</b></td><td className="right num"><b>{money(total)}</b></td><td /></tr>
            </tbody>
          </table>
        </div>
        <button className="btn" onClick={() => setLines([...inv.lines, { description: 'New line', detail: '', amount_cents: 0 }])}>Add a line</button>
      </section>

      <section className="panel" aria-label="Payments">
        <h3>Payments</h3>
        <div className="inrow"><span>Paid so far ($)</span><NumberCell className="field num" label="Paid so far" value={Number(inv.paid_cents) / 100} onCommit={(v) => set({ paid_cents: Math.round((v ?? 0) * 100), paid_date: inv.paid_date ?? todayIso() }, 'Payment saved.')} /></div>
        <div className="inrow"><span>Last payment date</span><TextCell className="field" type="date" label="Last payment date" value={inv.paid_date ?? ''} onCommit={(v) => set({ paid_date: v || null })} /></div>
        <dl className="figs strip">
          <div><dt>Total</dt><dd>{money(total)}</dd></div>
          <div><dt>Paid</dt><dd>{money(Number(inv.paid_cents))}</dd></div>
          <div><dt>Balance due</dt><dd>{money(balance)}</dd></div>
        </dl>
        {balance > 0 && <button className="btn primary" onClick={() => set({ paid_cents: total, paid_date: todayIso() }, `Invoice ${inv.number} marked paid in full.`)}>Mark paid in full</button>}
      </section>

      <label className="field">Notes on the invoice<TextBlock label="Invoice notes" rows={3} value={inv.notes} onCommit={(v) => set({ notes: v })} /></label>
      {!company.name && <div className="alert warn">Your company name is blank, so the PDF has no header. Fill it in under Estimates → Quote settings.</div>}

      <p className="muted small">
        <button className="linkish danger" onClick={async () => {
          if (!window.confirm(`Delete invoice ${inv.number}? This cannot be undone. Its number is not reused.`)) return;
          if (await run(() => store.remove('invoices', inv.id), `Invoice ${inv.number} deleted.`)) nav('/invoices');
        }}>Delete this invoice</button>
      </p>
    </div>
  );
}
