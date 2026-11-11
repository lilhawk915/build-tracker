import { useState } from 'react';
import { Link } from 'react-router-dom';
import { store, useData } from '../../data';
import { rowsToProject, type MarkupsRow } from '../../estimator/convert';
import { priceProject } from '../../estimator/domain/pricing/resolve';
import { planImport, type ImportPlan } from '../../estimator/importPlan';
import { useEstimating, usd } from '../../estimator/ui';

interface Checked { name: string; inFile: number; imported: number | null }

export function ImportPage() {
  const { data, run, say, reload } = useData();
  const { settings, catalog } = useEstimating();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [useSettings, setUseSettings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Checked[] | null>(null);

  const read = async (file: File) => {
    setChecked(null);
    try {
      const p = planImport(await file.text(), new Set(data.estimates.map((e) => e.legacy_id).filter((x): x is string => Boolean(x))),
        new Set(data.catalog_items.map((c) => c.id)), settings, () => crypto.randomUUID());
      setPlan(p);
      setFileName(file.name);
    } catch (e) {
      setPlan(null);
      say('err', `That file can't be imported: ${(e as Error).message}`);
    }
  };

  const go = async () => {
    if (!plan) return;
    setBusy(true);
    const todo = plan.estimates.filter((e) => !e.skipped);
    const ok = await run(async () => {
      if (plan.settings && useSettings) {
        const s = plan.settings;
        await store.update('company_settings', 'main', { name: s.company.name, address: s.company.address, phone: s.company.phone, email: s.company.email, license: s.company.license, logo_data_url: s.company.logoDataUrl, default_assumptions: s.defaultAssumptions, default_validity_days: s.defaultValidityDays } as never);
        await store.update('markup_defaults', 'main', { sales_tax_pct: s.salesTaxPct, contingency_pct: s.contingencyPct, overhead_pct: s.overheadPct, profit_pct: s.profitPct } as never);
      }
      if (plan.newCatalog.length) await store.insert('catalog_items', plan.newCatalog);
      for (const e of todo) {
        await store.insert('estimates', e.estimate as never);
        const { estimate_id: _, ...m } = e.markups;
        await store.update('estimate_markups', e.estimate.id, m as Partial<MarkupsRow>);
        if (e.versionRows.length) await store.insert('estimate_versions', e.versionRows as never);
      }
    }, `Imported ${todo.length} estimate${todo.length === 1 ? '' : 's'} and ${plan.newCatalog.length} catalog item${plan.newCatalog.length === 1 ? '' : 's'}.`);
    setBusy(false);
    if (!ok) return;
    setChecked(todo.map((e) => ({ name: e.name, inFile: e.totalInFile, imported: null })));
    await reload();
  };

  // After the import, price each estimate again from what is now saved, and compare with the file.
  const verify = checked?.map((c, i) => {
    const e = plan!.estimates.filter((x) => !x.skipped)[i];
    const row = data.estimates.find((r) => r.id === e.estimate.id);
    const m = data.estimate_markups.find((r) => r.estimate_id === e.estimate.id) ?? null;
    return { ...c, id: e.estimate.id, imported: row ? priceProject(rowsToProject(row, m), catalog, settings).totals.grandTotal : null };
  });

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <Link to="/estimates">← Estimates</Link>
      <h1>Import from Estimator</h1>
      <p className="muted">Pick the file you saved with <b>Export everything</b> (or one project's <b>Export JSON</b>). Nothing is saved until you press Import.</p>
      <label className="field">
        <span>Estimator file</span>
        <input type="file" accept=".json,application/json" aria-label="Estimator file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f); }} />
      </label>

      {plan && !verify && (
        <section className="panel stack" aria-label="What will be imported">
          <h3>{fileName}</h3>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Estimate</th><th>Type</th><th className="right">Lines</th><th className="right">Total in file</th><th>Will</th></tr></thead>
              <tbody>
                {plan.estimates.map((e) => (
                  <tr key={e.legacyId}>
                    <td><b>{e.name}</b>{e.versions > 0 && <div className="small muted">{e.versions} saved version{e.versions === 1 ? '' : 's'}</div>}{e.recordEntries > 0 && <div className="small chip warn">{e.recordEntries} job record entries are not brought over yet</div>}</td>
                    <td>{e.kind === 'house' ? 'House' : 'Custom'}</td>
                    <td className="right num">{e.lines}</td>
                    <td className="right num">{usd(e.totalInFile)}</td>
                    <td>{e.skipped ? <span className="chip">Already imported, skip</span> : <span className="chip good">Import</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>Price catalog: <b>{plan.newCatalog.length}</b> new item{plan.newCatalog.length === 1 ? '' : 's'}{plan.catalogAlready ? `, ${plan.catalogAlready} already here and left as they are` : ''}.</p>
          {plan.settings && (
            <label className="check">
              <input type="checkbox" checked={useSettings} onChange={(e) => setUseSettings(e.target.checked)} />
              Also use the file's quote settings: company "{plan.settings.company.name || '(blank)'}", sales tax {plan.settings.salesTaxPct}%, contingency {plan.settings.contingencyPct}%, overhead {plan.settings.overheadPct}%, profit {plan.settings.profitPct}%.
            </label>
          )}
          {plan.attachedFiles > 0 && <div className="alert warn">{plan.attachedFiles} attached files in this export are not brought over yet.</div>}
          <div className="row">
            <button className="btn primary" disabled={busy || plan.estimates.every((e) => e.skipped) && plan.newCatalog.length === 0} onClick={go}>{busy ? 'Importing…' : 'Import'}</button>
            <button className="btn" onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </section>
      )}

      {verify && (
        <section className="panel stack" aria-label="Import check">
          <h3>Checked after import</h3>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Estimate</th><th className="right">In the file</th><th className="right">Now saved here</th><th /></tr></thead>
              <tbody>
                {verify.map((v) => (
                  <tr key={v.id}>
                    <td><Link to={`/estimates/${v.id}`}><b>{v.name}</b></Link></td>
                    <td className="right num">{usd(v.inFile)}</td>
                    <td className="right num">{v.imported === null ? 'not found' : usd(v.imported)}</td>
                    <td>{v.imported !== null && Math.abs(v.imported - v.inFile) < 0.005 ? <span className="chip good">Matches</span> : <span className="flag">Check this one</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
