import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, FormModal, Status } from '../../components/ui';
import { store, useData } from '../../data';
import { projectToRows, rowsToProject } from '../../estimator/convert';
import { newProject } from '../../estimator/domain/house/defaults';
import { priceProject } from '../../estimator/domain/pricing/resolve';
import { COST_ONLY, useEstimating, usd } from '../../estimator/ui';

const STATUS_WORD: Record<string, string> = { draft: 'Draft', sent: 'Sent', won: 'Won', lost: 'Lost' };

export function EstimatesPage() {
  const { data, run } = useData();
  const nav = useNavigate();
  const { catalog, settings, isAdmin } = useEstimating();
  const [q, setQ] = useState('');
  const [show, setShow] = useState('');
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => data.estimates.map((e) => {
    const m = data.estimate_markups.find((x) => x.estimate_id === e.id) ?? null;
    const p = rowsToProject(e, m);
    const priced = priceProject(isAdmin ? p : { ...p, markups: COST_ONLY }, catalog, settings);
    return { e, priced };
  }).sort((a, b) => b.e.updated_at.localeCompare(a.e.updated_at)), [data.estimates, data.estimate_markups, catalog, settings, isAdmin]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter(({ e, priced }) => (!show || e.status === show) && words.every((w) =>
    [e.client_name, e.address, e.notes, e.assumptions, ...priced.lines.map((l) => l.name)].join(' ').toLowerCase().includes(w)));

  return (
    <div className="stack">
      <div className="row between">
        <h1>Estimates</h1>
        <div className="row">
          <Link className="btn" to="/estimates/catalog">Price catalog</Link>
          {isAdmin && <Link className="btn" to="/estimates/settings">Quote settings</Link>}
          {isAdmin && <Link className="btn" to="/estimates/import">Import from Estimator</Link>}
          <button className="btn primary" onClick={() => setAdding(true)}>New estimate</button>
        </div>
      </div>
      {catalog.length === 0 && <div className="alert warn">The price catalog is empty, so house estimates will price at $0. Open <Link to="/estimates/catalog">Price catalog</Link> to load it.</div>}
      <div className="filters">
        <label className="field"><span>Search</span><input type="search" aria-label="Search estimates" placeholder="Client, address, or a line item" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="field"><span>Show</span>
          <select value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="">Every status</option>
            {Object.entries(STATUS_WORD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      {shown.length === 0 ? <Empty>{rows.length ? 'No estimates match.' : 'No estimates yet. Start one with New estimate.'}</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Client</th><th>Address</th><th>Type</th><th>Status</th><th>Quote date</th><th className="right">Lines</th><th className="right">{isAdmin ? 'Client price' : 'Cost'}</th></tr></thead>
            <tbody>
              {shown.map(({ e, priced }) => (
                <tr key={e.id}>
                  <td><Link to={`/estimates/${e.id}`}><b>{e.client_name || '(no name)'}</b></Link></td>
                  <td>{e.address}</td>
                  <td>{e.kind === 'house' ? 'House' : 'Custom'}</td>
                  <td><Status s={e.status === 'won' ? 'approved' : e.status === 'lost' ? 'rejected' : e.status === 'sent' ? 'sent' : 'pending'} /> <span className="small">{STATUS_WORD[e.status]}</span></td>
                  <td className="num small">{e.quote_date}</td>
                  <td className="right num">{priced.lines.length}</td>
                  <td className="right num">{usd(isAdmin ? priced.totals.grandTotal : priced.totals.material + priced.totals.labor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <FormModal
          title="New estimate"
          submit="Start estimate"
          fields={[
            { key: 'client_name', label: 'Client or job name', required: true },
            { key: 'address', label: 'Property address' },
            { key: 'kind', label: 'Type', type: 'select', options: [{ value: 'custom', label: 'Custom quote: add each line yourself' }, { value: 'house', label: 'House estimate: lines filled in from the house details' }] },
          ]}
          initial={{ kind: 'custom' }}
          onClose={() => setAdding(false)}
          onSave={async (v) => {
            const id = crypto.randomUUID();
            const p = newProject(id, settings, new Date().toISOString(), v.kind as 'custom' | 'house');
            p.clientName = String(v.client_name).trim();
            p.address = String(v.address ?? '').trim();
            const { estimate } = projectToRows(p, id, settings);
            const ok = await run(() => store.insert('estimates', { ...estimate, legacy_id: null } as never), 'Estimate started.');
            if (ok) { setAdding(false); nav(`/estimates/${id}`); }
          }}
        />
      )}
    </div>
  );
}
