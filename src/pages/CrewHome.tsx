import { useState } from 'react';
import { Empty, FileLink, FormModal, Status } from '../components/ui';
import { store, useData } from '../data';
import { materialLate } from '../domain/jobops';
import { isLate, todayIso } from '../domain/rules';
import type { TaskStatus } from '../domain/types';

const mapLink = (address: string) => `https://maps.apple.com/?q=${encodeURIComponent(address)}`;

export function CrewHome() {
  const { data, run, me } = useData();
  const [asking, setAsking] = useState<string | null>(null);
  const today = todayIso();
  const mine = data.tasks.filter((t) => t.assigned_to === me.id && t.status !== 'done')
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const jobName = (id: string) => data.subJobs.find((j) => j.id === id)?.name ?? '';

  return (
    <div className="stack" style={{ maxWidth: 820, margin: '0 auto' }}>
      <div>
        <h1>My work</h1>
        <p className="muted">{mine.length} open task{mine.length === 1 ? '' : 's'} assigned to you.</p>
      </div>
      {mine.length === 0 ? <Empty>Nothing is assigned to you right now.</Empty> : mine.map((t) => (
        <div className="portalcard" key={t.id}>
          <div>
            <b>{t.name}</b> {isLate(t, today) && <span className="flag">Late</span>}
            <div className="muted small">{jobName(t.job_id)}</div>
            <div className="num small">{t.start_date} to {t.end_date}</div>
            {t.notes && <div className="small">{t.notes}</div>}
          </div>
          <label className="field">
            <span>Status</span>
            <select aria-label={`Status of ${t.name}`} value={t.status} onChange={(e) => run(() => store.setTaskStatus(t.id, e.target.value as TaskStatus), 'Status updated.')}>
              <option value="todo">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </label>
        </div>
      ))}

      {data.subJobs.map((job) => {
        const scope = data.scope_items.filter((s) => s.job_id === job.id);
        const materials = data.materials.filter((m) => m.job_id === job.id && m.status !== 'arrived')
          .sort((a, b) => (a.expected_date ?? '9999').localeCompare(b.expected_date ?? '9999'));
        const colors = data.selections.filter((s) => s.job_id === job.id);
        const plans = data.documents.filter((d) => d.job_id === job.id);
        const schedule = data.tasks.filter((t) => t.job_id === job.id && t.status !== 'done')
          .sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, 5);
        return (
          <section className="panel stack" key={job.id}>
            <div>
              <h2>{job.name}</h2>
              {job.address && <a href={mapLink(job.address)} target="_blank" rel="noopener noreferrer">{job.address}</a>}
            </div>
            <div>
              <h3>What it needs</h3>
              {scope.length === 0 ? <p className="muted small">Nothing listed yet.</p> : scope.map((s) => (
                <p key={s.id} style={{ marginTop: 6 }}>
                  <b>{s.title}</b>{s.location && ` (${s.location})`} <Status s={s.status} />
                  {s.details && <span className="small muted" style={{ display: 'block' }}>{s.details}</span>}
                </p>
              ))}
            </div>
            <div>
              <h3>Coming up</h3>
              {schedule.length === 0 ? <p className="muted small">No open tasks.</p> : schedule.map((t) => (
                <p key={t.id} className="small" style={{ marginTop: 6 }}>
                  <span className="num">{t.start_date}</span> {t.name}{t.assigned_to === me.id && ' (you)'}
                </p>
              ))}
            </div>
            <div>
              <div className="row between">
                <h3>Materials not here yet</h3>
                <button className="btn primary tiny" onClick={() => setAsking(job.id)}>Ask for materials</button>
              </div>
              {materials.length === 0 ? <p className="muted small">Everything listed has arrived.</p> : materials.map((m) => (
                <div className="row between" key={m.id} style={{ marginTop: 6 }}>
                  <span>
                    <b>{m.name}</b>{m.quantity && ` (${m.quantity})`}
                    <span className="small muted" style={{ display: 'block' }}>
                      {m.requested_by_name && m.status === 'needed' ? `${m.requested_by_name} asked for this. Not ordered yet` : m.status === 'needed' ? 'Not ordered yet' : `Arriving ${m.expected_date ?? 'date not set'}`}
                      {materialLate(m, today) && ' (late)'}
                    </span>
                  </span>
                  {m.status === 'ordered' && <button className="btn tiny" onClick={() => run(() => store.markMaterialArrived(m.id), `${m.name} marked arrived.`)}>It arrived</button>}
                </div>
              ))}
            </div>
            {colors.length > 0 && (
              <div>
                <h3>Colors and selections</h3>
                {colors.map((s) => (
                  <p key={s.id} className="small" style={{ marginTop: 6 }}>
                    <b>{[s.room, s.item].filter(Boolean).join(', ')}:</b> {[s.brand, s.color_name, s.color_code, s.finish].filter(Boolean).join(' · ')}
                  </p>
                ))}
              </div>
            )}
            {plans.length > 0 && (
              <div>
                <h3>Plans</h3>
                {plans.map((d) => (
                  <div className="row between" key={d.id} style={{ marginTop: 6 }}>
                    <span>{d.title}{d.revision && ` (Rev ${d.revision})`}</span>
                    <FileLink path={d.file_path} label="Open" />
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {asking && (
        <FormModal
          title={`Ask for materials: ${jobName(asking)}`}
          submit="Send request"
          fields={[
            { key: 'name', label: 'What do you need', required: true, help: 'Baseboard trim, 2x4s, tile spacers…' },
            { key: 'quantity', label: 'How much', help: '40 ft, 12, 3 boxes…' },
            { key: 'needed_by', label: 'Need it by', type: 'date' },
            { key: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          onClose={() => setAsking(null)}
          onSave={async (v) => {
            const ok = await run(() => store.requestMaterial(asking, v.name as string, v.quantity as string, v.needed_by as string | null, v.notes as string), 'Request sent to the office.');
            if (ok) setAsking(null);
          }}
        />
      )}
    </div>
  );
}
