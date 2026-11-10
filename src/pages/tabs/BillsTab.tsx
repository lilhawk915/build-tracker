import { useState } from 'react';
import { downloadCsv, Empty, FileLink, FormModal, money, Status } from '../../components/ui';
import { store, useData } from '../../data';
import { centsToDecimal, toCsv } from '../../domain/csv';
import { payBlockers, todayIso } from '../../domain/rules';
import { safeFileName } from '../../data/store';
import type { Bill, Job } from '../../domain/types';

export function BillsTab({ job }: { job: Job }) {
  const { data, run, me } = useData();
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [rejecting, setRejecting] = useState<Bill | null>(null);
  const bills = data.bills.filter((b) => b.job_id === job.id).sort((a, b) => b.bill_date.localeCompare(a.bill_date));
  const lines = data.budget_lines.filter((l) => l.job_id === job.id).sort((a, b) => a.sort - b.sort);
  const pos = data.pos.filter((p) => p.job_id === job.id && ['sent', 'accepted', 'closed'].includes(p.status)).sort((a, b) => a.number - b.number);
  const vendor = (id: string) => data.vendors.find((v) => v.id === id);
  const line = (id: string) => lines.find((l) => l.id === id)?.name ?? '';
  const isAdmin = me.role === 'admin';

  function exportPaid() {
    const rows = bills.filter((b) => b.status === 'paid');
    downloadCsv(`${job.name.replace(/\W+/g, '-')}-paid-bills.csv`, toCsv([
      ['Vendor', 'Bill No', 'Bill Date', 'Paid Date', 'Category', 'Job', 'Amount'],
      ...rows.map((b) => [vendor(b.vendor_id)?.name, b.invoice_no, b.bill_date, b.paid_date, line(b.budget_line_id), job.name, centsToDecimal(b.amount_cents)]),
    ]));
  }

  return (
    <div className="stack">
      <div className="row between">
        <h2>Bills</h2>
        <div className="row">
          <button className="btn" disabled={!bills.some((b) => b.status === 'paid')} onClick={exportPaid}>Download paid bills (CSV)</button>
          <button className="btn primary" disabled={!data.vendors.length || !lines.length} onClick={() => setAdding(true)}>Add a bill</button>
        </div>
      </div>
      {bills.length === 0 ? <Empty>No bills yet. Subs can submit bills from their portal, or add one here.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Sub</th><th>Invoice</th><th>Budget line</th><th className="right">Amount</th><th>Status</th><th>Can it be paid?</th><th /></tr></thead>
            <tbody>
              {bills.map((b) => {
                const blocks = b.status === 'approved' ? payBlockers(vendor(b.vendor_id), data.lien_waivers, b.id, todayIso()) : [];
                return (
                  <tr key={b.id}>
                    <td className="num">{b.bill_date}</td>
                    <td>{vendor(b.vendor_id)?.name}</td>
                    <td>{b.invoice_no}</td>
                    <td>{line(b.budget_line_id)}</td>
                    <td className="right num">{money(b.amount_cents)}</td>
                    <td><Status s={b.status} /></td>
                    <td className="small">
                      {b.status === 'approved' && (blocks.length ? <span className="flag">Blocked</span> : <span className="chip good">Ready</span>)}
                      {blocks.map((x) => <div key={x} className="muted">{x}</div>)}
                      {b.status === 'paid' && <span className="muted">Paid {b.paid_date}</span>}
                      {b.override_reason && <div className="muted">Override: {b.override_reason}</div>}
                      {b.status === 'rejected' && b.notes && <span className="muted">{b.notes}</span>}
                    </td>
                    <td className="actions">
                      {b.file_path && <FileLink path={b.file_path} />}
                      {b.status === 'submitted' && <button className="btn tiny" onClick={() => run(() => store.update('bills', b.id, { status: 'approved' }), 'Bill approved. A lien waiver was requested.')}>Approve</button>}
                      {(b.status === 'submitted' || b.status === 'approved') && <button className="btn tiny" onClick={() => setRejecting(b)}>Reject</button>}
                      {b.status === 'approved' && <button className="btn tiny" onClick={() => setPaying(b)}>Pay</button>}
                      {b.status === 'paid' && isAdmin && <button className="btn tiny" onClick={() => { if (window.confirm('Undo this payment?')) void run(() => store.update('bills', b.id, { status: 'approved' }), 'Payment undone.'); }}>Undo</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <FormModal
          title="Add a bill"
          submit="Add bill"
          fields={[
            { key: 'vendor_id', label: 'Sub', type: 'select', required: true, options: data.vendors.map((v) => ({ value: v.id, label: v.name })) },
            { key: 'po_id', label: 'PO', type: 'select', options: [{ value: '', label: 'No PO' }, ...pos.map((p) => ({ value: p.id, label: `PO ${p.number}: ${vendor(p.vendor_id)?.name}, ${money(p.amount_cents + p.approved_co_cents)}` }))], help: "A PO sets the sub and budget line, so they must match." },
            { key: 'budget_line_id', label: 'Budget line', type: 'select', options: lines.map((l) => ({ value: l.id, label: l.name })), help: 'Used only when there is no PO.' },
            { key: 'invoice_no', label: 'Invoice number' },
            { key: 'amount_cents', label: 'Amount', type: 'money', required: true },
            { key: 'bill_date', label: 'Bill date', type: 'date', required: true },
            { key: 'file', label: 'Invoice file', type: 'file' },
          ]}
          initial={{ vendor_id: data.vendors[0]?.id, budget_line_id: lines[0]?.id, po_id: '', bill_date: todayIso() }}
          onClose={() => setAdding(false)}
          onSave={async ({ file, ...v }) => {
            if (!v.amount_cents) throw new Error('Amount: enter more than $0.');
            const po = pos.find((p) => p.id === v.po_id);
            if (po && po.vendor_id !== v.vendor_id) throw new Error('That PO belongs to a different sub.');
            const ok = await run(async () => {
              const file_path = file
                ? await store.upload(`${job.id}/${crypto.randomUUID()}-${safeFileName((file as File).name)}`, file as File)
                : null;
              await store.insert('bills', { ...v, po_id: po?.id ?? null, budget_line_id: po?.budget_line_id ?? v.budget_line_id, job_id: job.id, status: 'submitted', file_path } as never);
            }, 'Bill added. Approve it to request the lien waiver.');
            if (ok) setAdding(false);
          }}
        />
      )}

      {rejecting && (
        <FormModal
          title="Reject this bill"
          submit="Reject bill"
          fields={[{ key: 'notes', label: 'Reason', type: 'textarea', required: true, help: 'The sub sees this.' }]}
          onClose={() => setRejecting(null)}
          onSave={async (v) => {
            if (await run(() => store.update('bills', rejecting.id, { status: 'rejected', notes: v.notes as string }), 'Bill rejected.')) setRejecting(null);
          }}
        />
      )}

      {paying && <PayModal bill={paying} isAdmin={isAdmin} onClose={() => setPaying(null)} />}
    </div>
  );
}

function PayModal({ bill, isAdmin, onClose }: { bill: Bill; isAdmin: boolean; onClose: () => void }) {
  const { data, run } = useData();
  const vendor = (id: string) => data.vendors.find((v) => v.id === id);
  const blocks = payBlockers(vendor(bill.vendor_id), data.lien_waivers, bill.id, todayIso());
  return (
    <FormModal
      title={`Pay ${vendor(bill.vendor_id)?.name} ${money(bill.amount_cents)}`}
      submit={blocks.length ? 'Pay with override' : 'Record payment'}
      fields={[
        { key: 'paid_date', label: 'Paid date', type: 'date', required: true },
        ...(blocks.length && isAdmin ? [{ key: 'override_reason', label: 'Reason for override', type: 'textarea' as const, required: true, help: 'Saved on the bill permanently.' }] : []),
      ]}
      initial={{ paid_date: todayIso() }}
      intro={blocks.length ? (
        <div className="alert" role="alert">
          Payment is blocked: {blocks.join(', ')}.
          {isAdmin ? ' You can override this as an admin.' : ' Ask an admin to override it, or clear these first.'}
        </div>
      ) : <div className="alert calm">Insurance is current and the lien waiver is in. This only records the payment; it doesn't send money.</div>}
      onClose={onClose}
      onSave={async (v) => {
        const ok = await run(() => store.update('bills', bill.id, { status: 'paid', paid_date: v.paid_date as string, override_reason: (v.override_reason as string) ?? null }), 'Payment recorded. The unconditional waiver was requested.');
        if (ok) onClose();
      }}
    />
  );
}
