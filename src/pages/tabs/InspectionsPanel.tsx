import { useState } from 'react';
import { FormModal } from '../../components/ui';
import { store, useData } from '../../data';
import { RESULT_LABEL, standardInspectionsFor } from '../../domain/inspections';
import { shortDate } from '../../domain/jobops';
import { todayIso } from '../../domain/rules';
import type { Inspection, Job } from '../../domain/types';

const CHIP: Record<Inspection['result'], string> = { not_scheduled: 'warn', scheduled: '', passed: 'good', failed: 'bad', not_needed: '' };

type Editing = { kind: 'schedule' | 'fail' | 'edit'; i: Inspection } | { kind: 'new' };

/** County inspections for a job. A step tied to an inspection can't start until it passes. */
export function InspectionsPanel({ job }: { job: Job }) {
  const { data, run } = useData();
  const [editing, setEditing] = useState<Editing | null>(null);
  const today = todayIso();
  const tasks = data.tasks.filter((t) => t.job_id === job.id);
  const rows = data.inspections.filter((i) => i.job_id === job.id).sort((a, b) => a.sort - b.sort);
  const missing = standardInspectionsFor(job.id, tasks, rows);
  const stepName = (id: string | null) => tasks.find((t) => t.id === id)?.name;
  const nextSort = Math.max(-1, ...rows.map((r) => r.sort)) + 1;
  // The inspection checks the work done just before the step it holds up, so that step's sub is the likely one.
  const likelyVendor = (i: Inspection) => {
    const held = tasks.find((t) => t.id === i.task_id);
    return tasks.find((t) => t.id === held?.depends_on)?.vendor_id ?? '';
  };
  const set = (i: Inspection, patch: Partial<Inspection>, msg: string) => run(() => store.update('inspections', i.id, patch), msg);

  return (
    <section className="panel stack" aria-label="Inspections">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Inspections</h3>
        <div className="row">
          {missing.length > 0 && <button className="btn" onClick={() => run(() => store.insert('inspections', missing as never), 'Standard inspections added.')}>Add standard inspections</button>}
          <button className="btn" onClick={() => setEditing({ kind: 'new' })}>Add an inspection</button>
        </div>
      </div>
      {rows.length === 0 ? <p className="muted small">No inspections yet. Add the standard ones and each is tied to the step it has to pass before.</p> : (
        <ul className="inspections">
          {rows.map((i) => (
            <li key={i.id}>
              <div>
                <b>{i.name}</b>
                <span className="small muted">{stepName(i.task_id) ? ` · before ${stepName(i.task_id)}` : ''}</span>
                <div className="small">
                  <span className={`chip ${CHIP[i.result]}`}>{RESULT_LABEL[i.result]}</span>
                  {i.result === 'scheduled' && i.scheduled_date && <> {shortDate(i.scheduled_date)}</>}
                  {(i.result === 'passed' || i.result === 'failed') && i.result_date && <> {shortDate(i.result_date)}</>}
                  {i.inspector && <span className="muted"> · {i.inspector}</span>}
                  {i.fail_count > 0 && i.result !== 'failed' && <span className="muted"> · failed {i.fail_count === 1 ? 'once' : `${i.fail_count} times`} before</span>}
                </div>
                {i.result === 'failed' && i.notes && <div className="small">To fix: {i.notes}</div>}
              </div>
              <div className="row actions">
                {i.result === 'not_scheduled' && <button className="btn tiny primary" onClick={() => setEditing({ kind: 'schedule', i })}>Schedule</button>}
                {i.result === 'scheduled' && (
                  <>
                    <button className="btn tiny primary" onClick={() => set(i, { result: 'passed', result_date: today }, `${i.name} inspection passed.`)}>Passed</button>
                    <button className="btn tiny" onClick={() => setEditing({ kind: 'fail', i })}>Failed</button>
                  </>
                )}
                {i.result === 'failed' && <button className="btn tiny primary" onClick={() => setEditing({ kind: 'schedule', i })}>Schedule re-inspection</button>}
                <button className="btn tiny" onClick={() => setEditing({ kind: 'edit', i })}>Edit</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing?.kind === 'schedule' && (
        <FormModal
          title={`${editing.i.result === 'failed' ? 'Re-inspection' : 'Schedule'}: ${editing.i.name}`}
          submit="Save date"
          fields={[
            { key: 'scheduled_date', label: 'Inspection date', type: 'date', required: true },
            { key: 'inspector', label: 'Inspector or office', help: 'Optional. Like: Montgomery County Building Regulations.' },
          ]}
          initial={{ scheduled_date: editing.i.scheduled_date && editing.i.scheduled_date >= today ? editing.i.scheduled_date : today, inspector: editing.i.inspector }}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            const ok = await set(editing.i, { result: 'scheduled', scheduled_date: v.scheduled_date as string, inspector: String(v.inspector ?? '') }, `${editing.i.name} inspection scheduled.`);
            if (ok) setEditing(null);
          }}
        />
      )}
      {editing?.kind === 'fail' && (
        <FormModal
          title={`Failed: ${editing.i.name}`}
          submit="Save"
          fields={[
            { key: 'notes', label: 'What has to be fixed', type: 'textarea', required: true },
            { key: 'vendor_id', label: 'Whose work', type: 'select', options: [{ value: '', label: 'Not a sub / not sure' }, ...data.vendors.map((x) => ({ value: x.id, label: x.name }))], help: 'Counts on that sub\'s scorecard.' },
          ]}
          initial={{ notes: '', vendor_id: likelyVendor(editing.i) }}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            const ok = await set(editing.i, {
              result: 'failed', result_date: today, notes: String(v.notes), vendor_id: (v.vendor_id as string) || null, fail_count: editing.i.fail_count + 1,
            }, `${editing.i.name} inspection marked failed.`);
            if (ok) setEditing(null);
          }}
        />
      )}
      {(editing?.kind === 'edit' || editing?.kind === 'new') && (
        <FormModal
          title={editing.kind === 'new' ? 'Add an inspection' : `Edit ${editing.i.name}`}
          submit={editing.kind === 'new' ? 'Add inspection' : 'Save'}
          fields={[
            { key: 'name', label: 'Inspection', required: true, help: 'Like: Footer, Framing, Final.' },
            { key: 'task_id', label: 'Must pass before', type: 'select', options: [{ value: '', label: 'No step (nothing waits on it)' }, ...[...tasks].sort((a, b) => a.sort - b.sort).map((t) => ({ value: t.id, label: t.name }))], help: 'That step can\'t be started until this passes.' },
            { key: 'result', label: 'Where it stands', type: 'select', options: Object.entries(RESULT_LABEL).map(([value, label]) => ({ value, label })) },
            { key: 'scheduled_date', label: 'Inspection date', type: 'date' },
            { key: 'inspector', label: 'Inspector or office' },
            { key: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          initial={editing.kind === 'new' ? { result: 'not_scheduled', task_id: '' } : { ...editing.i, task_id: editing.i.task_id ?? '' } as never}
          onClose={() => setEditing(null)}
          intro={editing.kind === 'edit' ? (
            <button type="button" className="btn danger tiny" style={{ justifySelf: 'start' }} onClick={async () => {
              if (await run(() => store.remove('inspections', editing.i.id), 'Inspection removed.')) setEditing(null);
            }}>Remove this inspection</button>
          ) : undefined}
          onSave={async (v) => {
            const row = { ...v, task_id: (v.task_id as string) || null, scheduled_date: (v.scheduled_date as string) || null } as Partial<Inspection>;
            if (row.result === 'scheduled' && !row.scheduled_date) throw new Error('Enter the inspection date.');
            if ((row.result === 'passed' || row.result === 'failed') && !(editing.kind === 'edit' && editing.i.result_date)) row.result_date = today;
            const ok = editing.kind === 'new'
              ? await run(() => store.insert('inspections', { ...row, job_id: job.id, sort: nextSort } as never), 'Inspection added.')
              : await run(() => store.update('inspections', editing.i.id, row), 'Inspection saved.');
            if (ok) setEditing(null);
          }}
        />
      )}
    </section>
  );
}
