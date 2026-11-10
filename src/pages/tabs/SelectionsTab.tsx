import { useState } from 'react';
import { Empty, FileLink, FormModal } from '../../components/ui';
import { store, useData } from '../../data';
import { safeFileName } from '../../data/store';
import type { Job, Selection } from '../../domain/types';

export const SELECTION_CATEGORIES = [
  'Paint', 'Flooring', 'Tile', 'Cabinets', 'Countertops', 'Plumbing fixtures', 'Lighting', 'Hardware', 'Appliances',
  'Roofing', 'Siding', 'Windows and doors', 'Trim', 'Landscaping', 'Other',
];

export function SelectionsTable({ rows, onEdit, vendorName }: { rows: Selection[]; onEdit?: (s: Selection) => void; vendorName: (id: string | null) => string }) {
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>Type</th><th>Where</th><th>Item</th><th>Brand</th><th>Color</th><th>Code</th><th>Finish</th><th>Bought from</th><th>Installed by</th><th className="noprint" /></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td>{s.category}</td>
              <td>{s.room}</td>
              <td>{s.item}</td>
              <td>{s.brand}</td>
              <td><b>{s.color_name}</b>{s.notes && <div className="small muted">{s.notes}</div>}</td>
              <td className="num">{s.color_code}</td>
              <td>{s.finish}</td>
              <td>{s.supplier}</td>
              <td>{vendorName(s.vendor_id)}</td>
              <td className="actions noprint">
                {s.file_path && <FileLink path={s.file_path} />}
                {onEdit && <button className="btn tiny" onClick={() => onEdit(s)}>Edit</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SelectionsTab({ job }: { job: Job }) {
  const { data, run } = useData();
  const [edit, setEdit] = useState<Selection | 'new' | null>(null);
  const order = (c: string) => SELECTION_CATEGORIES.indexOf(c);
  const rows = data.selections.filter((s) => s.job_id === job.id)
    .sort((a, b) => order(a.category) - order(b.category) || a.room.localeCompare(b.room));
  const vendorName = (id: string | null) => data.vendors.find((v) => v.id === id)?.name ?? '';

  return (
    <div className="stack">
      <div className="row between">
        <h2>Colors and selections</h2>
        <button className="btn primary" onClick={() => setEdit('new')}>Add a selection</button>
      </div>
      {rows.length === 0 ? <Empty>Record paint colors, flooring, tile, counters, and fixtures so you can find them for a touch-up years from now.</Empty>
        : <SelectionsTable rows={rows} onEdit={setEdit} vendorName={vendorName} />}
      {edit && (
        <FormModal
          title={edit === 'new' ? 'Add a selection' : 'Edit selection'}
          submit={edit === 'new' ? 'Add selection' : 'Save selection'}
          fields={[
            { key: 'category', label: 'Type', type: 'select', options: SELECTION_CATEGORIES.map((c) => ({ value: c, label: c })) },
            { key: 'room', label: 'Where', help: 'Kitchen, whole house, exterior…' },
            { key: 'item', label: 'Item', help: 'Walls, island, front door…' },
            { key: 'brand', label: 'Brand' },
            { key: 'color_name', label: 'Color or style' },
            { key: 'color_code', label: 'Color or model code' },
            { key: 'finish', label: 'Finish or sheen' },
            { key: 'supplier', label: 'Bought from' },
            { key: 'vendor_id', label: 'Installed by', type: 'select', options: [{ value: '', label: 'Not recorded' }, ...data.vendors.map((v) => ({ value: v.id, label: v.name }))] },
            { key: 'notes', label: 'Notes', type: 'textarea' },
            { key: 'file', label: 'Photo or spec sheet', type: 'file' },
          ]}
          initial={edit === 'new' ? { category: 'Paint', vendor_id: '' } : { ...edit, vendor_id: edit.vendor_id ?? '' }}
          onClose={() => setEdit(null)}
          intro={edit !== 'new' ? (
            <button type="button" className="btn danger tiny" style={{ justifySelf: 'start' }} onClick={async () => {
              const ok = await run(async () => {
                await store.remove('selections', edit.id);
                if (edit.file_path) await store.removeFile(edit.file_path);
              }, 'Selection deleted.');
              if (ok) setEdit(null);
            }}>Delete this selection</button>
          ) : undefined}
          onSave={async ({ file, ...v }) => {
            const ok = await run(async () => {
              const uploaded = file ? await store.upload(`${job.id}/${crypto.randomUUID()}-${safeFileName((file as File).name)}`, file as File) : null;
              const row = { ...v, vendor_id: (v.vendor_id as string) || null };
              if (edit === 'new') await store.insert('selections', { ...row, job_id: job.id, file_path: uploaded } as never);
              else await store.update('selections', edit.id, { ...row, ...(uploaded ? { file_path: uploaded } : {}) } as never);
            }, 'Selection saved.');
            if (ok) setEdit(null);
          }}
        />
      )}
    </div>
  );
}
