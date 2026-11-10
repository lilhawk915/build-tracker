import { useState } from 'react';
import { Link } from 'react-router-dom';
import { store, useData } from '../data';
import { bestPhone, emailLink, firstNameOf, phoneDigits, primaryContact, smsLink, taskMessage } from '../domain/jobops';
import { todayIso } from '../domain/rules';
import { canSeeContacts, type Task } from '../domain/types';
import { Empty, Modal } from './ui';

export const CONTACT_LABEL = { not_contacted: 'Not contacted', contacted: 'Contacted', confirmed: 'Confirmed' } as const;
const CONTACT_CHIP = { not_contacted: 'bad', contacted: 'warn', confirmed: 'good' } as const;

function ContactDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const { data, run, me } = useData();
  const vendor = data.vendors.find((v) => v.id === task.vendor_id);
  const contact = primaryContact(data.vendor_contacts, task.vendor_id);
  const job = data.jobs.find((j) => j.id === task.job_id);
  const [body, setBody] = useState(() => taskMessage({
    firstName: firstNameOf(contact),
    task,
    job: { name: job?.name ?? '', address: job?.address ?? '' },
    sender: me.name || me.email,
  }));
  const past = data.notifications.filter((n) => n.task_id === task.id);
  const phone = phoneDigits(bestPhone(contact));

  const record = (channel: 'text' | 'email') => run(async () => {
    await store.insert('notifications', { job_id: task.job_id, task_id: task.id, recipient: vendor?.name ?? '', channel, body });
    if (task.contact_status === 'not_contacted') await store.update('tasks', task.id, { contact_status: 'contacted' });
  }, 'Logged as contacted.');

  return (
    <Modal title={`Message ${vendor?.name ?? 'contractor'}`} onClose={onClose}>
      <label className="field">
        <span>Message</span>
        <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <p className="muted small">This opens your own texts or email with the message filled in. It isn't sent until you hit send.</p>
      <div className="row">
        {phone
          ? <a className="btn primary" href={smsLink(phone, body)} onClick={() => { void record('text'); }}>Open text</a>
          : <span className="chip warn">No valid phone on file</span>}
        {contact?.email
          ? <a className="btn" href={emailLink(contact.email, `Schedule: ${job?.name ?? 'job'}`, body)} onClick={() => { void record('email'); }}>Open email</a>
          : <span className="chip warn">No email on file</span>}
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      {past.length > 0 && (
        <p className="small muted">
          Contacted {past.length} time{past.length === 1 ? '' : 's'} about this task. Last by {past[past.length - 1].channel}.
        </p>
      )}
    </Modal>
  );
}

export function CallList({ tasks, showJob, emptyText }: { tasks: Task[]; showJob?: boolean; emptyText: string }) {
  const { data, run, me } = useData();
  const isAdmin = canSeeContacts(me);
  const [messaging, setMessaging] = useState<Task | null>(null);
  const today = todayIso();
  const vendor = (id: string | null) => data.vendors.find((v) => v.id === id);
  const job = (id: string) => data.jobs.find((j) => j.id === id);
  if (!tasks.length) return <Empty>{emptyText}</Empty>;
  return (
    <div className="stack">
    {!isAdmin && <p className="muted small">Contractor phone numbers and emails are private. Ask someone with access to make the call, then mark it here.</p>}
    <div className="tablewrap">
      <table>
        <thead><tr><th>Starts</th>{showJob && <th>Job</th>}<th>Work</th><th>Contractor</th><th>Status</th><th /></tr></thead>
        <tbody>
          {tasks.map((t) => {
            const v = vendor(t.vendor_id);
            const contact = primaryContact(data.vendor_contacts, t.vendor_id);
            const tel = phoneDigits(bestPhone(contact));
            return (
              <tr key={t.id}>
                <td className="num">
                  {t.start_date}
                  {t.start_date < today && t.status === 'todo' && <div><span className="flag">Should have started</span></div>}
                </td>
                {showJob && <td><Link to={`/jobs/${t.job_id}/contractors`}>{job(t.job_id)?.name}</Link></td>}
                <td>{t.name}</td>
                <td>{v?.name}{bestPhone(contact) && <div className="small muted">{contact?.name && `${contact.name}, `}{bestPhone(contact)}</div>}</td>
                <td><span className={`chip ${CONTACT_CHIP[t.contact_status]}`}>{CONTACT_LABEL[t.contact_status]}</span></td>
                <td className="actions">
                  {tel && (
                    <a
                      className="btn tiny"
                      href={`tel:${tel}`}
                      onClick={() => { void run(async () => {
                        await store.insert('notifications', { job_id: t.job_id, task_id: t.id, recipient: v?.name ?? '', channel: 'call', body: '' });
                        if (t.contact_status === 'not_contacted') await store.update('tasks', t.id, { contact_status: 'contacted' });
                      }); }}
                    >
                      Call
                    </a>
                  )}
                  {isAdmin && <button className="btn tiny" onClick={() => setMessaging(t)}>Message</button>}
                  {t.contact_status !== 'confirmed'
                    ? <button className="btn tiny" onClick={() => run(() => store.update('tasks', t.id, { contact_status: 'confirmed' }), `${v?.name} confirmed for ${t.name}.`)}>Mark confirmed</button>
                    : <button className="btn tiny" onClick={() => run(() => store.update('tasks', t.id, { contact_status: 'contacted' }), 'Confirmation removed.')}>Undo</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {messaging && <ContactDialog task={messaging} onClose={() => setMessaging(null)} />}
    </div>
    </div>
  );
}
