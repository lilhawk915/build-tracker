import { useState } from 'react';
import { Empty, FileLink, FormModal, money, Status, WAIVER_LABEL } from '../../components/ui';
import { store, useData } from '../../data';
import { safeFileName } from '../../data/store';
import type { Job, Waiver } from '../../domain/types';

const KINDS = Object.entries(WAIVER_LABEL).map(([value, label]) => ({ value, label }));

export function WaiversTab({ job }: { job: Job }) {
  const { data, run } = useData();
  const [receiving, setReceiving] = useState<Waiver | null>(null);
  const [changing, setChanging] = useState<Waiver | null>(null);
  const waivers = data.lien_waivers.filter((w) => w.job_id === job.id).sort((a, b) => a.status.localeCompare(b.status) || (a.through_date ?? '').localeCompare(b.through_date ?? ''));
  const vendorName = (id: string) => data.vendors.find((v) => v.id === id)?.name ?? '';
  const invoice = (id: string | null) => data.bills.find((b) => b.id === id)?.invoice_no;

  return (
    <div className="stack">
      <h2>Lien waivers</h2>
      <p className="muted">Approving a bill requests a conditional waiver. Paying it requests the unconditional one.</p>
      {waivers.length === 0 ? <Empty>Waivers appear here when you approve a bill.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Sub</th><th>Type</th><th>Invoice</th><th className="right">Amount</th><th>Through</th><th>Status</th><th /></tr></thead>
            <tbody>
              {waivers.map((w) => (
                <tr key={w.id}>
                  <td>{vendorName(w.vendor_id)}</td>
                  <td>{WAIVER_LABEL[w.kind]}</td>
                  <td>{invoice(w.bill_id)}</td>
                  <td className="right num">{money(w.amount_cents)}</td>
                  <td className="num">{w.through_date}</td>
                  <td><Status s={w.status} /></td>
                  <td className="actions">
                    {w.file_path && <FileLink path={w.file_path} />}
                    {w.status === 'requested' && <button className="btn tiny" onClick={() => setChanging(w)}>Change type</button>}
                    {w.status === 'requested' && <button className="btn tiny" onClick={() => setReceiving(w)}>Mark received</button>}
                    {w.status === 'received' && <button className="btn tiny" onClick={() => run(() => store.update('lien_waivers', w.id, { status: 'requested' }), 'Waiver sent back to requested.')}>Send back</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {changing && (
        <FormModal
          title="Change waiver type"
          submit="Save type"
          fields={[{ key: 'kind', label: 'Type', type: 'select', options: KINDS, help: 'Use final for the last payment on a job.' }]}
          initial={changing as never}
          onClose={() => setChanging(null)}
          onSave={async (v) => {
            if (await run(() => store.update('lien_waivers', changing.id, { kind: v.kind as Waiver['kind'] }), 'Waiver type saved.')) setChanging(null);
          }}
        />
      )}
      {receiving && (
        <FormModal
          title="Mark waiver received"
          submit="Mark received"
          fields={[{ key: 'file', label: 'Signed waiver', type: 'file', help: 'Attach the signed copy so you can find it later.' }]}
          onClose={() => setReceiving(null)}
          onSave={async ({ file }) => {
            const ok = await run(async () => {
              const file_path = file
                ? await store.upload(`${job.id}/${crypto.randomUUID()}-${safeFileName((file as File).name)}`, file as File)
                : receiving.file_path;
              await store.update('lien_waivers', receiving.id, { status: 'received', file_path });
            }, 'Waiver marked received.');
            if (ok) setReceiving(null);
          }}
        />
      )}
    </div>
  );
}
