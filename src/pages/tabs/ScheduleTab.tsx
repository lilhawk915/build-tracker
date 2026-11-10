import { useState } from 'react';
import { Empty, FormModal, Modal, Status } from '../../components/ui';
import { store, useData } from '../../data';
import { daysBetween, isLate, todayIso } from '../../domain/rules';
import { scheduleHealth } from '../../domain/jobops';
import { cascade, wouldLoop, type DateChange } from '../../domain/schedule';
import type { Job, Task, TaskStatus } from '../../domain/types';

export function ScheduleTab({ job }: { job: Job }) {
  const { data, run } = useData();
  const [edit, setEdit] = useState<Task | 'new' | null>(null);
  const [pending, setPending] = useState<{ task: Task; values: Partial<Task>; moves: DateChange[] } | null>(null);
  const today = todayIso();
  const tasks = data.tasks.filter((t) => t.job_id === job.id).sort((a, b) => a.start_date.localeCompare(b.start_date) || a.sort - b.sort);
  const vendorName = (id: string | null) => data.vendors.find((v) => v.id === id)?.name ?? '';
  const taskName = (id: string) => tasks.find((t) => t.id === id)?.name ?? '';

  const from = tasks.length ? tasks.reduce((m, t) => (t.start_date < m ? t.start_date : m), tasks[0].start_date) : today;
  const to = tasks.length ? tasks.reduce((m, t) => (t.end_date > m ? t.end_date : m), tasks[0].end_date) : today;
  const range = Math.max(1, daysBetween(from, to) + 1);
  const at = (d: string) => (daysBetween(from, d) / range) * 100;
  const nowPos = at(today);
  const health = scheduleHealth(job, tasks, today);
  const team = data.profiles.filter((p) => ['admin', 'staff', 'crew'].includes(p.role));
  const personName = (id?: string | null) => { const p = team.find((x) => x.id === id); return p ? p.name || p.email : ''; };

  async function applyMoves(task: Task, values: Partial<Task>, moves: DateChange[]) {
    return run(async () => {
      await store.update('tasks', task.id, values as never);
      for (const m of moves.filter((x) => x.id !== task.id)) {
        await store.update('tasks', m.id, { start_date: m.start_date, end_date: m.end_date });
      }
    }, moves.length > 1 ? `Task saved. ${moves.length - 1} later task${moves.length > 2 ? 's' : ''} moved.` : 'Task saved.');
  }

  return (
    <div className="stack">
      <div className="row between">
        <h2>Schedule</h2>
        <button className="btn primary" onClick={() => setEdit('new')}>Add a task</button>
      </div>
      {health.state !== 'none' && (
        <div className={`alert ${health.state === 'behind' ? '' : 'calm'}`}>
          <b>{health.label}.</b>
          {health.projectedFinish && ` Projected finish ${health.projectedFinish}.`}
          {job.target_finish && ` Target ${job.target_finish}.`}
          {health.lateTasks.length > 0 && ` Late: ${health.lateTasks.map((t) => t.name).join(', ')}.`}
        </div>
      )}
      {tasks.length === 0 ? <Empty>Add tasks and link each to the one before it. A delay then pushes everything after it.</Empty> : (
        <div className="tablewrap">
          <table className="gantt">
            <thead><tr><th>Task</th><th>Who</th><th>Dates</th><th>Status</th><th>{from} to {to}</th><th /></tr></thead>
            <tbody>
              {tasks.map((t) => {
                const late = isLate(t, today);
                return (
                  <tr key={t.id}>
                    <td>{t.name}{t.depends_on && <div className="muted small">After {taskName(t.depends_on)}</div>}</td>
                    <td>{vendorName(t.vendor_id)}{t.assigned_to && <div className="small muted">{personName(t.assigned_to)}</div>}</td>
                    <td className="num small">{t.start_date}<br />{t.end_date}</td>
                    <td>{late ? <span className="flag">Late</span> : <Status s={t.status} />}</td>
                    <td className="barcell">
                      <div className="track">
                        <div
                          className={`bar ${late ? 'late' : t.status}`}
                          style={{ left: `${at(t.start_date)}%`, width: `${((daysBetween(t.start_date, t.end_date) + 1) / range) * 100}%` }}
                          title={`${t.name}: ${t.start_date} to ${t.end_date}`}
                        />
                        {nowPos >= 0 && nowPos <= 100 && <div className="now" style={{ left: `${nowPos}%` }} aria-hidden="true" />}
                      </div>
                    </td>
                    <td className="actions"><button className="btn tiny" onClick={() => setEdit(t)}>Edit</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <FormModal
          title={edit === 'new' ? 'Add a task' : `Edit ${edit.name}`}
          submit={edit === 'new' ? 'Add task' : 'Save task'}
          fields={[
            { key: 'name', label: 'Task', required: true },
            { key: 'vendor_id', label: 'Sub', type: 'select', options: [{ value: '', label: 'Not assigned' }, ...data.vendors.map((v) => ({ value: v.id, label: v.name }))], help: 'The sub sees this task, its dates, and its notes.' },
            { key: 'assigned_to', label: 'Team member', type: 'select', options: [{ value: '', label: 'Not assigned' }, ...team.map((p) => ({ value: p.id, label: p.name || p.email }))], help: 'They see this task and the job when they log in.' },
            { key: 'start_date', label: 'Start', type: 'date', required: true },
            { key: 'end_date', label: 'Finish', type: 'date', required: true },
            { key: 'depends_on', label: 'Starts after', type: 'select', options: [{ value: '', label: 'Nothing' }, ...tasks.filter((t) => edit === 'new' || (t.id !== edit.id && !wouldLoop(tasks, edit.id, t.id))).map((t) => ({ value: t.id, label: t.name }))] },
            { key: 'status', label: 'Status', type: 'select', options: [{ value: 'todo', label: 'Not started' }, { value: 'in_progress', label: 'In progress' }, { value: 'done', label: 'Done' }] },
            { key: 'notes', label: 'Notes', type: 'textarea', help: 'The assigned sub can see these.' },
          ]}
          initial={edit === 'new' ? { status: 'todo', start_date: today, end_date: today, vendor_id: '', assigned_to: '', depends_on: '' } : { ...edit, vendor_id: edit.vendor_id ?? '', assigned_to: edit.assigned_to ?? '', depends_on: edit.depends_on ?? '' }}
          onClose={() => setEdit(null)}
          intro={edit !== 'new' ? (
            <button type="button" className="btn danger tiny" style={{ justifySelf: 'start' }} onClick={async () => {
              if (await run(() => store.remove('tasks', edit.id), 'Task deleted.')) setEdit(null);
            }}>Delete this task</button>
          ) : undefined}
          onSave={async (v) => {
            const values = { ...v, vendor_id: (v.vendor_id as string) || null, assigned_to: (v.assigned_to as string) || null, depends_on: (v.depends_on as string) || null } as Partial<Task>;
            if ((values.end_date as string) < (values.start_date as string)) throw new Error('Finish must be on or after start.');
            if (edit === 'new') {
              if (await run(() => store.insert('tasks', { ...values, job_id: job.id, status: values.status as TaskStatus, sort: tasks.length } as never), 'Task added.')) setEdit(null);
              return;
            }
            const next = tasks.map((t) => (t.id === edit.id ? { ...t, depends_on: values.depends_on ?? null } : t));
            const moves = cascade(next, edit.id, values.start_date as string, values.end_date as string);
            if (moves.length > 1) {
              setPending({ task: edit, values, moves });
              setEdit(null);
              return;
            }
            if (await applyMoves(edit, values, moves)) setEdit(null);
          }}
        />
      )}
      {pending && (
        <Modal title="This moves later work" onClose={() => setPending(null)}>
          <p>Saving these dates pushes {pending.moves.length - 1} later task{pending.moves.length > 2 ? 's' : ''}:</p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Task</th><th>New start</th><th>New finish</th></tr></thead>
              <tbody>
                {pending.moves.filter((m) => m.id !== pending.task.id).map((m) => (
                  <tr key={m.id}><td>{taskName(m.id)}</td><td className="num">{m.start_date}</td><td className="num">{m.end_date}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Weekends count as working days. Subs see their new dates in their portal, and any confirmed sub who moves goes back on the call list.</p>
          <div className="row">
            <button className="btn primary" onClick={async () => {
              const p = pending;
              setPending(null);
              await applyMoves(p.task, p.values, p.moves);
            }}>Move these tasks</button>
            <button className="btn" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
