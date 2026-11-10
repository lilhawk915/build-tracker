import { useState } from 'react';
import { Empty, FormModal } from '../components/ui';
import { store, useData } from '../data';
import { easternClock, planAutoTexts, sendWindowProblem } from '../../supabase/functions/_shared/autotext';

export function AutoTextsPage() {
  const { data, run, me } = useData();
  const [editing, setEditing] = useState(false);
  const settings = data.auto_text_settings[0];
  if (!settings) return <div className="alert" role="alert">Automatic text settings are missing. Reload the page to try again.</div>;
  const isAdmin = me.role === 'admin';
  const now = new Date();
  const plan = planAutoTexts({ tasks: data.tasks, jobs: data.jobs, vendors: data.vendors, contacts: data.vendor_contacts, log: data.auto_texts, settings, today: easternClock(now).date });
  const ready = plan.filter((p) => !p.blocked);
  const blocked = plan.filter((p) => p.blocked);
  const waitReason = sendWindowProblem(settings, now);

  return (
    <div className="stack">
      <div className="row between">
        <h1>Automatic texts</h1>
        {settings.enabled ? <span className="flag">On in settings</span> : <span className="chip">Off</span>}
      </div>
      <div className={`alert ${settings.enabled ? 'warn' : 'calm'}`}>
        {settings.enabled
          ? <><b>The app setting is on.</b> Texts send only if the server switch is on too.</>
          : <><b>Off. Nothing is being sent.</b> Below is a preview of what would go out.</>}
        {' '}Two switches must both be on: this setting and the server switch, which also holds the Kixie key.
      </div>
      <div className="panel stack">
        <dl className="figs strip">
          <div><dt>First notice</dt><dd>{settings.notice_days} days before</dd></div>
          <div><dt>Reminder</dt><dd>{settings.reminder_days} day{settings.reminder_days === 1 ? '' : 's'} before</dd></div>
          <div><dt>Sending hours</dt><dd>{settings.start_hour}:00 to {settings.end_hour}:00 ET</dd></div>
          <div><dt>Limit per day</dt><dd>{settings.daily_cap}</dd></div>
          <div><dt>Signed as</dt><dd>{settings.sender_name || 'Not set'}</dd></div>
        </dl>
        <p className="muted small">
          Weekdays only. Only contractors who haven't confirmed get a text, and only contacts marked as agreeing to automatic texts.
          If a job's dates change, they get a new notice for the new dates.{waitReason && ` Right now: ${waitReason}`}
        </p>
        {isAdmin && (
          <div className="row">
            <button className="btn" onClick={() => setEditing(true)}>Change settings</button>
            {settings.enabled
              ? <button className="btn" onClick={() => run(() => store.update('auto_text_settings', 'main', { enabled: false }), 'Automatic texts turned off.')}>Turn off</button>
              : <button className="btn danger" onClick={() => {
                  if (window.confirm('Turn on the app setting? Once the server switch is also on, texts go to real contractors.')) {
                    void run(() => store.update('auto_text_settings', 'main', { enabled: true }), 'App setting turned on.');
                  }
                }}>Turn on</button>}
          </div>
        )}
      </div>

      <h2>Would send now ({ready.length})</h2>
      {ready.length === 0 ? <Empty>No texts are ready to send.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Job</th><th>Contractor</th><th>Type</th><th>Message</th></tr></thead>
            <tbody>{ready.map((p) => (
              <tr key={`${p.taskId}-${p.kind}`}><td>{p.jobName}</td><td>{p.recipient}<div className="small muted">{p.phone}</div></td><td>{p.kind === 'notice' ? 'Notice' : 'Reminder'}</td><td className="small">{p.body}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {blocked.length > 0 && (
        <>
          <h2>Won't send until fixed ({blocked.length})</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Job</th><th>Work</th><th>Contractor</th><th>Why not</th></tr></thead>
              <tbody>{blocked.map((p) => (
                <tr key={`${p.taskId}-${p.kind}`}><td>{p.jobName}</td><td>{p.taskName}</td><td>{p.recipient}</td><td>{p.blocked}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      <h2>Sent history</h2>
      {data.auto_texts.length === 0 ? <Empty>No automatic texts have been sent.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>When</th><th>Contractor</th><th>Type</th><th>Result</th><th>Message</th></tr></thead>
            <tbody>{data.auto_texts.map((l) => (
              <tr key={l.id}>
                <td className="num small">{new Date(l.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET</td>
                <td>{l.recipient}</td>
                <td>{l.kind === 'notice' ? 'Notice' : 'Reminder'}</td>
                <td>{l.status === 'accepted' ? <span className="chip warn">Accepted by Kixie</span> : <span className="flag">Failed</span>}{l.error && <div className="small muted">{l.error}</div>}</td>
                <td className="small">{l.body}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {editing && (
        <FormModal
          title="Change automatic text settings"
          submit="Save settings"
          fields={[
            { key: 'sender_name', label: 'Signed as', required: true, help: 'The name in each text.' },
            { key: 'notice_days', label: 'First notice, days before', type: 'number', required: true },
            { key: 'reminder_days', label: 'Reminder, days before', type: 'number', required: true },
            { key: 'start_hour', label: 'Start sending at (hour, 0 to 23, Eastern)', type: 'number', required: true },
            { key: 'end_hour', label: 'Stop sending at (hour, 1 to 24, Eastern)', type: 'number', required: true },
            { key: 'daily_cap', label: 'Most texts per day', type: 'number', required: true },
          ]}
          initial={settings as never}
          onClose={() => setEditing(false)}
          onSave={async (v) => {
            const reminder = v.reminder_days as number;
            const notice = v.notice_days as number;
            if (reminder >= notice) throw new Error('The reminder must come after the first notice, so use fewer days before.');
            if ((v.start_hour as number) >= (v.end_hour as number)) throw new Error('Start sending must be earlier than stop sending.');
            if (await run(() => store.update('auto_text_settings', 'main', v as never), 'Settings saved.')) setEditing(false);
          }}
        />
      )}
    </div>
  );
}
