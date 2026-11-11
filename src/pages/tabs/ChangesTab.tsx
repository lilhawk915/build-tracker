import { useState } from 'react';
import { Empty, FormModal, money, Status } from '../../components/ui';
import { store, useData } from '../../data';
import { isOwnProject, type ChangeOrder, type Job } from '../../domain/types';
import { todayIso } from '../../domain/rules';
import { useChangeOrderPdf, useEstimating } from '../../estimator/ui';

export function ChangesTab({ job }: { job: Job }) {
  const { data, run } = useData();
  const [edit, setEdit] = useState<ChangeOrder | 'new' | null>(null);
  const cos = data.change_orders.filter((c) => c.job_id === job.id).sort((a, b) => a.number - b.number);
  const lines = data.budget_lines.filter((l) => l.job_id === job.id).sort((a, b) => a.sort - b.sort);
  const pos = data.pos.filter((p) => p.job_id === job.id && ['sent', 'accepted'].includes(p.status)).sort((a, b) => a.number - b.number);
  const lineName = (id: string) => lines.find((l) => l.id === id)?.name ?? '';
  const poNumber = (id: string | null) => data.pos.find((p) => p.id === id)?.number;
  const isClient = !isOwnProject(job.job_type);
  const { settings } = useEstimating();
  const coPdf = useChangeOrderPdf();
  const quote = data.estimates.find((e) => e.job_id === job.id);
  // The contract before a change: the job price plus every earlier approved change.
  const before = (c: ChangeOrder) => Number(job.sale_price_cents) + cos.filter((o) => o.status === 'approved' && o.number < c.number).reduce((s, o) => s + Number(o.price_delta_cents), 0);
  const printCo = (c: ChangeOrder) => coPdf.download({
    number: c.number, description: c.description, price_cents: Number(c.price_delta_cents), date: todayIso(),
    job_name: job.name, client: job.client_name || quote?.client_name || job.name, address: job.address, quote_number: quote?.number,
    contract_before_cents: before(c),
  }, settings.company);

  return (
    <div className="stack">
      <div className="row between">
        <h2>Change orders</h2>
        <button className="btn primary" onClick={() => setEdit('new')}>Add a change order</button>
      </div>
      {isClient && <p className="muted small">Write the change with its price, print the change order PDF, and get it signed before doing the work. Then press Approve. Approved changes add to the contract and go on the final invoice.</p>}
      {cos.length === 0 ? <Empty>Record extra work here before it starts, so it reaches the budget and the PO.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>No.</th><th>Description</th><th>Budget line</th><th>PO</th><th className="right">Cost</th>{isClient && <th className="right">Client price</th>}<th>Status</th><th /></tr></thead>
            <tbody>
              {cos.map((c) => (
                <tr key={c.id}>
                  <td className="num">{c.number}</td>
                  <td>{c.description}</td>
                  <td>{lineName(c.budget_line_id)}</td>
                  <td className="num">{poNumber(c.po_id) ?? ''}</td>
                  <td className="right num">{money(c.cost_delta_cents)}</td>
                  {isClient && <td className="right num">{money(c.price_delta_cents)}</td>}
                  <td><Status s={c.status} /></td>
                  <td className="actions">
                    {isClient && c.status !== 'rejected' && <button className="btn tiny" disabled={coPdf.busy} onClick={() => printCo(c)}>PDF</button>}
                    {c.status === 'pending' && <button className="btn tiny" onClick={() => setEdit(c)}>Edit</button>}
                    {c.status === 'pending' && <button className="btn tiny" onClick={() => run(() => store.update('change_orders', c.id, { status: 'rejected' }), `Change order ${c.number} rejected.`)}>Reject</button>}
                    {c.status === 'pending' && <button className="btn tiny" onClick={() => run(() => store.update('change_orders', c.id, { status: 'approved' }), `Change order ${c.number} approved. Budget updated.`)}>Approve</button>}
                    {c.status === 'approved' && <button className="btn tiny" onClick={() => { if (window.confirm('Undo this approval? The budget and PO go back down.')) void run(() => store.update('change_orders', c.id, { status: 'pending' }), 'Approval undone.'); }}>Undo</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <FormModal
          title={edit === 'new' ? 'Add a change order' : `Edit change order ${edit.number}`}
          submit={edit === 'new' ? 'Add change order' : 'Save change order'}
          fields={[
            { key: 'description', label: 'What changed', type: 'textarea', required: true },
            ...(lines.length ? [{ key: 'budget_line_id', label: 'Budget line', type: 'select' as const, required: true, options: lines.map((l) => ({ value: l.id, label: l.name })) }] : []),
            { key: 'po_id', label: 'Add to PO', type: 'select', options: [{ value: '', label: 'No PO' }, ...pos.map((p) => ({ value: p.id, label: `PO ${p.number}: ${lineName(p.budget_line_id)}` }))], help: "The PO must be on the same budget line." },
            { key: 'cost_delta_cents', label: 'Change to your cost', type: 'money', allowNegative: true, help: 'Enter a negative number for a credit.' },
            ...(isClient ? [{ key: 'price_delta_cents', label: 'Change to client price', type: 'money' as const, allowNegative: true }] : []),
          ]}
          initial={edit === 'new' ? { budget_line_id: lines[0]?.id, po_id: '', cost_delta_cents: 0, price_delta_cents: 0 } : { ...edit, po_id: edit.po_id ?? '' }}
          onClose={() => setEdit(null)}
          onSave={async (v) => {
            const po = pos.find((p) => p.id === v.po_id);
            if (po && po.budget_line_id !== v.budget_line_id) throw new Error('That PO is on a different budget line.');
            const row: Record<string, unknown> = { ...v, po_id: po?.id ?? null };
            const ok = await run(async () => {
              // A job with no budget yet gets one line for extra work, so the change has somewhere to go.
              if (!lines.length) {
                const lineId = crypto.randomUUID();
                await store.insert('budget_lines', { id: lineId, job_id: job.id, name: 'Change orders and extra work', budget_cents: 0, sort: 1 } as never);
                row.budget_line_id = lineId;
              }
              if (edit === 'new') await store.insert('change_orders', { ...row, job_id: job.id, status: 'pending', price_delta_cents: (v.price_delta_cents as number) ?? 0 } as never);
              else await store.update('change_orders', edit.id, row as never);
            }, 'Change order saved.');
            if (ok) setEdit(null);
          }}
        />
      )}
    </div>
  );
}
