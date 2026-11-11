import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FormModal } from '../../components/ui';
import { store, useData } from '../../data';
import { rowsToProject } from '../../estimator/convert';
import { validUntil } from '../../estimator/domain/house/defaults';
import { linesToCsv } from '../../estimator/domain/pricing/exportCsv';
import { marginPct, priceProject } from '../../estimator/domain/pricing/resolve';
import type { Markups, Project } from '../../estimator/domain/types';
import { COST_ONLY, NumberCell, TextBlock, TextCell, downloadFile, qtyText, safeName, useEstimating, useQuotePdf, useSaveQueue, usd } from '../../estimator/ui';
import { HouseInputs } from './HouseInputs';
import { LineTable } from './LineTable';
import { QuoteToInvoice } from './QuoteToInvoice';

const STATUS = [['draft', 'Draft'], ['sent', 'Sent to client'], ['won', 'Won'], ['lost', 'Lost']] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function MarkupsBox({ project, priced, update }: { project: Project; priced: ReturnType<typeof priceProject>; update: (c: (p: Project) => Project) => void }) {
  const m = priced.markups;
  const t = priced.totals;
  const set = (patch: Partial<Markups>) => update((p) => ({ ...p, markups: { ...m, ...p.markups, ...patch } }));
  const dollars = m.profitAmount !== null;
  const pct = (key: 'salesTaxPct' | 'contingencyPct' | 'overheadPct', label: string) => (
    <span className="row nowrap" style={{ gap: 4 }}><NumberCell className="field num short" label={`${label} percent`} value={m[key]} onCommit={(v) => set({ [key]: v ?? 0 })} />%</span>
  );
  const line = (label: string, input: React.ReactNode, amount: number, strong = false) => (
    <div className={`mkrow${strong ? ' strong' : ''}`}><span>{label}</span><span>{input}</span><span className="num right">{usd(amount)}</span></div>
  );
  return (
    <section className="panel markups" aria-label="Profit and markups for this quote">
      <h3>Profit and markups <span className="chip">admins only</span></h3>
      {line('Line items (material + labor)', null, t.material + t.labor)}
      {line('Sales tax on materials', pct('salesTaxPct', 'Sales tax'), t.tax)}
      {line('Contingency', pct('contingencyPct', 'Contingency'), t.contingency)}
      {line('Overhead', pct('overheadPct', 'Overhead'), t.overhead)}
      {line('Profit', (
        <span className="row nowrap" style={{ gap: 4 }}>
          <NumberCell className="field num short" label="Profit percent" value={dollars ? null : m.profitPct} nullable edited={!dollars} onCommit={(v) => set({ profitPct: v ?? 0, profitAmount: null })} />%
          <span className="muted">or $</span>
          <NumberCell className="field num" label="Profit dollars" value={m.profitAmount} nullable edited={dollars} placeholder={qtyText(Math.round(t.profit))} onCommit={(v) => set({ profitAmount: v })} />
        </span>
      ), t.profit)}
      {line('Grand total', null, t.grandTotal, true)}
      <p className="muted small right">Profit is {qtyText(Math.round(marginPct(t.profit, t.grandTotal) * 10) / 10)}% of the grand total.</p>
      <p className="muted small">
        Type profit as a percent or as dollars; the highlighted box is the one in use. Clear the dollar box to go back to the percent.
        {project.kind === 'custom' ? ' The client PDF rolls these into the prices shown, so the client never sees them.' : ''}
      </p>
    </section>
  );
}

export function EstimatePage() {
  const { estimateId } = useParams();
  const { data, me, run, say, reload, undoTick } = useData();
  const nav = useNavigate();
  const { catalog, settings, isAdmin } = useEstimating();
  const row = data.estimates.find((e) => e.id === estimateId);
  const markupsRow = data.estimate_markups.find((m) => m.estimate_id === estimateId) ?? null;
  const [project, setProject] = useState<Project | null>(null);
  const current = useRef<Project | null>(null);
  const [tab, setTab] = useState<'lines' | 'house' | 'terms' | 'versions'>('lines');
  const [savingVersion, setSavingVersion] = useState(false);
  const queue = useSaveQueue();
  const pdf = useQuotePdf();
  const [status, setStatus] = useState(row?.status ?? 'draft');
  const [acceptNow, setAcceptNow] = useState(false);

  // Load once per estimate. After that the page works on its own copy and saves each change.
  const loadedFor = useRef<string | null>(null);
  const tickSeen = useRef(undoTick);
  useEffect(() => {
    // After an undo the saved estimate changed underneath this page, so take a fresh copy.
    if (row && (loadedFor.current !== row.id || tickSeen.current !== undoTick)) {
      tickSeen.current = undoTick;
      const p = rowsToProject(row, markupsRow);
      current.current = p;
      setProject(p);
      setStatus(row.status);
      loadedFor.current = row.id;
    }
  }, [row, markupsRow, undoTick]);
  // Leaving the page refreshes the lists, so totals there are current.
  useEffect(() => () => { void queue(async () => { await reload(); }); }, []);

  if (!row) return <div className="alert" role="alert">This estimate no longer exists or you don't have access to it.</div>;
  if (!project) return <p className="muted">Loading…</p>;

  const save = (prev: Project, next: Project) => queue(async () => {
    const patch: Record<string, unknown> = {};
    const fields: [keyof Project, string][] = [['clientName', 'client_name'], ['address', 'address'], ['date', 'quote_date'], ['notes', 'notes'], ['inputs', 'inputs'], ['lineEdits', 'line_edits'], ['customLines', 'custom_lines'], ['assumptions', 'assumptions'], ['validityDays', 'validity_days'], ['depositPct', 'deposit_pct']];
    for (const [k, col] of fields) if (!same(prev[k], next[k])) patch[col] = next[k];
    try {
      if (Object.keys(patch).length) await store.update('estimates', next.id, patch as never);
      if (isAdmin && next.markups && !same(prev.markups, next.markups)) {
        const m = next.markups;
        await store.update('estimate_markups', next.id, { sales_tax_pct: m.salesTaxPct, contingency_pct: m.contingencyPct, overhead_pct: m.overheadPct, profit_pct: m.profitPct, profit_amount: m.profitAmount });
      }
    } catch (e) {
      say('err', `That change was not saved: ${(e as Error).message}. Reload the page to see what is saved.`);
    }
  });
  const update = (change: (p: Project) => Project) => {
    const prev = current.current!;
    const next = { ...change(prev), updatedAt: new Date().toISOString() };
    current.current = next;
    setProject(next);
    void save(prev, next);
  };

  // Staff price at cost. Only admins have the markups row, so only they see a client price.
  const priced = priceProject(isAdmin ? project : { ...project, markups: COST_ONLY }, catalog, settings);
  const through = validUntil(project.date, project.validityDays);
  const versions = data.estimate_versions.filter((v) => v.estimate_id === row.id).sort((a, b) => b.created_at.localeCompare(a.created_at));

  const saveVersion = (label: string) => run(async () => {
    await queue(async () => {});
    await store.insert('estimate_versions', { estimate_id: row.id, label, data: { project: current.current!, catalog, settings } });
  }, 'Version saved.');

  const restore = async (v: (typeof versions)[number]) => {
    if (!window.confirm(`Restore "${v.label}"? Your current quote is saved as a version first, and prices come from today's catalog.`)) return;
    const prev = current.current!;
    const ok = await run(async () => {
      await queue(async () => {});
      await store.insert('estimate_versions', { estimate_id: row.id, label: `Auto-saved before restoring "${v.label}"`, data: { project: prev, catalog, settings } });
      const r = v.data.project;
      const next: Project = { ...prev, kind: r.kind, clientName: r.clientName, address: r.address, date: r.date, notes: r.notes, inputs: r.inputs, lineEdits: r.lineEdits, customLines: r.customLines, assumptions: r.assumptions, validityDays: r.validityDays, depositPct: r.depositPct ?? prev.depositPct, markups: r.markups ?? prev.markups };
      await store.update('estimates', row.id, { client_name: next.clientName, address: next.address, quote_date: next.date, notes: next.notes, inputs: next.inputs, line_edits: next.lineEdits, custom_lines: next.customLines, assumptions: next.assumptions, validity_days: next.validityDays, deposit_pct: next.depositPct ?? 0 } as never);
      if (next.markups) {
        const m = next.markups;
        await store.update('estimate_markups', row.id, { sales_tax_pct: m.salesTaxPct, contingency_pct: m.contingencyPct, overhead_pct: m.overheadPct, profit_pct: m.profitPct, profit_amount: m.profitAmount });
      }
      current.current = next;
      setProject(next);
    }, `Restored "${v.label}".`);
    if (ok) setTab('lines');
  };

  return (
    <div className="stack">
      <div className="row between">
        <Link to="/estimates">← All estimates</Link>
        <div className="row">
          <button className="btn" onClick={() => downloadFile(`${safeName(project.clientName || project.address)}_lines.csv`, new Blob([linesToCsv(priced.lines, priced.totals)], { type: 'text/csv' }))}>Download lines (CSV)</button>
          {isAdmin && <button className="btn" disabled={pdf.busy} onClick={() => pdf.download('internal', project, catalog, settings)}>Internal PDF</button>}
          {isAdmin && <button className="btn primary" disabled={pdf.busy} onClick={() => pdf.download('client', project, catalog, settings)}>{pdf.busy ? 'Making PDF…' : 'Client quote PDF'}</button>}
        </div>
      </div>
      <div className="panel estimatehead">
        {project.quoteNumber ? <h1 style={{ margin: 0 }}>Quote #{project.quoteNumber}</h1> : null}
        <div className="inrow"><span>Client</span><TextCell className="field" label="Client name" value={project.clientName} onCommit={(v) => update((p) => ({ ...p, clientName: v }))} /></div>
        <div className="inrow"><span>Property address</span><TextCell className="field" label="Property address" value={project.address} onCommit={(v) => update((p) => ({ ...p, address: v }))} /></div>
        <div className="inrow"><span>Quote date</span><TextCell className="field" type="date" label="Quote date" value={project.date} onCommit={(v) => v && update((p) => ({ ...p, date: v }))} /></div>
        <div className="inrow"><span>Valid for (days)</span><NumberCell className="field num" label="Valid for days" value={project.validityDays} min={1} onCommit={(v) => v && update((p) => ({ ...p, validityDays: Math.round(v) }))} /></div>
        <div className="inrow">
          <span>Deposit up front (%)</span>
          <span className="row nowrap">
            <NumberCell className="field num short" label="Deposit percent" value={project.depositPct ?? 0} min={0} onCommit={(v) => update((p) => ({ ...p, depositPct: Math.min(100, Math.max(0, v ?? 0)) }))} />
            {isAdmin && (project.depositPct ?? 0) > 0 && <span className="muted small">{usd(Math.round(priced.totals.grandTotal * (project.depositPct ?? 0)) / 100)} due at signing, the rest on completion</span>}
          </span>
        </div>
        <div className="inrow">
          <span>Status</span>
          <select aria-label="Status" value={status} onChange={(e) => {
            const s = e.target.value as typeof status;
            if (s === 'won' && isAdmin && !row.job_id) { setAcceptNow(true); return; }
            setStatus(s);
            void run(() => store.update('estimates', row.id, { status: s }), 'Status saved.');
          }}>
            {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <dl className="figs strip">
          <div><dt>{isAdmin ? 'Client price' : 'Cost (material + labor)'}</dt><dd>{usd(isAdmin ? priced.totals.grandTotal : priced.totals.material + priced.totals.labor)}</dd></div>
          {isAdmin && <div><dt>Profit</dt><dd>{usd(priced.totals.profit)}</dd></div>}
          <div><dt>Type</dt><dd>{project.kind === 'house' ? 'House estimate' : 'Custom quote'}</dd></div>
          <div><dt>Valid through</dt><dd>{through}</dd></div>
        </dl>
      </div>
      {isAdmin && <QuoteToInvoice row={row} project={project} priced={priced} onStatus={setStatus} acceptNow={acceptNow} onAcceptShown={() => setAcceptNow(false)} />}
      {priced.unverifiedCount > 0 && <div className="alert warn">{priced.unverifiedCount} line{priced.unverifiedCount === 1 ? '' : 's'} still use placeholder prices from the catalog. The PDF is stamped DRAFT until they are real.</div>}
      {!isAdmin && <div className="alert calm">You see costs only. Profit, markups, and the client price are for admins.</div>}

      <nav className="tabs" aria-label="Estimate sections">
        {([['lines', 'Line items'], ...(project.kind === 'house' ? [['house', 'House details']] : []), ['terms', 'Notes and terms'], ...(isAdmin ? [['versions', `Saved versions (${versions.length})`]] : [])] as [typeof tab, string][]).map(([k, l]) => (
          <a key={k} href="#" className={tab === k ? 'active' : ''} onClick={(e) => { e.preventDefault(); setTab(k); }}>{l}</a>
        ))}
      </nav>

      {tab === 'lines' && (
        <>
          <LineTable project={project} priced={priced} update={update} catalog={catalog} />
          {isAdmin && <MarkupsBox project={project} priced={priced} update={update} />}
        </>
      )}
      {tab === 'house' && <HouseInputs project={project} update={update} />}
      {tab === 'terms' && (
        <div className="stack">
          <label className="field">Notes on the quote<TextBlock label="Notes" rows={4} value={project.notes} onCommit={(v) => update((p) => ({ ...p, notes: v }))} /></label>
          <label className="field">Assumptions, exclusions, and conditions<TextBlock label="Assumptions" rows={12} value={project.assumptions} onCommit={(v) => update((p) => ({ ...p, assumptions: v }))} /></label>
        </div>
      )}
      {tab === 'versions' && isAdmin && (
        <div className="stack">
          <div className="row between">
            <p className="muted">A version freezes the quote, its prices, and its markups. Its PDF always shows that day's numbers.</p>
            <button className="btn primary" onClick={() => setSavingVersion(true)}>Save a version</button>
          </div>
          {versions.length === 0 ? <div className="empty">No saved versions yet. Save one before you send a quote.</div> : (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Saved</th><th>Label</th><th className="right">Total then</th><th /></tr></thead>
                <tbody>
                  {versions.map((v) => {
                    const then = priceProject(v.data.project, v.data.catalog, v.data.settings);
                    return (
                      <tr key={v.id}>
                        <td className="num small">{new Date(v.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                        <td>{v.label}</td>
                        <td className="right num">{usd(then.totals.grandTotal)}</td>
                        <td className="actions">
                          <button className="btn tiny" disabled={pdf.busy} onClick={() => pdf.download('client', v.data.project, v.data.catalog, v.data.settings, v.label)}>PDF</button>
                          <button className="btn tiny" onClick={() => restore(v)}>Restore</button>
                          <button className="btn tiny danger" onClick={() => { if (window.confirm(`Delete the version "${v.label}"?`)) void run(() => store.remove('estimate_versions', v.id), 'Version deleted.'); }}>Delete</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <p className="muted small">
          <button className="linkish danger" onClick={async () => {
            if (!window.confirm(`Delete the estimate for ${project.clientName || project.address || 'this client'}, with its saved versions? This cannot be undone.`)) return;
            if (await run(() => store.remove('estimates', row.id), 'Estimate deleted.')) nav('/estimates');
          }}>Delete this estimate</button>
        </p>
      )}

      {savingVersion && (
        <FormModal
          title="Save a version"
          submit="Save version"
          fields={[{ key: 'label', label: 'Label', required: true, help: 'For example: Sent to client, Revised after walkthrough.' }]}
          initial={{ label: `Version ${versions.length + 1}` }}
          onClose={() => setSavingVersion(false)}
          onSave={async (v) => { if (await saveVersion(v.label as string)) setSavingVersion(false); }}
        />
      )}
      {me.role === 'admin' && markupsRow === null && <div className="alert">This estimate has no markups saved. Reload the page; if this stays, the estimate needs repair.</div>}
    </div>
  );
}
