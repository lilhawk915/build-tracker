import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../catalog/seed';
import { defaultInputs, defaultSettings, newProject } from '../house/defaults';
import type { CatalogItem, CustomLine } from '../types';
import { computeTotals, editsForAmount, lineAmounts, roundCents, summarizeDivisions } from './pricing';
import { applyLineEdit, findItem, indexCatalog, marginPct, priceProject, resolveEstimate } from './resolve';
import { linesToCsv } from './exportCsv';

const pct = { salesTaxPct: 7.5, contingencyPct: 5, overheadPct: 10, profitPct: 10 };

describe('lineAmounts', () => {
  it('multiplies and rounds to cents', () => {
    expect(lineAmounts(3, 1.115, 2)).toEqual({ material: 3.35, labor: 6, total: 9.35 });
  });
  it('zero quantity is zero', () => {
    expect(lineAmounts(0, 99, 99).total).toBe(0);
  });
});

describe('computeTotals: stacked markups', () => {
  const t = computeTotals([{ material: 1000, labor: 500 }], pct, 1000);
  it('taxes materials only', () => {
    expect(t.tax).toBe(75);
    expect(t.subtotal).toBe(1575);
  });
  it('stacks contingency, then overhead, then profit', () => {
    expect(t.contingency).toBe(78.75); // 1575 x 5%
    expect(t.overhead).toBe(165.38); // 1653.75 x 10%
    expect(t.profit).toBe(181.91); // 1819.13 x 10%
    expect(t.grandTotal).toBe(2001.04);
  });
  it('cost per sq ft uses heated area', () => {
    expect(t.costPerSqft).toBe(2);
    expect(computeTotals([{ material: 1000, labor: 0 }], pct, 0).costPerSqft).toBe(0);
  });
  it('all zero percent means total equals direct cost', () => {
    const z = computeTotals([{ material: 10, labor: 5 }], { salesTaxPct: 0, contingencyPct: 0, overheadPct: 0, profitPct: 0 }, 1);
    expect(z.grandTotal).toBe(15);
  });
});

describe('summarizeDivisions', () => {
  const lines = [
    { division: 'Site' as const, material: 333.33, labor: 111.11 },
    { division: 'Site' as const, material: 10, labor: 0 },
    { division: 'Framing' as const, material: 1234.57, labor: 987.65 },
    { division: 'Paint' as const, material: 0.01, labor: 0.02 },
  ];
  it('client amounts add up to the grand total to the cent', () => {
    const t = computeTotals(lines, pct, 2000);
    const rows = summarizeDivisions(lines, pct, t.grandTotal);
    const sum = roundCents(rows.reduce((s, r) => s + r.clientAmount, 0));
    expect(sum).toBe(t.grandTotal);
  });
  it('holds across many sets of markups', () => {
    for (let n = 1; n < 60; n++) {
      const settings = { salesTaxPct: n % 9, contingencyPct: n % 7, overheadPct: n % 13, profitPct: n % 17 };
      const l = lines.map((x) => ({ ...x, material: roundCents(x.material * (1 + n / 37)) }));
      const t = computeTotals(l, settings, 1);
      const sum = roundCents(summarizeDivisions(l, settings, t.grandTotal).reduce((s, r) => s + r.clientAmount, 0));
      expect(sum).toBe(t.grandTotal);
    }
  });
  it('empty divisions get nothing', () => {
    const rows = summarizeDivisions(lines, pct, 5000);
    expect(rows.find((r) => r.division === 'HVAC')?.clientAmount).toBe(0);
    expect(rows).toHaveLength(16);
  });
  it('no lines does not divide by zero', () => {
    expect(summarizeDivisions([], pct, 0).every((r) => r.clientAmount === 0)).toBe(true);
  });
  it('direct cost is material + labor', () => {
    expect(summarizeDivisions(lines, pct, 1).find((r) => r.division === 'Site')?.direct).toBe(454.44);
  });
});

describe('resolveEstimate', () => {
  const catalog = seedCatalog();
  const inputs = defaultInputs();
  const get = (edits = {}, custom: CustomLine[] = [], cat: CatalogItem[] = catalog, i = inputs) => resolveEstimate(i, cat, edits, custom);
  const line = (r: ReturnType<typeof get>, key: string) => r.lines.find((l) => l.key === key)!;

  it('prices from the catalog at the finish grade', () => {
    const roof = line(get(), 'roof.covering');
    expect(roof.grade).toBe('mid');
    expect(roof.materialUnit).toBe(2.22);
    expect(roof.material).toBe(lineAmounts(2043, 2.22, 2.22).material);
    expect(roof.unverified).toBe(true);
  });

  it('grade override changes the price', () => {
    const roof = line(get({ 'roof.covering': { grade: 'premium' } }), 'roof.covering');
    expect(roof.materialUnit).toBe(3.33);
    expect(roof.edited.grade).toBe(true);
  });

  it('quantity edit survives an input change, and the formula stays', () => {
    const edits = { 'roof.covering': { qty: 2500 } };
    const a = line(get(edits), 'roof.covering');
    const b = line(get(edits, [], catalog, { ...inputs, heatedSqft: 3000 }), 'roof.covering');
    expect(a.qty).toBe(2500);
    expect(b.qty).toBe(2500);
    expect(a.edited.qty).toBe(true);
    expect(a.formula).toBeTruthy();
  });

  it('unedited quantities follow the inputs', () => {
    expect(line(get({}, [], catalog, { ...inputs, heatedSqft: 3000 }), 'hvac.ductwork').qty).toBe(3000);
  });

  it('edits follow a line when the material changes', () => {
    const r = get({ 'roof.covering': { qty: 2500 } }, [], catalog, { ...inputs, roofMaterial: 'metal' });
    expect(line(r, 'roof.covering').qty).toBe(2500);
    expect(line(r, 'roof.covering').name).toBe('Metal roofing');
  });

  it('price overrides clear the unverified flag only when both are overridden', () => {
    const partial = line(get({ 'roof.covering': { materialUnit: 5 } }), 'roof.covering');
    expect(partial.unverified).toBe(true);
    const both = line(get({ 'roof.covering': { materialUnit: 5, laborUnit: 1 } }), 'roof.covering');
    expect(both.unverified).toBe(false);
    expect(both.total).toBe(lineAmounts(2043, 5, 1).total);
  });

  it('verified catalog prices clear the flag', () => {
    const cat = catalog.map((c) => ({ ...c, verified: true }));
    expect(line(get({}, [], cat), 'roof.covering').unverified).toBe(false);
  });

  it('deleted lines move to removed and can be restored', () => {
    const edits = { 'roof.gutters': { deleted: true } };
    const r = get(edits);
    expect(r.lines.some((l) => l.key === 'roof.gutters')).toBe(false);
    expect(r.removed.map((l) => l.key)).toEqual(['roof.gutters']);
    expect(applyLineEdit(edits, 'roof.gutters', { deleted: undefined })).toEqual({});
  });

  it('zero-quantity lines are hidden unless you typed the zero', () => {
    const noBays = { ...inputs, garageBays: 0 };
    expect(get({}, [], catalog, noBays).lines.some((l) => l.key === 'openings.garage_door')).toBe(false);
    expect(line(get({ 'roof.gutters': { qty: 0 } }), 'roof.gutters').total).toBe(0);
  });

  it('a deleted catalog item warns and prices at zero instead of crashing', () => {
    const cat = catalog.filter((c) => !c.id.startsWith('roof.shingle'));
    const roof = line(get({}, [], cat), 'roof.covering');
    expect(roof.total).toBe(0);
    expect(roof.warnings[0]).toContain('missing');
  });

  it('warns when the catalog unit no longer matches the calculated quantity', () => {
    const cat = catalog.map((c) => (c.id === 'roof.shingle.mid' ? { ...c, unit: 'box' as const } : c));
    expect(line(get({}, [], cat), 'roof.covering').warnings[0]).toContain('per box');
  });

  it('swapping the catalog item changes the price and name', () => {
    const roof = line(get({ 'roof.covering': { catalogItemId: 'roof.metal.premium' } }), 'roof.covering');
    expect(roof.name).toBe('Metal roofing');
    expect(roof.materialUnit).toBe(3.33);
    expect(roof.edited.catalogItem).toBe(true);
  });

  it('custom lines: free text and catalog-linked', () => {
    const custom: CustomLine[] = [
      { key: 'c1', division: 'Site', name: 'Tree removal', unit: 'each', qty: 2, catalogItemId: null },
      { key: 'c2', division: 'Roofing', name: 'Extra gutters', unit: 'LF', qty: 10, catalogItemId: 'roof.gutters' },
    ];
    const r = get({ c1: { materialUnit: 400 } }, custom);
    expect(line(r, 'c1').total).toBe(800);
    expect(line(r, 'c1').unverified).toBe(false);
    expect(line(r, 'c2').total).toBe(222.2);
    expect(line(r, 'c2').unverified).toBe(true);
    expect(line(r, 'c2').name).toBe('Extra gutters');
  });

  it('lines come back in division order', () => {
    const custom: CustomLine[] = [{ key: 'c1', division: 'Site', name: 'X', unit: 'each', qty: 1, catalogItemId: null }];
    const r = get({}, custom);
    expect(r.lines[0].division).toBe('Site');
    expect(r.lines[r.lines.length - 1].division).toBe('Cleanup/Misc');
    const siteIndexes = r.lines.flatMap((l, n) => (l.division === 'Site' ? [n] : []));
    expect(siteIndexes[siteIndexes.length - 1]).toBe(siteIndexes.length - 1);
  });
});

describe('findItem', () => {
  const idx = indexCatalog([
    { id: 'x.builder', division: 'Site', name: 'X', unit: 'each', unitCost: 1, laborCost: 0, grade: 'builder', notes: '', verified: true },
    { id: 'x.premium', division: 'Site', name: 'X', unit: 'each', unitCost: 3, laborCost: 0, grade: 'premium', notes: '', verified: true },
    { id: 'y', division: 'Site', name: 'Y', unit: 'each', unitCost: 9, laborCost: 0, grade: 'builder', notes: '', verified: true },
  ]);
  it('finds the exact grade', () => {
    expect(findItem(idx, 'x', 'premium')?.unitCost).toBe(3);
  });
  it('falls back to a grade that exists', () => {
    expect(findItem(idx, 'y', 'premium')?.unitCost).toBe(9);
    expect(findItem(idx, 'x', 'mid')).toBeDefined();
  });
  it('unknown family is undefined', () => {
    expect(findItem(idx, 'nope', 'mid')).toBeUndefined();
  });
});

describe('applyLineEdit', () => {
  it('sets and clears', () => {
    const a = applyLineEdit({}, 'k', { qty: 5 });
    expect(a).toEqual({ k: { qty: 5 } });
    expect(applyLineEdit(a, 'k', { qty: undefined })).toEqual({});
  });
  it('does not change the original object', () => {
    const a = { k: { qty: 5 } };
    applyLineEdit(a, 'k', { name: 'n' });
    expect(a).toEqual({ k: { qty: 5 } });
  });
});

describe('priceProject and CSV', () => {
  const settings = { ...defaultSettings(), ...pct };
  const priced = priceProject(newProject('p', settings, 'now', 'house'), seedCatalog(), settings);

  it('every seed-priced line counts as unverified', () => {
    expect(priced.unverifiedCount).toBe(priced.lines.length);
  });
  it('division amounts add to the grand total', () => {
    const sum = roundCents(priced.divisions.reduce((s, d) => s + d.clientAmount, 0));
    expect(sum).toBe(priced.totals.grandTotal);
  });
  it('CSV includes lines, flags and totals', () => {
    const csv = linesToCsv(priced.lines, priced.totals);
    expect(csv).toContain('Shingle roofing');
    expect(csv).toContain('UNVERIFIED');
    expect(csv).toContain('Grand total');
    expect(csv.split('\r\n')).toHaveLength(priced.lines.length + 10);
  });
});

describe('custom quotes', () => {
  const settings = defaultSettings();
  const base = newProject('c', settings, 'now');
  const project = {
    ...base,
    customLines: [
      { key: 'a', division: 'Foundation' as const, name: "35' x 25' pad", unit: 'sqft' as const, qty: 875, catalogItemId: null },
      { key: 'b', division: 'Foundation' as const, name: 'Concrete, lump sum', unit: 'lump sum' as const, qty: 1, catalogItemId: null },
    ],
    lineEdits: { b: { laborUnit: 9800 } },
  };
  it('new projects are custom by default', () => {
    expect(base.kind).toBe('custom');
  });
  it('only the lines you added, no house lines', () => {
    const priced = priceProject(project, seedCatalog(), settings);
    expect(priced.lines.map((l) => l.key)).toEqual(['a', 'b']);
    expect(priced.removed).toEqual([]);
    expect(priced.totals.grandTotal).toBe(9800);
    expect(priced.unverifiedCount).toBe(0);
  });
  it('no cost per sq ft on a custom quote', () => {
    expect(priceProject(project, seedCatalog(), settings).totals.costPerSqft).toBe(0);
  });
  it('a blank custom quote totals zero', () => {
    expect(priceProject(base, seedCatalog(), settings).totals.grandTotal).toBe(0);
  });
  it('house projects still generate lines', () => {
    expect(priceProject({ ...base, kind: 'house' }, seedCatalog(), settings).lines.length).toBeGreaterThan(40);
  });
});

describe('markups on each quote', () => {
  const settings = { ...defaultSettings(), profitPct: 10 };
  const line = { key: 'a', division: 'Site' as const, name: 'Job', unit: 'lump sum' as const, qty: 1, catalogItemId: null };
  const base = { ...newProject('m', settings, 'now'), customLines: [line], lineEdits: { a: { materialUnit: 0, laborUnit: 10000 } } };

  it('a new quote copies the default markups from Settings', () => {
    expect(base.markups?.profitPct).toBe(10);
  });
  it('each quote prices with its own profit, not Settings', () => {
    const p = { ...base, markups: { ...base.markups!, profitPct: 25 } };
    expect(priceProject(p, [], settings).totals.grandTotal).toBe(12500);
    expect(priceProject(p, [], { ...settings, profitPct: 99 }).totals.grandTotal).toBe(12500);
  });
  it('a dollar profit replaces the percent', () => {
    const p = { ...base, markups: { ...base.markups!, profitPct: 25, profitAmount: 1800 } };
    const t = priceProject(p, [], settings).totals;
    expect(t.profit).toBe(1800);
    expect(t.grandTotal).toBe(11800);
  });
  it('dollar profit still adds up across divisions', () => {
    const p = { ...base, markups: { salesTaxPct: 7.25, contingencyPct: 3, overheadPct: 8, profitPct: 0, profitAmount: 1234.57 } };
    const priced = priceProject(p, [], settings);
    expect(roundCents(priced.divisions.reduce((s, d) => s + d.clientAmount, 0))).toBe(priced.totals.grandTotal);
  });
  it('an older project without its own markups uses the settings it is priced with', () => {
    const { markups: _drop, ...old } = base;
    expect(priceProject(old, [], { ...settings, profitPct: 20 }).totals.grandTotal).toBe(12000);
  });
  it('margin is profit over the total', () => {
    expect(marginPct(1000, 11000)).toBeCloseTo(9.09, 2);
    expect(marginPct(1, 0)).toBe(0);
  });
});

describe('editsForAmount: typing a dollar amount', () => {
  const totalOf = (qty: number, e: { qty?: number; materialUnit?: number; laborUnit?: number }, m = 0, l = 0) =>
    lineAmounts(e.qty ?? qty, e.materialUnit ?? m, e.laborUnit ?? l);

  it('material total works back to a unit price, to the cent', () => {
    const e = editsForAmount({ qty: 875, material: 0, labor: 0 }, 'material', 2000);
    expect(totalOf(875, e).material).toBe(2000);
  });
  it('labor total too, with awkward quantities', () => {
    for (const qty of [3, 7, 875, 1234.5]) {
      const e = editsForAmount({ qty, material: 0, labor: 0 }, 'labor', 9800);
      expect(totalOf(qty, e).labor, String(qty)).toBe(9800);
    }
  });
  it('total keeps the material/labor split', () => {
    const e = editsForAmount({ qty: 10, material: 300, labor: 700 }, 'total', 2000);
    const a = totalOf(10, e);
    expect(a.material).toBe(600);
    expect(a.labor).toBe(1400);
    expect(a.total).toBe(2000);
  });
  it('total on an empty line goes to labor', () => {
    const a = totalOf(1, editsForAmount({ qty: 1, material: 0, labor: 0 }, 'total', 9800));
    expect(a).toEqual({ material: 0, labor: 9800, total: 9800 });
  });
  it('odd cents still add up', () => {
    for (const amount of [0.01, 100.01, 9999.99, 12345.67]) {
      const e = editsForAmount({ qty: 3, material: 1, labor: 2 }, 'total', amount);
      expect(totalOf(3, e).total, String(amount)).toBe(amount);
    }
  });
  it('zero quantity becomes 1', () => {
    const e = editsForAmount({ qty: 0, material: 0, labor: 0 }, 'labor', 500);
    expect(e.qty).toBe(1);
    expect(totalOf(0, e).labor).toBe(500);
  });
});

describe('moving a line to another division', () => {
  it('division edit moves the line and its money', () => {
    const settings = defaultSettings();
    const p = {
      ...newProject('d', settings, 'now'),
      customLines: [{ key: 'a', division: 'Site' as const, name: 'X', unit: 'each' as const, qty: 1, catalogItemId: null }],
      lineEdits: { a: { laborUnit: 100, division: 'Paint' as const } },
    };
    const priced = priceProject(p, [], settings);
    expect(priced.lines[0].division).toBe('Paint');
    expect(priced.lines[0].edited.division).toBe(true);
    expect(priced.divisions.find((d) => d.division === 'Paint')?.direct).toBe(100);
  });
});

describe('change marking', () => {
  it('a free-text line you typed is never marked as changed', () => {
    const r = resolveEstimate(defaultInputs(), seedCatalog(), { c: { name: 'Pad', unit: 'lump sum', laborUnit: 750 } }, [
      { key: 'c', division: 'Site', name: 'Custom line', unit: 'each', qty: 1, catalogItemId: null },
    ]);
    const c = r.lines.find((l) => l.key === 'c')!;
    expect(c.name).toBe('Pad');
    expect(c.total).toBe(750);
    expect(Object.entries(c.edited).filter(([, v]) => v)).toEqual([]);
  });
  it('a catalog-linked custom line still shows its price change', () => {
    const r = resolveEstimate(defaultInputs(), seedCatalog(), { c: { laborUnit: 5 } }, [
      { key: 'c', division: 'Roofing', name: 'Gutters', unit: 'LF', qty: 1, catalogItemId: 'roof.gutters' },
    ]);
    expect(r.lines.find((l) => l.key === 'c')!.edited.laborUnit).toBe(true);
  });
});
