import { useEffect, useState } from 'react';
import { Empty, FormModal } from '../../components/ui';
import { store, useData } from '../../data';
import { safeFileName } from '../../data/store';
import { todayIso } from '../../domain/rules';
import type { Job, Photo } from '../../domain/types';

export function Thumb({ photo }: { photo: Photo }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    store.fileUrl(photo.file_path).then((u) => { if (live) setUrl(u); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [photo.file_path]);
  const pdf = /\.pdf$/i.test(photo.file_path);
  return (
    <figure>
      {failed ? <div className="muted small" style={{ height: 110 }}>File not available.</div>
        : pdf ? <a href={url} target="_blank" rel="noopener noreferrer">Open PDF</a>
        : url ? <img src={url} alt={photo.caption || 'Job site photo'} loading="lazy" /> : <div style={{ height: 110 }} />}
      {photo.caption && <figcaption>{photo.caption}</figcaption>}
    </figure>
  );
}

export function LogTab({ job }: { job: Job }) {
  const { data, run, me } = useData();
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rejecting, setRejecting] = useState<Photo | null>(null);
  const logs = data.daily_logs.filter((l) => l.job_id === job.id).sort((a, b) => b.log_date.localeCompare(a.log_date));
  const mine = data.photos.filter((p) => p.job_id === job.id);
  const photos = mine.filter((p) => p.review_status === 'approved');
  const pending = mine.filter((p) => p.review_status === 'pending');
  const rejected = mine.filter((p) => p.review_status === 'rejected');
  const vendorName = (id: string | null) => data.vendors.find((v) => v.id === id)?.name ?? '';
  const taskName = (id: string | null) => data.tasks.find((t) => t.id === id)?.name ?? '';

  return (
    <div className="stack">
      <div className="row between">
        <h2>Site log</h2>
        <div className="row">
          <button className="btn" onClick={() => setUploading(true)}>Add a photo</button>
          <button className="btn primary" onClick={() => setAdding(true)}>Add a log entry</button>
        </div>
      </div>
      {pending.length > 0 && (
        <section className="stack">
          <h3>Photos to review ({pending.length})</h3>
          <div className="photos">
            {pending.map((p) => (
              <div className="review" key={p.id}>
                <Thumb photo={p} />
                <div className="small"><b>{vendorName(p.vendor_id)}</b>{p.task_id && <div className="muted">{taskName(p.task_id)}</div>}</div>
                <div className="row">
                  <button className="btn tiny" onClick={() => run(() => store.update('photos', p.id, { review_status: 'approved' }), 'Photo approved.')}>Approve</button>
                  <button className="btn tiny danger" onClick={() => setRejecting(p)}>Disapprove</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {photos.length > 0 && <div className="photos">{photos.map((p) => <Thumb key={p.id} photo={p} />)}</div>}
      {rejected.length > 0 && (
        <details>
          <summary>Disapproved photos ({rejected.length})</summary>
          <div className="photos" style={{ marginTop: 10 }}>
            {rejected.map((p) => (
              <div className="review" key={p.id}>
                <Thumb photo={p} />
                <div className="small"><b>{vendorName(p.vendor_id)}</b><div className="muted">{p.review_note}</div></div>
                <button className="btn tiny" onClick={() => run(() => store.update('photos', p.id, { review_status: 'approved' }), 'Photo approved.')}>Approve instead</button>
              </div>
            ))}
          </div>
        </details>
      )}
      {logs.length === 0 ? <Empty>Log what happened on site each day: who showed up, deliveries, inspections, weather delays.</Empty> : (
        <div className="stack">
          {logs.map((l) => (
            <div className="panel" key={l.id}>
              <div className="row between">
                <b className="num">{l.log_date}</b>
                <span className="muted small">{[l.weather, l.author].filter(Boolean).join(' · ')}</span>
              </div>
              <p style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{l.notes}</p>
            </div>
          ))}
        </div>
      )}
      {rejecting && (
        <FormModal
          title="Disapprove this photo"
          submit="Disapprove photo"
          fields={[{ key: 'review_note', label: 'What needs fixing', type: 'textarea', required: true, help: 'The contractor sees this.' }]}
          onClose={() => setRejecting(null)}
          onSave={async (v) => {
            const ok = await run(() => store.update('photos', rejecting.id, { review_status: 'rejected', review_note: v.review_note as string }), 'Photo disapproved. The contractor can see why.');
            if (ok) setRejecting(null);
          }}
        />
      )}
      {adding && (
        <FormModal
          title="Add a log entry"
          submit="Add entry"
          fields={[
            { key: 'log_date', label: 'Date', type: 'date', required: true },
            { key: 'weather', label: 'Weather' },
            { key: 'notes', label: 'What happened', type: 'textarea', required: true },
          ]}
          initial={{ log_date: todayIso() }}
          onClose={() => setAdding(false)}
          onSave={async (v) => {
            if (await run(() => store.insert('daily_logs', { ...v, job_id: job.id, author: me.name } as never), 'Entry added.')) setAdding(false);
          }}
        />
      )}
      {uploading && (
        <FormModal
          title="Add a photo"
          submit="Add photo"
          fields={[
            { key: 'file', label: 'Photo or PDF', type: 'file', required: true },
            { key: 'caption', label: 'Caption' },
          ]}
          onClose={() => setUploading(false)}
          onSave={async ({ file, caption }) => {
            const f = file as File;
            const ok = await run(async () => {
              const file_path = await store.upload(`${job.id}/${crypto.randomUUID()}-${safeFileName(f.name)}`, f);
              await store.insert('photos', { job_id: job.id, file_path, caption: caption as string });
            }, 'Photo added.');
            if (ok) setUploading(false);
          }}
        />
      )}
    </div>
  );
}
