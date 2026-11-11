import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Empty } from '../../components/ui';
import { useData } from '../../data';
import { money } from '../../domain/csv';
import { invoiceBalance, invoiceStatus, invoiceTotal } from '../../domain/invoice';
import type { Invoice } from '../../domain/types';

export const statusChip = (i: Invoice) => {
  const st = invoiceStatus(i);
  return <span className={`chip ${st === 'Paid' ? 'good' : st === 'Part paid' ? 'warn' : ''}`}>{st}</span>;
};

export function InvoiceTable({ rows, showJob = true }: { rows: Invoice[]; showJob?: boolean }) {
  const { data } = useData();
  const jobName = (id: string | null) => data.jobs.find((j) => j.id === id)?.name;
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>#</th><th>Bill to</th>{showJob && <th>Job</th>}<th>Date</th><th className="right">Total</th><th className="right">Paid</th><th className="right">Balance</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id}>
              <td className="num"><Link to={`/invoices/${i.id}`}>{i.number}</Link></td>
              <td><Link to={`/invoices/${i.id}`}>{i.bill_to || i.address || 'No name yet'}</Link></td>
              {showJob && <td>{i.job_id && jobName(i.job_id) ? <Link to={`/jobs/${i.job_id}/invoices`}>{jobName(i.job_id)}</Link> : <span className="muted">No job</span>}</td>}
              <td className="num">{i.invoice_date}</td>
              <td className="right num">{money(invoiceTotal(i))}</td>
              <td className="right num">{money(Number(i.paid_cents))}</td>
              <td className="right num">{money(invoiceBalance(i))}</td>
              <td>{statusChip(i)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InvoicesPage() {
  const { data } = useData();
  const [show, setShow] = useState<'open' | 'all'>('open');
  const all = [...data.invoices].sort((a, b) => b.number - a.number);
  const rows = show === 'open' ? all.filter((i) => invoiceStatus(i) !== 'Paid') : all;
  const owed = all.reduce((s, i) => s + Math.max(invoiceBalance(i), 0), 0);
  return (
    <div className="stack">
      <div className="row between">
        <h1>Invoices</h1>
        <div className="row">
          <select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as 'open' | 'all')}>
            <option value="open">Not paid yet</option>
            <option value="all">All invoices</option>
          </select>
        </div>
      </div>
      <dl className="figs strip">
        <div><dt>Owed to you</dt><dd>{money(owed)}</dd></div>
        <div><dt>Invoices</dt><dd>{all.length}</dd></div>
      </dl>
      <p className="muted">To bill a customer: open their estimate, click <b>Job accepted</b>, then <b>Make invoice</b>.</p>
      {rows.length === 0 ? <Empty>{show === 'open' ? 'Nothing is waiting to be paid.' : 'No invoices yet.'}</Empty> : <InvoiceTable rows={rows} />}
    </div>
  );
}
