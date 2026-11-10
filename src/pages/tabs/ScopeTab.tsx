import { useState } from 'react';
import { Empty, FormModal, Status } from '../../components/ui';
import { store, useData } from '../../data';
import type { Job, ScopeItem } from '../../domain/types';

export function ScopeTab({ job }: { job: Job }) {
  const { data, run } = useData();
  const [edit, setEdit] = useState<ScopeItem | 'new' | null>(null);
  const rows = data.scope_items.filter((s) => s.job_id === job.id).sort((a, b) => a.sort - b.sort);

  return (
    <div className="stack">
      <div className="row between">
        <h2>What the job needs</h2>
        <button className="btn primary" onClick={() => setEdit('new')}>Add an item</button>
      </div>
      <p className="muted">Crew assigned to this job see this list.</p>
      {rows.length === 0 ? <Empty>List what this job includes: a large back porch, tile, kitchen cabinets.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Item</th><th>Where</th><th>Details</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.title}</b></td>
                  <td>{s.location}</td>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{s.details}</td>
                  <td><Status s={s.status} /></td>
                  <td className="actions"><button className="btn tiny" onClick={() => setEdit(s)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <FormModal
          title={edit === 'new' ? 'Add an item' : `Edit ${edit.title}`}
          submit={edit === 'new' ? 'Add item' : 'Save item'}
          fields={[
            { key: 'title', label: 'What it needs', required: true, help: 'Large back porch, tile, kitchen cabinets…' },
            { key: 'location', label: 'Where' },
            { key: 'details', label: 'Details', type: 'textarea', help: 'Size, style, anything the crew should know.' },
            { key: 'status', label: 'Status', type: 'select', options: [{ value: 'todo', label: 'Not started' }, { value: 'in_progress', label: 'In progress' }, { value: 'done', label: 'Done' }] },
          ]}
          initial={edit === 'new' ? { status: 'todo' } : (edit as never)}
          onClose={() => setEdit(null)}
          intro={edit !== 'new' ? (
            <button type="button" className="btn danger tiny" style={{ justifySelf: 'start' }} onClick={async () => {
              if (await run(() => store.remove('scope_items', edit.id), 'Item deleted.')) setEdit(null);
            }}>Delete this item</button>
          ) : undefined}
          onSave={async (v) => {
            const ok = await run(
              () => edit === 'new'
                ? store.insert('scope_items', { ...v, job_id: job.id, sort: rows.length } as never)
                : store.update('scope_items', edit.id, v as never),
              'Item saved.',
            );
            if (ok) setEdit(null);
          }}
        />
      )}
    </div>
  );
}
