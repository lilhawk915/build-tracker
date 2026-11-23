import { useState } from 'react';
import { Empty, FormModal, money, Status } from '../../components/ui';
import { store, useData } from '../../data';
import { arrivesTooLate, isRequested, leadWords, materialLate, neededOn, orderByDate, orderFlag, parseMaterialLines, stepFor, summarizeMaterials } from '../../domain/jobops';
import { addDays } from '../../domain/schedule';
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
  const steps = data.tasks.filter((t) => t.job_id === job.id).sort((a, b) => a.start_date.localeCompare(b.start_date) || a.sort - b.sort);
  const when = (m: Material) => (m.status === 'needed' ? orderByDate(m, steps) ?? neededOn(m, steps) : m.expected_date ?? neededOn(m, steps)) ?? '';
  const rows = all.filter((m) => !show || m.status === show)
    .sort((a, b) => Number(isRequested(b)) - Number(isRequested(a)) || a.status.localeCompare(b.status) || when(a).localeCompare(when(b)));
  const stepOptions = [{ value: '', label: 'No step, use the Need by date' }, ...steps.map((t) => ({ value: t.id, label: `${t.name} (starts ${t.start_date})` }))];
  const orderFields = [
    { key: 'task_id', label: 'Needed for step', type: 'select' as const, options: stepOptions, help: 'Needed by the day this step starts. Moves when the schedule moves.' },
    { key: 'lead_days', label: 'Lead time in days', type: 'number' as const, help: 'From order to delivery. Trusses about 21, windows 28 to 42.' },
  ];
  const clean = (v: Record<string, unknown>) => ({
    ...v,
    task_id: (v.task_id as string) || null,
    lead_days: v.lead_days == null ? null : Math.max(0, Math.round(Number(v.lead_days))),
  });
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
            <thead><tr><th>Item</th><th>Qty</th><th>Supplier</th><th>Order no.</th><th>Status</th><th>Need by</th><th>Order by</th><th>Ordered</th><th>Arriving</th><th>Arrived</th><th className="right">Cost</th><th /></tr></thead>
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
                      : arrivesTooLate(m, steps) ? <span className="flag">Arrives too late</span>
                      : orderFlag(m, steps, today)?.state === 'overdue' ? <span className="flag">Past order-by</span>
                      : orderFlag(m, steps, today) ? <span className="flag">Order now</span>
                      : <span className={`chip ${m.status === 'arrived' ? 'good' : m.status === 'ordered' ? 'warn' : ''}`}>{WORD[m.status]}</span>}
                  </td>
                  <td className="num small">{neededOn(m, steps)}{stepFor(m, steps) && <div className="muted">{stepFor(m, steps)!.name}</div>}</td>
                  <td className="num small">{m.status === 'needed' && orderByDate(m, steps)}{m.lead_days ? <div className="muted">{leadWords(Number(m.lead_days))}</div> : null}</td>
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
            ...orderFields,
          ]}
          onClose={() => setMany(false)}
          onSave={async ({ lines, supplier, needed_by, ...rest }) => {
            const extra = clean(rest);
            const items = parseMaterialLines(lines as string);
            if (!items.length) throw new Error('One item per line: enter at least one item.');
            const ok = await run(
              () => store.insert('materials', items.map((i) => ({ ...i, job_id: job.id, status: 'needed' as const, supplier: supplier as string, needed_by: needed_by as string | null, ...extra }))),
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
          initial={{ ...ordering, ordered_date: today, expected_date: ordering.expected_date ?? (ordering.lead_days ? addDays(today, Number(ordering.lead_days)) : null) }}
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
            { key: 'needed_by', label: 'Need by', type: 'date', help: 'Used when no step is picked below.' },
            ...orderFields,
            { key: 'ordered_date', label: 'Ordered on', type: 'date' },
            { key: 'expected_date', label: 'Arriving', type: 'date' },
            { key: 'arrived_date', label: 'Arrived on', type: 'date' },
            { key: 'cost_cents', label: 'Cost', type: 'money' },
            { key: 'notes', label: 'Notes', type: 'textarea', help: 'Crew on this job can see these.' },
          ]}
          initial={edit === 'new' ? { status: 'needed', task_id: '' } : ({ ...edit, task_id: edit.task_id ?? '' } as never)}
          onClose={() => setEdit(null)}
          intro={edit !== 'new' ? (
            <button type="button" className="btn danger tiny" style={{ justifySelf: 'start' }} onClick={async () => {
              if (await run(() => store.remove('materials', edit.id), 'Item deleted.')) setEdit(null);
            }}>Delete this item</button>
          ) : undefined}
          onSave={async (v) => {
            const row = { ...clean(v), cost_cents: (v.cost_cents as number) || null };
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
