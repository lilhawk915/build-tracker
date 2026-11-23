import { useState } from 'react';
import { Modal } from '../../components/ui';
import { store, useData } from '../../data';
import { checkStatus, standardFor } from '../../domain/checks';
import type { Task } from '../../domain/types';

/** A step's walk-through checklist: tick items on site, add or remove items. */
export function ChecklistModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const { data, run, me } = useData();
  const [label, setLabel] = useState('');
  const items = data.step_checks.filter((c) => c.task_id === task.id).sort((a, b) => a.sort - b.sort);
  const status = checkStatus(items, task.id);
  const std = standardFor(task.name);
  const nextSort = Math.max(-1, ...items.map((c) => c.sort)) + 1;

  return (
    <Modal title={`Checklist: ${task.name}`} onClose={onClose}>
      <p className="muted small">
        Walk these before {task.name} starts. The step can't be marked started until every item is ticked.
      </p>
      {items.length === 0 ? (
        <div className="stack">
          <p>No checklist on this step yet.</p>
          {std && (
            <button className="btn primary" style={{ justifySelf: 'start' }} onClick={() => run(
              () => store.insert('step_checks', std.items.map((l, sort) => ({ job_id: task.job_id, task_id: task.id, label: l, sort })) as never),
              `${std.title} list added.`,
            )}>Use the standard list: {std.title}</button>
          )}
        </div>
      ) : (
        <>
          <p><span className={`chip ${status.complete ? 'good' : 'warn'}`}>{status.done} of {status.total} done</span></p>
          <ul className="checklist" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {items.map((c) => (
              <li key={c.id} className="row between" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: '6px 0' }}>
                  <input
                    type="checkbox"
                    style={{ width: 22, height: 22, flex: 'none' }}
                    checked={c.done}
                    onChange={(e) => run(() => store.update('step_checks', c.id, {
                      done: e.target.checked,
                      done_at: e.target.checked ? new Date().toISOString() : null,
                      done_by: e.target.checked ? me.name || me.email : '',
                    }))}
                  />
                  <span>
                    {c.label}
                    {c.done && c.done_by && <span className="small muted"> · {c.done_by}{c.done_at ? `, ${c.done_at.slice(0, 10)}` : ''}</span>}
                  </span>
                </label>
                <button className="btn tiny" aria-label={`Remove ${c.label}`} onClick={() => run(() => store.remove('step_checks', c.id), 'Item removed.')}>Remove</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <form className="row" onSubmit={async (e) => {
        e.preventDefault();
        const text = label.trim();
        if (!text) return;
        if (await run(() => store.insert('step_checks', { job_id: task.job_id, task_id: task.id, label: text, sort: nextSort } as never), 'Item added.')) setLabel('');
      }}>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span>Add an item</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Like: shower valve at the right height" />
        </label>
        <button className="btn" type="submit" style={{ alignSelf: 'end' }}>Add</button>
      </form>
      <button className="btn" onClick={onClose}>Close</button>
    </Modal>
  );
}
