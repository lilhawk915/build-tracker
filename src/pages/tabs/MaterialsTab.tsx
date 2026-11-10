import { useState } from 'react';
import { Empty, FormModal, money, Status } from '../../components/ui';
import { store, useData } from '../../data';
import { isRequested, materialLate, needsOrdering, parseMaterialLines, summarizeMaterials } from '../../domain/jobops';
import { todayIso } from '../../domain/rules';
import type { Job, Material, MaterialStatus } from '../../domain/types';

const WORD: Record<MaterialStatus, string> = { needed: 'Needed', ordered: 'On order', arrived: 'Arrived' };

export function MaterialsTab({ job }: { job: Job }) {
  const { data, run } = useData();
  const [edit, setEdit] = useState<Material | 'new' | null>(null);
  const [ordering, setOrdering] = useState<Material | null>(null);
  const [many, setMany] = useState(false);
  const [show, setShow] = useState<MaterialStatus | ''>('');
  const today = todayIso();
  const all = data.materials.filter((m) => m.job_id === job.id);
  const rows = all.filter((m) => !show || m.status === show)
    .sort((a, b) => Number(isRequested(b)) - Number(isRequested(a)) || a.status.localeCompare(b.status) || (a.expected_date ?? a.needed_by ?? '').localeCompare(b.expected_date ?? b.needed_by ?? ''));
  const sum = summarizeMaterials(all, today);

  return (
    <div className="stack">
      <div className="row between">
        <h2>Materials</h2>
        <div className="row">
          <button className="btn" onClick={() => setMany(true)}>Add a list</button>
          <button className="btn primary" onClick={() => setEdit('new')}>Add an item</button>
        </div>
      </div>
      <div className="panel">
        <dl className="figs strip">
          <div><dt>Still to order</dt><dd>{sum.needed}</dd></div>
          <div><dt>On order</dt><dd>{sum.ordered}</dd></div>
          <div><dt>Late</dt><dd>{sum.late}</dd></div>
          <div><dt>Arrived</dt><dd>{sum.arrived}</dd></div>
          <div><dt>Ordered so far</dt><dd>{money(sum.orderedCost)}</dd></div>
        </dl>
      </div>
      <p className="muted small">Costs here are for reference. The budget still counts bills, so nothing is counted twice.</p>
      <label className="field" style={{ maxWidth: 220 }}>
        <span>Show</span>
        <select value={show} onChange={(e) => setShow(e.target.value as MaterialStatus | '')}>
          <option value="">Everything</option>
          <option value="needed">Still to order</option>
          <option value="ordered">On order</option>
          <option value="arrived">Arrived</option>
        </select>
      </label>
      {rows.length === 0 ? <Empty>{all.length ? 'Nothing in this view.' : 'Add what this job needs to buy. You can paste a whole list at once.'}</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Supplier</th><th>Order no.</th><th>Status</th><th>Need by</th><th>Ordered</th><th>Arriving</th><th>Arrived</th><th className="right">Cost</th><th /></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <b>{m.name}</b>
                    {isRequested(m) && <div><span className="flag">Asked for by {m.requested_by_name}</span></div>}
                    {m.notes && <div className="small muted">{m.notes}</div>}
                  </td>
                  <td>{m.quantity}</td>
                  <td>{m.supplier}</td>
                  <td className="num small">{m.order_number}</td>
                  <td>
                    {materialLate(m, today) ? <span className="flag">Late</span>
                      : needsOrdering(m, today) ? <span className="flag">Order now</span>
                      : <span className={`chip ${m.status === 'arrived' ? 'good' : m.status === 'ordered' ? 'warn' : ''}`}>{WORD[m.status]}</span>}
                  </td>
                  <td className="num small">{m.needed_by}</td>
                  <td className="num small">{m.ordered_date}</td>
                  <td className="num small">{m.status === 'ordered' ? m.expected_date : ''}</td>
                  <td className="num small">{m.arrived_date}</td>
                  <td className="right num">{m.cost_cents != null ? money(m.cost_cents) : ''}</td>
                  <td className="actions">
                    {m.status === 'needed' && <button className="btn tiny" onClick={() => setOrdering(m)}>Mark ordered</button>}
                    {m.status === 'ordered' && <button className="btn tiny" onClick={() => run(() => store.update('materials', m.id, { status: 'arrived', arrived_date: today }), `${m.name} marked arrived.`)}>Mark arrived</button>}
                    <button className="btn tiny" onClick={() => setEdit(m)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {many && (
        <FormModal
          title="Add a list of materials"
          submit="Add list"
          fields={[
            { key: 'lines', label: 'One item per line', type: 'textarea', required: true, help: 'A number at the start becomes the quantity, like: 120 2x4x8 studs' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'needed_by', label: 'Need by', type: 'date' },
          ]}
          onClose={() => setMany(false)}
          onSave={async ({ lines, supplier, needed_by }) => {
            const items = parseMaterialLines(lines as string);
            if (!items.length) throw new Error('One item per line: enter at least one item.');
            const ok = await run(
              () => store.insert('materials', items.map((i) => ({ ...i, job_id: job.id, status: 'needed' as const, supplier: supplier as string, needed_by: needed_by as string | null }))),
              `${items.length} item${items.length === 1 ? '' : 's'} added.`,
            );
            if (ok) setMany(false);
          }}
        />
      )}

      {ordering && (
        <FormModal
          title={`Mark ${ordering.name} ordered`}
          submit="Mark ordered"
          fields={[
            { key: 'ordered_date', label: 'Ordered on', type: 'date', required: true },
            { key: 'expected_date', label: 'Arriving', type: 'date', help: 'You get a flag if it hasn’t arrived by this date.' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'order_number', label: 'Order number' },
            { key: 'cost_cents', label: 'Cost', type: 'money' },
          ]}
          initial={{ ...ordering, ordered_date: today }}
          onClose={() => setOrdering(null)}
          onSave={async (v) => {
            const ok = await run(() => store.update('materials', ordering.id, { ...v, status: 'ordered', cost_cents: (v.cost_cents as number) || null } as never), `${ordering.name} marked ordered.`);
            if (ok) setOrdering(null);
          }}
        />
      )}

      {edit && (
        <FormModal
          title={edit === 'new' ? 'Add a material' : `Edit ${edit.name}`}
          submit={edit === 'new' ? 'Add item' : 'Save item'}
          fields={[
            { key: 'name', label: 'Item', required: true },
            { key: 'quantity', label: 'Quantity' },
            { key: 'status', label: 'Status', type: 'select', options: (Object.keys(WORD) as MaterialStatus[]).map((k) => ({ value: k, label: WORD[k] })) },
            { key: 'supplier', label: 'Supplier' },
            { key: 'order_number', label: 'Order number' },
            { key: 'needed_by', label: 'Need by', type: 'date' },
            { key: 'ordered_date', label: 'Ordered on', type: 'date' },
            { key: 'expected_date', label: 'Arriving', type: 'date' },
            { key: 'arrived_date', label: 'Arrived on', type: 'date' },
            { key: 'cost_cents', label: 'Cost', type: 'money' },
            { key: 'notes', label: 'Notes', type: 'textarea', help: 'Crew on this job can see these.' },
          ]}
          initial={edit === 'new' ? { status: 'needed' } : (edit as never)}
          onClose={() => setEdit(null)}
          intro={edit !== 'new' ? (
            <button type="button" className="btn danger tiny" style={{ justifySelf: 'start' }} onClick={async () => {
              if (await run(() => store.remove('materials', edit.id), 'Item deleted.')) setEdit(null);
            }}>Delete this item</button>
          ) : undefined}
          onSave={async (v) => {
            const row = { ...v, cost_cents: (v.cost_cents as number) || null };
            const ok = await run(
              () => edit === 'new' ? store.insert('materials', { ...row, job_id: job.id } as never) : store.update('materials', edit.id, row as never),
              'Item saved.',
            );
            if (ok) setEdit(null);
          }}
        />
      )}
    </div>
  );
}
