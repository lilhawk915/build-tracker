import { niceDate } from '../../domain/rules';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, FormModal, Status } from '../../components/ui';
import { store, useData } from '../../data';
import { projectToRows, rowsToProject } from '../../estimator/convert';
import { newProject } from '../../estimator/domain/house/defaults';
import { priceProject } from '../../estimator/domain/pricing/resolve';
import { COST_ONLY, useEstimating, usd } from '../../estimator/ui';
import { workTypeText } from './workType';

const STATUS_WORD: Record<string, string> = { draft: 'Draft', sent: 'Sent, waiting', won: 'Accepted', lost: 'Not accepted' };

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
    [e.client_name, e.address, workTypeText(e), e.notes, e.assumptions, ...priced.lines.map((l) => l.name)].join(' ').toLowerCase().includes(w)));

  // Profit you could still make (draft or sent) and profit already won. Not-accepted quotes count for nothing.
  const sum = (st: string[]) => rows.filter(({ e }) => st.includes(e.status)).reduce((t, { priced }) => ({ n: t.n + 1, profit: t.profit + priced.totals.profit, price: t.price + priced.totals.grandTotal }), { n: 0, profit: 0, price: 0 });
  const open = sum(['draft', 'sent']);
  const won = sum(['won']);

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
      {isAdmin && rows.length > 0 && (
        <dl className="figs strip" aria-label="Projected profit">
          <div><dt>Projected profit, waiting on client ({open.n})</dt><dd>{usd(open.profit)}</dd><dd className="muted small">on {usd(open.price)} quoted</dd></div>
          <div><dt>Profit on accepted jobs ({won.n})</dt><dd>{usd(won.profit)}</dd><dd className="muted small">on {usd(won.price)} sold</dd></div>
          <div><dt>Total projected profit</dt><dd><b>{usd(open.profit + won.profit)}</b></dd><dd className="muted small">Not-accepted quotes left out</dd></div>
        </dl>
      )}
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
            <thead><tr><th>Client</th><th>Address</th><th>Type</th><th>Accepted?</th><th>Quote date</th><th className="right">Lines</th><th className="right">{isAdmin ? 'Client price' : 'Cost'}</th>{isAdmin && <th className="right">Projected profit</th>}</tr></thead>
            <tbody>
              {shown.map(({ e, priced }) => (
                <tr key={e.id}>
                  <td><Link to={`/estimates/${e.id}`}><b>{e.client_name || '(no name)'}</b></Link></td>
                  <td>{e.address}</td>
                  <td>{workTypeText(e)}</td>
                  <td><Status s={e.status === 'won' ? 'approved' : e.status === 'lost' ? 'rejected' : e.status === 'sent' ? 'sent' : 'pending'} /> <span className="small">{STATUS_WORD[e.status]}</span></td>
                  <td className="num small">{niceDate(e.quote_date)}</td>
                  <td className="right num">{priced.lines.length}</td>
                  <td className="right num">{usd(isAdmin ? priced.totals.grandTotal : priced.totals.material + priced.totals.labor)}</td>
                  {isAdmin && <td className={`right num${e.status === 'lost' ? ' muted' : ''}`}>{usd(priced.totals.profit)}</td>}
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
            { key: 'work_type', label: 'Type of work', help: 'For example: Custom home, Insulation, Mold remediation' },
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
            const ok = await run(() => store.insert('estimates', { ...estimate, legacy_id: null, work_type: String(v.work_type ?? '').trim() } as never), 'Estimate started.');
            if (ok) { setAdding(false); nav(`/estimates/${id}`); }
          }}
        />
      )}
    </div>
  );
}
