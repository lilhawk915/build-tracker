import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, FormModal } from '../../components/ui';
import { store, useData } from '../../data';
import { catalogToRow } from '../../estimator/convert';
import { catalogToCsv, importCatalogCsv } from '../../estimator/domain/catalog/csv';
import { seedCatalog } from '../../estimator/domain/catalog/seed';
import { DIVISIONS, GRADES, UNITS, type CatalogItem } from '../../estimator/domain/types';
import { NumberCell, TextCell, downloadFile, useEstimating } from '../../estimator/ui';

export function CatalogPage() {
  const { data, run, say } = useData();
  const { catalog } = useEstimating();
  const [q, setQ] = useState('');
  const [division, setDivision] = useState('');
  const [unverifiedOnly, setUnverifiedOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = useMemo(() => catalog
    .filter((c) => (!division || c.division === division) && (!unverifiedOnly || !c.verified) && words.every((w) => `${c.id} ${c.name} ${c.notes}`.toLowerCase().includes(w)))
    .sort((a, b) => DIVISIONS.indexOf(a.division) - DIVISIONS.indexOf(b.division) || a.name.localeCompare(b.name)), [catalog, division, unverifiedOnly, q]);
  const unverified = catalog.filter((c) => !c.verified).length;

  // Typing a price is you confirming it, so it becomes verified.
  const save = (item: CatalogItem, patch: Partial<CatalogItem>) => run(
    () => store.update('catalog_items', item.id, catalogToRow({ ...item, ...patch })),
  );

  const importFile = async (file: File) => {
    const result = importCatalogCsv(await file.text(), catalog);
    if (result.errors.length) {
      say('err', `Nothing was imported. ${result.errors.slice(0, 3).join(' ')}`);
      return;
    }
    const existing = new Set(data.catalog_items.map((c) => c.id));
    await run(async () => {
      for (const item of result.items) {
        const before = catalog.find((c) => c.id === item.id);
        if (before && JSON.stringify(before) === JSON.stringify(item)) continue;
        if (existing.has(item.id)) await store.update('catalog_items', item.id, catalogToRow(item));
        else await store.insert('catalog_items', catalogToRow(item));
      }
    }, `Imported: ${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged.`);
  };

  return (
    <div className="stack">
      <Link to="/estimates">← Estimates</Link>
      <div className="row between">
        <h1>Price catalog</h1>
        <div className="row">
          <button className="btn" onClick={() => downloadFile('catalog.csv', new Blob([catalogToCsv(catalog)], { type: 'text/csv' }))}>Export CSV</button>
          <button className="btn" onClick={() => fileInput.current?.click()}>Import CSV</button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
          <button className="btn primary" onClick={() => setAdding(true)}>Add an item</button>
        </div>
      </div>
      {catalog.length === 0 && (
        <div className="alert warn row between">
          <span>The catalog is empty, so house estimates price at $0. Load the starter catalog of placeholder prices, then type your real prices over them.</span>
          <button className="btn" onClick={() => run(() => store.insert('catalog_items', seedCatalog().map(catalogToRow)), 'Starter catalog loaded. Every price is a placeholder until you change it.')}>Load starter catalog</button>
        </div>
      )}
      {unverified > 0 && <div className="alert warn">{unverified} of {catalog.length} prices are placeholders, not real. Type a real price, or tick Verified if the price is right.</div>}
      <div className="filters">
        <label className="field"><span>Search</span><input type="search" aria-label="Search the catalog" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="field"><span>Division</span>
          <select value={division} onChange={(e) => setDivision(e.target.value)}>
            <option value="">Every division</option>
            {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={unverifiedOnly} onChange={(e) => setUnverifiedOnly(e.target.checked)} />Placeholder prices only</label>
      </div>
      {rows.length === 0 ? <Empty>No catalog items match.</Empty> : (
        <div className="tablewrap">
          <table className="lines">
            <thead><tr><th>Division</th><th>Item</th><th>Grade</th><th>Unit</th><th className="right">Material/unit</th><th className="right">Labor/unit</th><th>Verified</th><th /></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="small">{c.division}</td>
                  <td><TextCell label={`Name of ${c.id}`} value={c.name} onCommit={(name) => name.trim() && save(c, { name: name.trim() })} /><div className="muted small">{c.id}</div></td>
                  <td className="small">{c.grade}</td>
                  <td>
                    <select className="cell" aria-label={`Unit of ${c.name}`} value={c.unit} onChange={(e) => save(c, { unit: e.target.value as CatalogItem['unit'] })}>
                      {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td><NumberCell label={`Material price of ${c.name}`} value={c.unitCost} decimals={2} edited={!c.verified} onCommit={(v) => v !== null && save(c, { unitCost: v, verified: true })} /></td>
                  <td><NumberCell label={`Labor price of ${c.name}`} value={c.laborCost} decimals={2} edited={!c.verified} onCommit={(v) => v !== null && save(c, { laborCost: v, verified: true })} /></td>
                  <td><input type="checkbox" aria-label={`${c.name} price is verified`} checked={c.verified} onChange={(e) => save(c, { verified: e.target.checked })} /></td>
                  <td className="actions">
                    <button className="linkish danger" aria-label={`Delete ${c.name}`} onClick={() => {
                      if (window.confirm(`Delete ${c.name}? Estimate lines that use it will show a warning and price at $0.`)) void run(() => store.remove('catalog_items', c.id), 'Item deleted.');
                    }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Amber prices are placeholders. Estimates find an item by its id, like roof.shingle.mid, so keep ids the same if you want lines to keep using them.</p>
      {adding && (
        <FormModal
          title="Add a catalog item"
          submit="Add item"
          fields={[
            { key: 'division', label: 'Division', type: 'select', options: DIVISIONS.map((d) => ({ value: d, label: d })) },
            { key: 'name', label: 'Name', required: true },
            { key: 'id', label: 'Id', required: true, help: 'Lowercase, like site.gravel or roof.shingle.premium. Must be new.' },
            { key: 'unit', label: 'Unit', type: 'select', options: UNITS.map((u) => ({ value: u, label: u })) },
            { key: 'grade', label: 'Grade', type: 'select', options: GRADES.map((g) => ({ value: g, label: g })) },
            { key: 'unitCost', label: 'Material per unit', type: 'number' },
            { key: 'laborCost', label: 'Labor per unit', type: 'number' },
          ]}
          initial={{ division: DIVISIONS[0], unit: 'each', grade: 'mid' }}
          onClose={() => setAdding(false)}
          onSave={async (v) => {
            const id = String(v.id).trim().toLowerCase();
            if (!/^[a-z0-9_.-]+$/.test(id)) throw new Error('Id: use lowercase letters, numbers, dots, dashes, or underscores.');
            if (catalog.some((c) => c.id === id)) throw new Error(`Id: ${id} is already used.`);
            const item: CatalogItem = { id, division: v.division as CatalogItem['division'], name: String(v.name).trim(), unit: v.unit as CatalogItem['unit'], grade: v.grade as CatalogItem['grade'], unitCost: (v.unitCost as number) ?? 0, laborCost: (v.laborCost as number) ?? 0, notes: '', verified: true };
            if (await run(() => store.insert('catalog_items', catalogToRow(item)), 'Item added.')) setAdding(false);
          }}
        />
      )}
    </div>
  );
}
