import { useMemo, useRef, useState } from 'react';
import { Empty, FormModal } from '../../components/ui';
import { store, useData } from '../../data';
import { safeFileName } from '../../data/store';
import { likelyStep, mapLink, shrinkPhoto, whereAmI, type Fix } from '../../data/photoPrep';
import { niceDate } from '../../domain/rules';
import type { Job, Photo } from '../../domain/types';
import { Thumb } from './LogTab';

const shotAt = (p: Photo) => p.taken_at ?? p.created_at ?? '';
const dayOf = (iso: string) => (iso ? iso.slice(0, 10) : '');
const timeOf = (iso: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

/**
 * The job-site camera. Snap a batch on the phone (or pick from the library), tag it to a schedule step once,
 * and it uploads shrunk, time- and GPS-stamped. Below: every approved photo as a timeline, filterable by step,
 * with the office's "client sees this" switch.
 */
export function JobPhotos({ job, photos }: { job: Job; photos: Photo[] }) {
  const { data, run, me } = useData();
  const office = me.role === 'admin' || me.role === 'staff';
  const steps = data.tasks.filter((t) => t.job_id === job.id).sort((a, b) => a.sort - b.sort);
  const stepName = (id: string | null) => steps.find((t) => t.id === id)?.name ?? '';
  const [picked, setPicked] = useState<File[] | null>(null);
  const fix = useRef<Promise<Fix | null> | null>(null);
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState<string>('all');   // 'all' | 'client' | task id

  const onPick = (list: FileList | null) => {
    if (!list || !list.length) return;
    fix.current = whereAmI();          // ask now, while they're still standing on site
    setPicked(Array.from(list));
  };

  const shown = photos.filter((p) => filter === 'all' || (filter === 'client' ? p.client_visible : p.task_id === filter));
  const days = useMemo(() => {
    const m = new Map<string, Photo[]>();
    for (const p of [...shown].sort((a, b) => shotAt(b).localeCompare(shotAt(a)))) {
      const d = dayOf(shotAt(p)); m.set(d, [...(m.get(d) ?? []), p]);
    }
    return [...m.entries()];
  }, [shown]);
  const usedSteps = steps.filter((t) => photos.some((p) => p.task_id === t.id));
  const shared = photos.filter((p) => p.client_visible).length;

  return (
    <section className="stack">
      <div className="row between">
        <h3>Photos ({photos.length})</h3>
        <div className="row">
          <label className="btn primary">
            Take photos
            <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
          </label>
          <label className="btn">
            Upload
            <input type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
      </div>
      {busy && <p className="muted small">{busy}</p>}

      {photos.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button className={'chip' + (filter === 'all' ? ' done' : '')} onClick={() => setFilter('all')}>All</button>
          {usedSteps.map((t) => (
            <button key={t.id} className={'chip' + (filter === t.id ? ' done' : '')} onClick={() => setFilter(t.id)}>
              {t.name} ({photos.filter((p) => p.task_id === t.id).length})
            </button>
          ))}
          {shared > 0 && <button className={'chip good' + (filter === 'client' ? ' done' : '')} onClick={() => setFilter('client')}>Client sees ({shared})</button>}
        </div>
      )}

      {photos.length === 0 ? <Empty>Take photos on site. Each one is stamped with the time and place and tied to a step on the schedule.</Empty> : (
        days.map(([d, list]) => (
          <div key={d} className="stack" style={{ gap: 6 }}>
            <b className="num small">{d ? niceDate(d) : 'Undated'}</b>
            <div className="photos">
              {list.map((p) => (
                <div className="review" key={p.id}>
                  <Thumb photo={p} />
                  <div className="small muted">
                    {[stepName(p.task_id), timeOf(shotAt(p))].filter(Boolean).join(' · ')}
                    {p.lat != null && p.lng != null && <> · <a href={mapLink(p.lat, p.lng)} target="_blank" rel="noopener noreferrer">map</a></>}
                  </div>
                  {office && !/\.pdf$/i.test(p.file_path) && (
                    <label className="small row" style={{ gap: 4 }}>
                      <input type="checkbox" checked={!!p.client_visible}
                        onChange={(e) => run(() => store.update('photos', p.id, { client_visible: e.target.checked }),
                          e.target.checked ? 'The client can see this photo.' : 'Hidden from the client.')} />
                      Client sees this
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {picked && (
        <FormModal
          title={picked.length === 1 ? 'Add 1 photo' : `Add ${picked.length} photos`}
          submit="Upload"
          intro={<p className="muted small">Shrunk before upload and stamped with the time and, if the phone allows it, where you are.</p>}
          fields={[
            { key: 'task_id', label: 'Step on the schedule', type: 'select', options: [{ value: '', label: 'None' }, ...steps.map((t) => ({ value: t.id, label: t.name }))] },
            { key: 'caption', label: 'Caption (optional)' },
          ]}
          initial={{ task_id: likelyStep(steps)?.id ?? '', caption: '' }}
          onClose={() => setPicked(null)}
          onSave={async ({ task_id, caption }) => {
            const files = picked;
            const ok = await run(async () => {
              const where = (await fix.current) ?? null;
              for (let i = 0; i < files.length; i++) {
                setBusy(`Uploading ${i + 1} of ${files.length}...`);
                const f = await shrinkPhoto(files[i]);
                const file_path = await store.upload(`${job.id}/${crypto.randomUUID()}-${safeFileName(f.name)}`, f);
                await store.insert('photos', {
                  job_id: job.id, file_path, caption: (caption as string) || '', task_id: (task_id as string) || null,
                  taken_at: new Date(files[i].lastModified || Date.now()).toISOString(),
                  lat: where?.lat ?? null, lng: where?.lng ?? null,
                } as never);
              }
            }, files.length === 1 ? 'Photo added.' : `${files.length} photos added.`);
            setBusy('');
            if (ok) setPicked(null);
          }}
        />
      )}
    </section>
  );
}
