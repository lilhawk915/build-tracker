import { NumberCell, TextBlock, TextCell, qtyText, usd } from '../../estimator/ui';
import { editsForAmount, type AmountField } from '../../estimator/domain/pricing/pricing';
import { applyLineEdit, familyOf, type PricedProject } from '../../estimator/domain/pricing/resolve';
import { DIVISIONS, GRADES, UNITS, type CatalogItem, type Division, type Grade, type LineEdit, type LineTag, type Project, type ResolvedLine, type Unit } from '../../estimator/domain/types';

type Update = (change: (p: Project) => Project) => void;

function Reset({ onClick, label }: { onClick: () => void; label: string }) {
  return <button className="reset" aria-label={label} title={label} onClick={onClick}>↺</button>;
}

function LineRow({ line, update, catalog }: { line: ResolvedLine; update: Update; catalog: CatalogItem[] }) {
  const edit = (patch: { [K in keyof LineEdit]: LineEdit[K] | undefined }) =>
    update((p) => ({ ...p, lineEdits: applyLineEdit(p.lineEdits, line.key, patch) }));
  const custom = line.source === 'custom';
  const setCustom = (patch: Partial<Project['customLines'][number]>) =>
    update((p) => ({ ...p, customLines: p.customLines.map((c) => (c.key === line.key ? { ...c, ...patch } : c)) }));

  const remove = () => {
    if (custom) {
      update((p) => {
        const lineEdits = { ...p.lineEdits };
        delete lineEdits[line.key];
        return { ...p, lineEdits, customLines: p.customLines.filter((c) => c.key !== line.key) };
      });
    } else edit({ deleted: true });
  };
  const setQty = (qty: number) => (custom ? setCustom({ qty }) : edit({ qty }));
  // Typing a dollar amount works out the unit price, and sets quantity 1 if it was 0.
  const setAmount = (field: AmountField, amount: number) => {
    const { qty, ...prices } = editsForAmount(line, field, amount);
    update((p) => {
      let lineEdits = applyLineEdit(p.lineEdits, line.key, prices);
      let customLines = p.customLines;
      if (qty !== undefined) {
        if (custom) customLines = customLines.map((c) => (c.key === line.key ? { ...c, qty } : c));
        else lineEdits = applyLineEdit(lineEdits, line.key, { qty });
      }
      return { ...p, lineEdits, customLines };
    });
  };
  const moveTo = (division: Division) => (custom ? setCustom({ division }) : edit({ division }));
  const swaps = new Map(catalog.filter((c) => c.division === line.division && familyOf(c.id) !== familyOf(line.catalogItemId ?? '')).map((c) => [familyOf(c.id), c]));

  return (
    <tr className={line.tag === 'not_included' ? 'notincluded' : ''}>
      <td>
        <div className="row nowrap" style={{ gap: 4 }}>
          <TextCell label={`Name of ${line.name}`} value={line.name} edited={line.edited.name} onCommit={(name) => edit({ name: name.trim() || undefined })} />
          {line.edited.name && <Reset label="Back to catalog name" onClick={() => edit({ name: undefined })} />}
          {line.unverified && <span className="chip warn" title="Placeholder price, not real">unverified</span>}
          {custom && <span className="chip">custom</span>}
          {line.warnings.map((w) => <span key={w} className="flag" title={w}>!</span>)}
        </div>
        {custom && (
          <span className="linedesc"><TextBlock label={`Description of ${line.name}`} rows={line.description ? Math.min(8, line.description.split('\n').length + 1) : 1} value={line.description ?? ''} onCommit={(description) => setCustom({ description })} placeholder="+ Description for the client" /></span>
        )}
        {custom && (
          <span className="row nowrap linetag">
            <select aria-label={`How ${line.name} shows on the quote`} value={line.tag ?? ''} onChange={(e) => setCustom({ tag: (e.target.value || undefined) as LineTag | undefined, ...(e.target.value === 'not_included' ? {} : { clientPrice: null }) })}>
              <option value="">Counts in the total</option>
              <option value="optional">Optional (counts, tagged "Optional")</option>
              <option value="not_included">Not included (shown, not counted)</option>
            </select>
            {line.tag === 'not_included' && (
              <label className="row nowrap small">Client price $
                <NumberCell label={`Client price of ${line.name}`} value={line.clientPrice ?? null} nullable placeholder="optional" decimals={2} onCommit={(v) => setCustom({ clientPrice: v })} />
              </label>
            )}
          </span>
        )}
      </td>
      <td>
        {line.hasGrades ? (
          <span className="row nowrap" style={{ gap: 2 }}>
            <select className={`cell${line.edited.grade ? ' edited' : ''}`} aria-label={`Grade of ${line.name}`} value={line.grade} onChange={(e) => edit({ grade: e.target.value as Grade })}>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            {line.edited.grade && <Reset label="Back to finish level" onClick={() => edit({ grade: undefined })} />}
          </span>
        ) : <span className="muted">–</span>}
      </td>
      <td>
        <span className="row nowrap" style={{ gap: 2 }}>
          {line.formula && <span className="formula" title={line.formula} aria-label={`How ${line.name} is worked out: ${line.formula}`}>ƒ</span>}
          <NumberCell label={`Quantity of ${line.name}`} value={line.qty} edited={line.edited.qty} onCommit={(v) => v !== null && setQty(v)} />
          {line.edited.qty && <Reset label="Back to calculated quantity" onClick={() => edit({ qty: undefined })} />}
        </span>
      </td>
      <td>
        <span className="row nowrap" style={{ gap: 2 }}>
          <select className={`cell${line.edited.unit ? ' edited' : ''}`} style={{ minWidth: 92 }} aria-label={`Unit of ${line.name}`} value={line.unit} onChange={(e) => (custom ? setCustom({ unit: e.target.value as Unit }) : edit({ unit: e.target.value as Unit }))}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          {line.edited.unit && <Reset label="Back to original unit" onClick={() => edit({ unit: undefined })} />}
        </span>
      </td>
      <td>
        <span className="row nowrap" style={{ gap: 2 }}>
          <NumberCell label={`Material per unit of ${line.name}`} value={line.materialUnit} decimals={2} edited={line.edited.materialUnit} onCommit={(v) => v !== null && edit({ materialUnit: v })} />
          {line.edited.materialUnit && <Reset label="Back to catalog price" onClick={() => edit({ materialUnit: undefined })} />}
        </span>
      </td>
      <td>
        <span className="row nowrap" style={{ gap: 2 }}>
          <NumberCell label={`Labor per unit of ${line.name}`} value={line.laborUnit} decimals={2} edited={line.edited.laborUnit} onCommit={(v) => v !== null && edit({ laborUnit: v })} />
          {line.edited.laborUnit && <Reset label="Back to catalog price" onClick={() => edit({ laborUnit: undefined })} />}
        </span>
      </td>
      <td><NumberCell label={`Material total of ${line.name}`} value={line.material} decimals={2} onCommit={(v) => v !== null && setAmount('material', v)} /></td>
      <td><NumberCell label={`Labor total of ${line.name}`} value={line.labor} decimals={2} onCommit={(v) => v !== null && setAmount('labor', v)} /></td>
      <td><NumberCell label={`Total of ${line.name}`} value={line.total} decimals={2} className="cell num strong" onCommit={(v) => v !== null && setAmount('total', v)} /></td>
      <td className="actions">
        {swaps.size > 0 && (
          <select className="iconsel" aria-label={`Swap catalog item for ${line.name}`} title="Swap to another catalog item" value="" onChange={(e) => e.target.value && edit({ catalogItemId: e.target.value, grade: undefined, name: undefined })}>
            <option value="">⇄</option>
            {[...swaps.values()].map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {line.edited.catalogItem && <Reset label="Back to original catalog item" onClick={() => edit({ catalogItemId: undefined, grade: undefined })} />}
        <select className="iconsel" aria-label={`Move ${line.name} to another division`} title="Move to another division" value="" onChange={(e) => e.target.value && moveTo(e.target.value as Division)}>
          <option value="">⇅</option>
          {DIVISIONS.filter((d) => d !== line.division).map((d) => <option key={d} value={d}>Move to {d}</option>)}
        </select>
        {line.edited.division && <Reset label="Back to original division" onClick={() => edit({ division: undefined })} />}
        <button className="linkish danger" aria-label={`Delete ${line.name}`} title="Delete line" onClick={remove}>×</button>
      </td>
    </tr>
  );
}

const newLine = (division: Division, item?: CatalogItem) => ({
  key: `custom.${crypto.randomUUID()}`, division, name: item?.name ?? 'Custom line', unit: (item?.unit ?? 'each') as Unit, qty: 1, catalogItemId: item?.id ?? null,
});

export function LineTable({ project, priced, update, catalog }: { project: Project; priced: PricedProject; update: Update; catalog: CatalogItem[] }) {
  // A custom quote shows only the divisions you've used.
  const shown = project.kind === 'custom' ? DIVISIONS.filter((d) => priced.lines.some((l) => l.division === d)) : DIVISIONS;
  return (
    <div className="stack">
      {project.kind === 'custom' && (
        <div className="row">
          <select aria-label="Add a line" style={{ maxWidth: 300 }} value="" onChange={(e) => e.target.value && update((p) => ({ ...p, customLines: [...p.customLines, newLine(e.target.value as Division)] }))}>
            <option value="">+ Add a line to a division…</option>
            {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {priced.lines.length === 0 && <span className="muted">This quote is empty. Pick a division to add your first line.</span>}
        </div>
      )}
      <div className="tablewrap">
        <table className="lines">
          <thead>
            <tr><th>Item</th><th>Grade</th><th className="right">Qty</th><th>Unit</th><th className="right">Mat/unit</th><th className="right">Labor/unit</th><th className="right">Material</th><th className="right">Labor</th><th className="right">Total</th><th /></tr>
          </thead>
          {shown.map((division) => {
            const lines = priced.lines.filter((l) => l.division === division);
            const sum = priced.divisions.find((d) => d.division === division);
            const options = catalog.filter((c) => c.division === division);
            return (
              <tbody key={division}>
                <tr className="division">
                  <td colSpan={6}>
                    <span className="row nowrap">
                      <b>{division}</b>
                      <select className="cell" style={{ width: 120 }} aria-label={`Add line to ${division}`} value="" onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        update((p) => ({ ...p, customLines: [...p.customLines, newLine(division, catalog.find((c) => c.id === v))] }));
                      }}>
                        <option value="">+ Add line</option>
                        <option value="__blank">Blank custom line</option>
                        {options.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.grade})</option>)}
                      </select>
                    </span>
                  </td>
                  <td className="right num">{usd(sum?.material ?? 0)}</td>
                  <td className="right num">{usd(sum?.labor ?? 0)}</td>
                  <td className="right num">{usd(sum?.direct ?? 0)}</td>
                  <td />
                </tr>
                {lines.map((line) => <LineRow key={line.key} line={line} update={update} catalog={catalog} />)}
              </tbody>
            );
          })}
        </table>
      </div>
      {priced.removed.length > 0 && (
        <div className="panel">
          <b>Removed lines ({priced.removed.length})</b>
          {priced.removed.map((l) => (
            <div key={l.key} className="row" style={{ marginTop: 6 }}>
              <span className="muted">{l.division}: {l.name}</span>
              <button className="btn tiny" onClick={() => update((p) => ({ ...p, lineEdits: applyLineEdit(p.lineEdits, l.key, { deleted: undefined }) }))}>Restore</button>
            </div>
          ))}
        </div>
      )}
      <p className="muted small">
        Amber boxes are your changes; ↺ puts the calculated value back. Hover ƒ to see how a quantity is worked out.
        Typing a dollar total works out the unit price for you. {qtyText(priced.lines.length)} lines.
      </p>
    </div>
  );
}
