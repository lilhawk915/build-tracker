import { useState } from 'react';
import { Empty, FileLink, FormModal } from '../../components/ui';
import { store, useData } from '../../data';
import { safeFileName } from '../../data/store';
import type { Document, Job } from '../../domain/types';

export const FILE_CATEGORIES = [
  'Drawings', 'Engineering', 'Permits and inspections', 'Contracts', 'Estimates and bids', 'Invoices', 'Warranties and manuals',
  'Closing documents', 'Other',
];
const MAX_BYTES = 50 * 1024 * 1024;

export function FilesTable({ rows, onEdit }: { rows: Document[]; onEdit?: (d: Document) => void }) {
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>Type</th><th>Title</th><th>Revision</th><th>Date</th><th>File</th><th className="noprint" /></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>{d.category}</td>
              <td><b>{d.title}</b>{d.notes && <div className="small muted">{d.notes}</div>}</td>
              <td>{d.revision}</td>
              <td className="num">{d.doc_date}</td>
              <td className="small muted">{d.file_name}</td>
              <td className="actions noprint">
                <FileLink path={d.file_path} label="Open" />
                {onEdit && <button className="btn tiny" onClick={() => onEdit(d)}>Edit</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const sortFiles = (rows: Document[]) =>
  [...rows].sort((a, b) => FILE_CATEGORIES.indexOf(a.category) - FILE_CATEGORIES.indexOf(b.category) || a.title.localeCompare(b.title));

export function FilesTab({ job }: { job: Job }) {
  const { data, run } = useData();
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<Document | null>(null);
  const rows = sortFiles(data.documents.filter((d) => d.job_id === job.id));
  const categories = FILE_CATEGORIES.map((c) => ({ value: c, label: c }));

  return (
    <div className="stack">
      <div className="row between">
        <h2>Drawings and files</h2>
        <button className="btn primary" onClick={() => setAdding(true)}>Add files</button>
      </div>
      {rows.length === 0 ? <Empty>Add plan sets, permits, contracts, and warranties. You can pick many files at once.</Empty>
        : <FilesTable rows={rows} onEdit={setEdit} />}
      {adding && (
        <FormModal
          title="Add files"
          submit="Add files"
          fields={[
            { key: 'files', label: 'Files', type: 'files', required: true, help: 'Pick as many as you want, up to 50 MB each. Each one is named after its file. PDF, images, CAD, Word, and Excel all work.' },
            { key: 'category', label: 'Type', type: 'select', options: categories },
            { key: 'revision', label: 'Revision' },
            { key: 'doc_date', label: 'Date', type: 'date' },
          ]}
          initial={{ category: 'Drawings' }}
          onClose={() => setAdding(false)}
          onSave={async ({ files, ...v }) => {
            const list = files as File[];
            const big = list.find((f) => f.size > MAX_BYTES);
            if (big) throw new Error(`${big.name} is over 50 MB. Compress it or split it, then try again.`);
            const ok = await run(async () => {
              for (const f of list) {
                const file_path = await store.upload(`${job.id}/${crypto.randomUUID()}-${safeFileName(f.name)}`, f);
                await store.insert('documents', {
                  ...v, job_id: job.id, title: f.name.replace(/\.[^.]+$/, ''), file_name: f.name, file_path, notes: '',
                } as never);
              }
            }, `${list.length} file${list.length === 1 ? '' : 's'} added.`);
            if (ok) setAdding(false);
          }}
        />
      )}
      {edit && (
        <FormModal
          title="Edit file details"
          submit="Save details"
          fields={[
            { key: 'title', label: 'Title', required: true },
            { key: 'category', label: 'Type', type: 'select', options: categories },
            { key: 'revision', label: 'Revision' },
            { key: 'doc_date', label: 'Date', type: 'date' },
            { key: 'notes', label: 'Notes', type: 'textarea', help: 'Search reads these, so add what the file shows.' },
          ]}
          initial={edit as never}
          onClose={() => setEdit(null)}
          intro={(
            <button type="button" className="btn danger tiny" style={{ justifySelf: 'start' }} onClick={async () => {
              if (!window.confirm(`Delete ${edit.title}? The file is removed for good.`)) return;
              const ok = await run(async () => {
                await store.remove('documents', edit.id);
                await store.removeFile(edit.file_path);
              }, 'File deleted.');
              if (ok) setEdit(null);
            }}>Delete this file</button>
          )}
          onSave={async (v) => {
            if (await run(() => store.update('documents', edit.id, v as never), 'Details saved.')) setEdit(null);
          }}
        />
      )}
    </div>
  );
}
