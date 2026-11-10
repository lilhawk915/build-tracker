import { useState } from 'react';
import { Empty, FileLink, FormModal, money, Status, WAIVER_LABEL } from '../components/ui';
import { store, useData } from '../data';
import { safeFileName } from '../data/store';
import { poTotal } from '../domain/budget';
import { Thumb } from './tabs/LogTab';
import { coiFlag, todayIso } from '../domain/rules';
import type { Po, TaskStatus, Waiver } from '../domain/types';

export function Portal() {
  const { data, run, me } = useData();
  const [billing, setBilling] = useState<Po | null>(null);
  const [signing, setSigning] = useState<Waiver | null>(null);
  const [photoJob, setPhotoJob] = useState(false);
  const [asking, setAsking] = useState(false);
  const today = todayIso();
  const vendor = data.vendors.find((v) => v.id === me.vendor_id);
  const jobName = (id: string) => data.subJobs.find((j) => j.id === id)?.name ?? '';
  const jobLabel = (id: string) => {
    const j = data.subJobs.find((x) => x.id === id);
    return j ? `${j.name}${j.address ? `, ${j.address}` : ''}` : '';
  };
  const folder = `vendor/${me.vendor_id}`;
  const coi = vendor ? coiFlag(vendor, today) : null;

  const answer = data.pos.filter((p) => p.status === 'sent');
  const active = data.pos.filter((p) => p.status === 'accepted');
  const waivers = data.lien_waivers.filter((w) => w.status === 'requested');
  const tasks = data.tasks.filter((t) => t.status !== 'done').sort((a, b) => a.start_date.localeCompare(b.start_date));
  const bills = [...data.bills].sort((a, b) => b.bill_date.localeCompare(a.bill_date));
  const billedOn = (id: string) =>
    data.bills.filter((b) => b.po_id === id && b.status !== 'rejected').reduce((s, b) => s + b.amount_cents, 0);

  return (
    <div className="stack" style={{ maxWidth: 820, margin: '0 auto' }}>
      <div>
        <h1>{vendor?.name ?? 'My work'}</h1>
        <p className="muted">Your jobs, work orders, bills, and lien waivers.</p>
      </div>
      {coi && <div className="alert" role="alert">{coi.label.replace(`${vendor?.name}: `, '').replace(/^./, (c) => c.toUpperCase())}. Send a current certificate to the office. Payments stop when insurance lapses.</div>}

      <h2>Work orders to answer ({answer.length})</h2>
      {answer.length === 0 ? <Empty>No work orders are waiting on you.</Empty> : answer.map((p) => (
        <div className="portalcard" key={p.id}>
          <div>
            <b>{jobLabel(p.job_id)}</b>
            <div>{p.description}</div>
            <div className="num">{money(poTotal(p))}</div>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => run(() => store.respondPo(p.id, true), 'Work order accepted.')}>Accept</button>
            <button className="btn" onClick={() => { if (window.confirm('Decline this work order?')) void run(() => store.respondPo(p.id, false), 'Work order declined.'); }}>Decline</button>
          </div>
        </div>
      ))}

      <h2>Lien waivers to sign ({waivers.length})</h2>
      {waivers.length === 0 ? <Empty>No waivers are waiting on you.</Empty> : waivers.map((w) => (
        <div className="portalcard" key={w.id}>
          <div>
            <b>{jobName(w.job_id)}</b>
            <div>{WAIVER_LABEL[w.kind]} waiver, <span className="num">{money(w.amount_cents)}</span></div>
            {w.through_date && <div className="muted small">Through {w.through_date}</div>}
          </div>
          <button className="btn primary" onClick={() => setSigning(w)}>Upload signed waiver</button>
        </div>
      ))}

      <h2>Bill your work</h2>
      {active.length === 0 ? <Empty>You can bill once you've accepted a work order.</Empty> : active.map((p) => (
        <div className="portalcard" key={p.id}>
          <div>
            <b>{jobName(p.job_id)}</b>
            <div>{p.description}</div>
            <div className="small"><span className="num">{money(billedOn(p.id))}</span> billed of <span className="num">{money(poTotal(p))}</span></div>
          </div>
          <button className="btn primary" onClick={() => setBilling(p)}>Submit a bill</button>
        </div>
      ))}

      <div className="row between">
        <h2>Materials you asked for</h2>
        <button className="btn primary" disabled={!data.subJobs.length} onClick={() => setAsking(true)}>Ask for materials</button>
      </div>
      {data.myRequests.length === 0 ? <Empty>Need something on a job? Ask here and the office sees it right away.</Empty> : data.myRequests.map((m) => (
        <div className="portalcard" key={m.id}>
          <div>
            <b>{m.name}</b>{m.quantity && ` (${m.quantity})`}
            <div className="muted small">{jobName(m.job_id)}</div>
          </div>
          <span className={`chip ${m.status === 'arrived' ? 'good' : 'warn'}`}>
            {m.status === 'needed' ? 'Asked for' : m.status === 'ordered' ? `On order${m.expected_date ? `, arriving ${m.expected_date}` : ''}` : 'Arrived'}
          </span>
        </div>
      ))}

      <h2>Your schedule</h2>
      {tasks.length === 0 ? <Empty>No open tasks are assigned to you.</Empty> : tasks.map((t) => (
        <div className="portalcard" key={t.id}>
          <div>
            <b>{t.name}</b>
            <div className="muted small">{jobName(t.job_id)}</div>
            <div className="num small">{t.start_date} to {t.end_date}</div>
            {t.notes && <div className="small">{t.notes}</div>}
            <div style={{ marginTop: 8 }}>
              {t.contact_status === 'confirmed'
                ? <span className="chip good">You confirmed these dates</span>
                : <button className="btn primary tiny" onClick={() => run(() => store.confirmTask(t.id), "Thanks, you're confirmed.")}>I'll be there</button>}
            </div>
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
      <div className="row between">
        <h2>Your photos</h2>
        <button className="btn primary" disabled={!data.subJobs.length} onClick={() => setPhotoJob(true)}>Send job photos</button>
      </div>
      {data.photos.length === 0 ? <Empty>Send photos of your work. The office approves them or tells you what to fix.</Empty> : (
        <div className="photos">
          {data.photos.map((ph) => (
            <div className="review" key={ph.id}>
              <Thumb photo={ph} />
              <div className="small muted">{jobName(ph.job_id)}</div>
              {ph.review_status === 'pending' && <span className="chip warn">Waiting for review</span>}
              {ph.review_status === 'approved' && <span className="chip good">Approved</span>}
              {ph.review_status === 'rejected' && <div><span className="flag">Disapproved</span><div className="small">{ph.review_note}</div></div>}
            </div>
          ))}
        </div>
      )}

      <h2>Your bills</h2>
      {bills.length === 0 ? <Empty>Bills you submit appear here with their payment status.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Job</th><th>Invoice</th><th className="right">Amount</th><th>Status</th><th /></tr></thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td className="num">{b.bill_date}</td>
                  <td>{jobName(b.job_id)}</td>
                  <td>{b.invoice_no}</td>
                  <td className="right num">{money(b.amount_cents)}</td>
                  <td><Status s={b.status} />{b.status === 'rejected' && b.notes && <div className="small muted">{b.notes}</div>}{b.status === 'paid' && <div className="small muted">{b.paid_date}</div>}</td>
                  <td className="actions">{b.file_path && <FileLink path={b.file_path} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {billing && (
        <FormModal
          title={`Submit a bill: ${jobName(billing.job_id)}`}
          submit="Submit bill"
          fields={[
            { key: 'invoice_no', label: 'Invoice number' },
            { key: 'amount_cents', label: 'Amount', type: 'money', required: true },
            { key: 'bill_date', label: 'Invoice date', type: 'date', required: true },
            { key: 'file', label: 'Invoice file', type: 'file' },
          ]}
          initial={{ bill_date: today }}
          onClose={() => setBilling(null)}
          onSave={async ({ file, ...v }) => {
            if (!v.amount_cents) throw new Error('Amount: enter more than $0.');
            const ok = await run(async () => {
              const file_path = file ? await store.upload(`${folder}/${crypto.randomUUID()}-${safeFileName((file as File).name)}`, file as File) : null;
              await store.insert('bills', { ...v, po_id: billing.id, job_id: billing.job_id, vendor_id: billing.vendor_id, budget_line_id: billing.budget_line_id, status: 'submitted', file_path } as never);
            }, 'Bill submitted.');
            if (ok) setBilling(null);
          }}
        />
      )}
      {signing && (
        <FormModal
          title={`Upload ${WAIVER_LABEL[signing.kind].toLowerCase()} waiver`}
          submit="Upload waiver"
          fields={[{ key: 'file', label: 'Signed waiver', type: 'file', required: true }]}
          intro={<p className="muted">{jobName(signing.job_id)}, {money(signing.amount_cents)}. Upload a photo or PDF of the signed form.</p>}
          onClose={() => setSigning(null)}
          onSave={async ({ file }) => {
            const ok = await run(async () => {
              const path = await store.upload(`${folder}/${crypto.randomUUID()}-${safeFileName((file as File).name)}`, file as File);
              await store.submitWaiver(signing.id, path);
            }, 'Waiver uploaded.');
            if (ok) setSigning(null);
          }}
        />
      )}
      {asking && (
        <FormModal
          title="Ask for materials"
          submit="Send request"
          fields={[
            { key: 'job_id', label: 'Job', type: 'select', required: true, options: data.subJobs.map((j) => ({ value: j.id, label: j.name })) },
            { key: 'name', label: 'What do you need', required: true },
            { key: 'quantity', label: 'How much' },
            { key: 'needed_by', label: 'Need it by', type: 'date' },
            { key: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          initial={{ job_id: data.subJobs[0]?.id }}
          onClose={() => setAsking(false)}
          onSave={async (v) => {
            const ok = await run(() => store.requestMaterial(v.job_id as string, v.name as string, v.quantity as string, v.needed_by as string | null, v.notes as string), 'Request sent to the office.');
            if (ok) setAsking(false);
          }}
        />
      )}
      {photoJob && (
        <FormModal
          title="Send job photos"
          submit="Send photos"
          fields={[
            { key: 'job_id', label: 'Job', type: 'select', required: true, options: data.subJobs.map((j) => ({ value: j.id, label: j.name })) },
            { key: 'task_id', label: 'What work is this', type: 'select', options: [{ value: '', label: 'Not for a specific task' }, ...data.tasks.map((t) => ({ value: t.id, label: `${t.name} (${jobName(t.job_id)})` }))] },
            { key: 'files', label: 'Photos', type: 'files', required: true, accept: 'image/*', help: 'You can pick several at once.' },
            { key: 'caption', label: 'Caption' },
          ]}
          initial={{ job_id: data.subJobs[0]?.id, task_id: '' }}
          onClose={() => setPhotoJob(false)}
          onSave={async ({ files, job_id, task_id, caption }) => {
            const list = files as File[];
            const task = data.tasks.find((t) => t.id === task_id);
            const ok = await run(async () => {
              for (const f of list) {
                const file_path = await store.upload(`${folder}/${crypto.randomUUID()}-${safeFileName(f.name)}`, f);
                await store.insert('photos', { job_id: task?.job_id ?? (job_id as string), task_id: task?.id ?? null, vendor_id: me.vendor_id, file_path, caption: caption as string });
              }
            }, `${list.length} photo${list.length === 1 ? '' : 's'} sent for review.`);
            if (ok) setPhotoJob(false);
          }}
        />
      )}
    </div>
  );
}
