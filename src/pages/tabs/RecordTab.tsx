import { useState } from 'react';
import { Empty, FormModal, money, Status } from '../../components/ui';
import { store, useData } from '../../data';
import { rollupJob } from '../../domain/budget';
import { bestPhone, primaryContact } from '../../domain/jobops';
import { stepsFor } from '../../domain/record';
import { canSeeContacts, jobTypeLabel, type Job, type JobStep } from '../../domain/types';
import { FilesTable, sortFiles } from './FilesTab';
import { Thumb } from './LogTab';
import { SelectionsTable } from './SelectionsTab';

export function RecordTab({ job }: { job: Job }) {
  const { data, run, me } = useData();
  const [edit, setEdit] = useState<JobStep | 'new' | null>(null);
  const of = <T extends { job_id: string }>(rows: T[]) => rows.filter((r) => r.job_id === job.id);
  const draws = of(data.draws);
  const ids = new Set(draws.map((d) => d.id));
  const r = rollupJob(job, of(data.budget_lines), of(data.pos), of(data.bills), of(data.change_orders), draws, data.draw_lines.filter((l) => ids.has(l.draw_id)));
  const steps = stepsFor(job, data.budget_lines, data.pos, data.bills, data.tasks, data.job_steps, data.vendors);
  const handCost = of(data.job_steps).reduce((s, x) => s + (x.cost_cents ?? 0), 0);
  const scope = of(data.scope_items);
  const materials = of(data.materials);
  const selections = of(data.selections);
  const files = sortFiles(of(data.documents));
  const photos = of(data.photos).filter((p) => p.review_status === 'approved');
  const logs = of(data.daily_logs).sort((a, b) => a.log_date.localeCompare(b.log_date));
  const changes = of(data.change_orders).filter((c) => c.status === 'approved');
  const vendorName = (id: string | null) => data.vendors.find((v) => v.id === id)?.name ?? '';
  const vendorPhone = (id: string | null) => bestPhone(primaryContact(data.vendor_contacts, id));
  const isAdmin = canSeeContacts(me);

  const facts: [string, string | number | null | undefined][] = [
    ['Type', jobTypeLabel(job)],
    ['Address', job.address],
    ['Started', job.start_date],
    ['Finished', job.finish_date],
    ['Client or buyer', job.client_name],
    ['Client phone', job.client_phone],
    ['Client email', job.client_email],
    ['Floor plan', job.plan_name],
    ['Square feet', job.square_feet?.toLocaleString('en-US')],
    ['Bedrooms', job.bedrooms],
    ['Bathrooms', job.bathrooms],
    ['Stories', job.stories],
    ['Permit number', job.permit_number],
    ['Lender', job.lender],
    ['Loan', job.loan_amount_cents ? money(job.loan_amount_cents) : null],
    ['Price', r.salePrice ? money(r.salePrice) : null],
    ['Recorded cost', r.paid + handCost ? money(r.paid + handCost) : null],
  ];

  return (
    <div className="record">
      <div className="row between noprint" style={{ marginBottom: 16 }}>
        <p className="muted">Everything about this job on one page.</p>
        <button className="btn" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <section className="panel">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{job.name}</h2>
          <Status s={job.status} />
        </div>
        <dl className="factgrid">
          {facts.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {job.notes && <p style={{ marginTop: 14, whiteSpace: 'pre-wrap' }}>{job.notes}</p>}
      </section>

      {scope.length > 0 && (
        <section>
          <h2>What the job needs</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Item</th><th>Where</th><th>Details</th><th>Status</th></tr></thead>
              <tbody>{scope.map((s) => <tr key={s.id}><td><b>{s.title}</b></td><td>{s.location}</td><td>{s.details}</td><td><Status s={s.status} /></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <div className="row between">
          <h2>Who did each step</h2>
          <button className="btn noprint" onClick={() => setEdit('new')}>Add a step</button>
        </div>
        {steps.length === 0 ? <Empty>Record who did each step. On live jobs this fills in from POs, bills, and the schedule.</Empty> : (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Step</th><th>Who</th>{isAdmin && <th>Phone</th>}<th>Dates</th><th className="right">Amount</th><th>Notes</th><th className="noprint" /></tr></thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.key}>
                    <td><b>{s.step}</b></td>
                    <td>{s.who}</td>
                    {isAdmin && <td>{vendorPhone(s.vendorId)}</td>}
                    <td className="num small">{s.start}{s.end && s.end !== s.start ? ` to ${s.end}` : ''}</td>
                    <td className="right num">{s.amount != null ? money(s.amount) : ''}</td>
                    <td className="small">{s.notes}</td>
                    <td className="actions noprint">
                      {s.stepId && <button className="btn tiny" onClick={() => setEdit(data.job_steps.find((x) => x.id === s.stepId)!)}>Edit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Colors and selections</h2>
        {selections.length === 0 ? <Empty>None recorded yet. Add them on the Colors and selections tab.</Empty>
          : <SelectionsTable rows={selections} vendorName={vendorName} />}
      </section>

      <section>
        <h2>Drawings and files</h2>
        {files.length === 0 ? <Empty>None added yet. Add them on the Drawings and files tab.</Empty> : <FilesTable rows={files} />}
      </section>

      {materials.length > 0 && (
        <section>
          <h2>Materials</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Item</th><th>Qty</th><th>Supplier</th><th>Order no.</th><th>Status</th><th>Arrived</th><th className="right">Cost</th></tr></thead>
              <tbody>
                {materials.map((m) => (
                  <tr key={m.id}><td><b>{m.name}</b></td><td>{m.quantity}</td><td>{m.supplier}</td><td className="num small">{m.order_number}</td><td>{m.status === 'ordered' ? 'On order' : m.status === 'arrived' ? 'Arrived' : 'Needed'}</td><td className="num small">{m.arrived_date}</td><td className="right num">{m.cost_cents != null ? money(m.cost_cents) : ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {changes.length > 0 && (
        <section>
          <h2>Approved change orders</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>No.</th><th>What changed</th><th className="right">Cost</th></tr></thead>
              <tbody>
                {changes.map((c) => <tr key={c.id}><td className="num">{c.number}</td><td>{c.description}</td><td className="right num">{money(c.cost_delta_cents)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {photos.length > 0 && (
        <section>
          <h2>Photos</h2>
          <div className="photos">{photos.map((p) => <Thumb key={p.id} photo={p} />)}</div>
        </section>
      )}

      {logs.length > 0 && (
        <section>
          <h2>Site log</h2>
          <div className="stack">
            {logs.map((l) => (
              <div className="panel" key={l.id}>
                <b className="num">{l.log_date}</b> <span className="muted small">{[l.weather, l.author].filter(Boolean).join(' · ')}</span>
                <p style={{ whiteSpace: 'pre-wrap' }}>{l.notes}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {edit && (
        <FormModal
          title={edit === 'new' ? 'Add a step' : `Edit ${edit.step}`}
          submit={edit === 'new' ? 'Add step' : 'Save step'}
          fields={[
            { key: 'step', label: 'Step', required: true, help: 'Framing, paint, replaced the water heater…' },
            { key: 'vendor_id', label: 'Who did it', type: 'select', options: [{ value: '', label: 'Not in the sub list' }, ...[...data.vendors].sort((a, b) => a.name.localeCompare(b.name)).map((v) => ({ value: v.id, label: v.name }))] },
            { key: 'other_name', label: 'Name, if not in the sub list' },
            { key: 'start_date', label: 'Started', type: 'date' },
            { key: 'end_date', label: 'Finished', type: 'date' },
            { key: 'cost_cents', label: 'What it cost', type: 'money', help: 'Leave blank if you do not know.' },
            { key: 'notes', label: 'Notes', type: 'textarea', help: 'How did they do? Would you use them again?' },
          ]}
          initial={edit === 'new' ? { vendor_id: '' } : { ...edit, vendor_id: edit.vendor_id ?? '' }}
          onClose={() => setEdit(null)}
          intro={edit !== 'new' ? (
            <button type="button" className="btn danger tiny" style={{ justifySelf: 'start' }} onClick={async () => {
              if (await run(() => store.remove('job_steps', edit.id), 'Step deleted.')) setEdit(null);
            }}>Delete this step</button>
          ) : undefined}
          onSave={async (v) => {
            const row = { ...v, vendor_id: (v.vendor_id as string) || null, cost_cents: (v.cost_cents as number) || null };
            const ok = await run(
              () => edit === 'new' ? store.insert('job_steps', { ...row, job_id: job.id } as never) : store.update('job_steps', edit.id, row as never),
              'Step saved.',
            );
            if (ok) setEdit(null);
          }}
        />
      )}
    </div>
  );
}
