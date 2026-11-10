import { useState } from 'react';
import { Empty, FormModal, money, Status } from '../../components/ui';
import { store, useData } from '../../data';
import { poTotal } from '../../domain/budget';
import type { Job, Po } from '../../domain/types';

export function PosTab({ job }: { job: Job }) {
  const { data, run } = useData();
  const [edit, setEdit] = useState<Po | 'new' | null>(null);
  const pos = data.pos.filter((p) => p.job_id === job.id).sort((a, b) => a.number - b.number);
  const lines = data.budget_lines.filter((l) => l.job_id === job.id).sort((a, b) => a.sort - b.sort);
  const billedOn = (id: string) =>
    data.bills.filter((b) => b.po_id === id && (b.status === 'approved' || b.status === 'paid')).reduce((s, b) => s + b.amount_cents, 0);
  const vendorName = (id: string) => data.vendors.find((v) => v.id === id)?.name ?? '';
  const lineName = (id: string) => lines.find((l) => l.id === id)?.name ?? '';

  return (
    <div className="stack">
      <div className="row between">
        <h2>Purchase orders</h2>
        <button className="btn primary" disabled={!data.vendors.length || !lines.length} onClick={() => setEdit('new')}>Add a PO</button>
      </div>
      {!data.vendors.length && <div className="alert warn">Add a sub on the Subs page before writing a PO.</div>}
      {pos.length === 0 ? <Empty>A PO records what you agreed to pay a sub. Subs bill against it.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>PO</th><th>Sub</th><th>Scope</th><th>Budget line</th><th className="right">Total</th><th className="right">Billed</th><th>Status</th><th /></tr></thead>
            <tbody>
              {pos.map((p) => {
                const billed = billedOn(p.id);
                return (
                  <tr key={p.id}>
                    <td className="num">{p.number}</td>
                    <td>{vendorName(p.vendor_id)}</td>
                    <td>{p.description}</td>
                    <td>{lineName(p.budget_line_id)}</td>
                    <td className="right num">
                      {money(poTotal(p))}
                      {p.approved_co_cents !== 0 && <div className="muted small">incl. {money(p.approved_co_cents)} changes</div>}
                    </td>
                    <td className="right num">
                      {money(billed)}
                      {billed > poTotal(p) && <div><span className="flag">Over PO</span></div>}
                    </td>
                    <td><Status s={p.status} /></td>
                    <td className="actions">
                      {p.status === 'draft' && <button className="btn tiny" onClick={() => run(() => store.update('pos', p.id, { status: 'sent' }), `PO ${p.number} sent. It now shows in the sub's portal.`)}>Send</button>}
                      {p.status === 'sent' && <button className="btn tiny" onClick={() => run(() => store.update('pos', p.id, { status: 'accepted' }), `PO ${p.number} marked accepted.`)}>Mark accepted</button>}
                      {p.status === 'accepted' && <button className="btn tiny" onClick={() => run(() => store.update('pos', p.id, { status: 'closed' }), `PO ${p.number} closed.`)}>Close</button>}
                      {p.status === 'declined' && <button className="btn tiny" onClick={() => run(() => store.update('pos', p.id, { status: 'draft' }), `PO ${p.number} moved back to draft.`)}>Reopen</button>}
                      {(p.status === 'draft' || p.status === 'declined') && <button className="btn tiny" onClick={() => setEdit(p)}>Edit</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <FormModal
          title={edit === 'new' ? 'Add a PO' : `Edit PO ${edit.number}`}
          submit={edit === 'new' ? 'Add PO' : 'Save PO'}
          fields={[
            { key: 'vendor_id', label: 'Sub', type: 'select', required: true, options: data.vendors.map((v) => ({ value: v.id, label: `${v.name}${v.trade ? ` (${v.trade})` : ''}` })) },
            { key: 'budget_line_id', label: 'Budget line', type: 'select', required: true, options: lines.map((l) => ({ value: l.id, label: l.name })) },
            { key: 'description', label: 'Scope of work', type: 'textarea', required: true, help: 'The sub sees this.' },
            { key: 'amount_cents', label: 'Amount', type: 'money', required: true },
          ]}
          initial={edit === 'new' ? { vendor_id: data.vendors[0]?.id, budget_line_id: lines[0]?.id, status: 'draft' } : (edit as never)}
          onClose={() => setEdit(null)}
          onSave={async (v) => {
            const ok = await run(
              () => edit === 'new'
                ? store.insert('pos', { ...v, job_id: job.id, status: 'draft' } as never)
                : store.update('pos', edit.id, v as never),
              'PO saved as a draft. Send it when it is ready.',
            );
            if (ok) setEdit(null);
          }}
        />
      )}
    </div>
  );
}
