import { Link } from 'react-router-dom';
import { Empty } from '../../components/ui';
import { useData } from '../../data';
import { money } from '../../domain/csv';
import { invoiceBalance, invoiceTotal } from '../../domain/invoice';
import type { Job } from '../../domain/types';
import { InvoiceTable } from '../invoices/InvoicesPage';

/** Admins only: what the customer was quoted, billed, and has paid on this job. */
export function InvoicesTab({ job }: { job: Job }) {
  const { data } = useData();
  const rows = data.invoices.filter((i) => i.job_id === job.id).sort((a, b) => a.number - b.number);
  const quotes = data.estimates.filter((e) => e.job_id === job.id);
  const billed = rows.reduce((s, i) => s + invoiceTotal(i), 0);
  const paid = rows.reduce((s, i) => s + Number(i.paid_cents), 0);
  const owed = rows.reduce((s, i) => s + Math.max(invoiceBalance(i), 0), 0);
  return (
    <div className="stack">
      <h2>Quotes and invoices</h2>
      <dl className="figs strip">
        <div><dt>Contract price</dt><dd>{money(Number(job.sale_price_cents))}</dd></div>
        <div><dt>Invoiced</dt><dd>{money(billed)}</dd></div>
        <div><dt>Paid</dt><dd>{money(paid)}</dd></div>
        <div><dt>Still owed</dt><dd>{money(owed)}</dd></div>
      </dl>
      {quotes.length > 0 && (
        <p>Accepted quotes: {quotes.map((q, n) => <span key={q.id}>{n ? ', ' : ''}<Link to={`/estimates/${q.id}`}>{q.client_name || q.address}</Link></span>)}</p>
      )}
      {rows.length === 0
        ? <Empty>No invoices on this job yet. Open its accepted quote and click Make invoice.</Empty>
        : <InvoiceTable rows={rows} showJob={false} />}
    </div>
  );
}
