import { generateLines } from '../house/generate';
import {
  DIVISIONS,
  GRADES,
  type CatalogItem,
  type CustomLine,
  type GeneratedLine,
  type Grade,
  type HouseInputs,
  type LineEdit,
  type Markups,
  type Project,
  type ResolvedLine,
  type Settings,
} from '../types';
import { computeTotals, lineAmounts, summarizeDivisions } from './pricing';

export const familyOf = (id: string): string => id.replace(/\.(builder|mid|premium)$/, '');

interface CatalogIndex {
  byId: Map<string, CatalogItem>;
  byFamily: Map<string, CatalogItem[]>;
}

export function indexCatalog(catalog: CatalogItem[]): CatalogIndex {
  const byId = new Map(catalog.map((i) => [i.id, i]));
  const byFamily = new Map<string, CatalogItem[]>();
  for (const item of catalog) {
    const family = familyOf(item.id);
    byFamily.set(family, [...(byFamily.get(family) ?? []), item]);
  }
  return { byId, byFamily };
}

/** Exact grade if the catalog has it, otherwise the nearest grade that exists. */
export function findItem(idx: CatalogIndex, family: string, grade: Grade): CatalogItem | undefined {
  const variants = idx.byFamily.get(family);
  if (!variants?.length) return undefined;
  const exact = variants.find((v) => v.grade === grade);
  if (exact) return exact;
  const want = GRADES.indexOf(grade);
  return [...variants].sort(
    (a, b) => Math.abs(GRADES.indexOf(a.grade) - want) - Math.abs(GRADES.indexOf(b.grade) - want),
  )[0];
}

function resolveOne(
  base: Omit<GeneratedLine, 'family'> & { family: string | null; source: 'auto' | 'custom' },
  edit: LineEdit,
  idx: CatalogIndex,
): ResolvedLine {
  const family = edit.catalogItemId ? familyOf(edit.catalogItemId) : base.family;
  let item: CatalogItem | undefined;
  if (edit.catalogItemId && !edit.grade) item = idx.byId.get(edit.catalogItemId);
  else if (family) item = findItem(idx, family, edit.grade ?? base.grade);

  const warnings: string[] = [];
  if (family && !item) warnings.push('Catalog item is missing, so this line is priced at $0.');
  const unit = edit.unit ?? (base.source === 'custom' ? base.unit : item?.unit ?? base.unit);
  if (base.source === 'auto' && item && item.unit !== base.unit && edit.qty === undefined) {
    warnings.push(`Quantity is in ${base.unit}, but the catalog item is priced per ${item.unit}. Check the quantity.`);
  }

  const tracked = base.source === 'auto' || family !== null;
  const qty = edit.qty ?? base.qty;
  const materialUnit = edit.materialUnit ?? base.materialUnit ?? item?.unitCost ?? 0;
  const laborUnit = edit.laborUnit ?? base.laborUnit ?? item?.laborCost ?? 0;
  const materialFromCatalog = edit.materialUnit === undefined && base.materialUnit === undefined;
  const laborFromCatalog = edit.laborUnit === undefined && base.laborUnit === undefined;
  const unverified =
    !!item && !item.verified && (materialFromCatalog || (laborFromCatalog && item.laborCost !== 0));

  const suffix = base.key.startsWith('flooring.row.') ? base.label.replace(/^Flooring: /, '') : null;
  const catalogName = item ? (suffix ? `${item.name}: ${suffix}` : item.name) : base.label;

  return {
    key: base.key,
    source: base.source,
    division: edit.division ?? base.division,
    name: edit.name ?? (base.source === 'custom' ? base.label : catalogName),
    unit,
    qty,
    formula: base.formula || null,
    grade: item?.grade ?? edit.grade ?? base.grade,
    hasGrades: !!family && (idx.byFamily.get(family)?.length ?? 0) > 1,
    catalogItemId: item?.id ?? null,
    materialUnit,
    laborUnit,
    ...lineAmounts(qty, materialUnit, laborUnit),
    // A free-text line you typed has nothing to fall back to, so it never shows as "changed".
    edited: {
      name: tracked && edit.name !== undefined,
      division: edit.division !== undefined,
      qty: edit.qty !== undefined && base.source === 'auto',
      unit: tracked && edit.unit !== undefined,
      materialUnit: tracked && edit.materialUnit !== undefined,
      laborUnit: tracked && edit.laborUnit !== undefined,
      grade: edit.grade !== undefined,
      catalogItem: edit.catalogItemId !== undefined,
    },
    unverified,
    warnings,
  };
}

export interface ResolvedEstimate {
  lines: ResolvedLine[];
  /** Auto lines you deleted; shown so they can be restored. */
  removed: ResolvedLine[];
}

export function resolveEstimate(
  inputs: HouseInputs,
  catalog: CatalogItem[],
  lineEdits: Record<string, LineEdit>,
  customLines: CustomLine[],
  /** False for a custom quote: only the lines you added. */
  includeHouseLines = true,
): ResolvedEstimate {
  const idx = indexCatalog(catalog);
  const lines: ResolvedLine[] = [];
  const removed: ResolvedLine[] = [];

  for (const g of includeHouseLines ? generateLines(inputs) : []) {
    const edit = lineEdits[g.key] ?? {};
    const line = resolveOne({ ...g, source: 'auto' }, edit, idx);
    if (edit.deleted) removed.push(line);
    else if (line.qty !== 0 || edit.qty !== undefined) lines.push(line);
  }

  for (const c of customLines) {
    const edit = lineEdits[c.key] ?? {};
    const linked = c.catalogItemId ? idx.byId.get(c.catalogItemId) : undefined;
    const line = resolveOne(
      {
        key: c.key,
        division: c.division,
        family: c.catalogItemId ? familyOf(c.catalogItemId) : null,
        label: c.name,
        qty: c.qty,
        unit: c.unit,
        formula: '',
        grade: linked?.grade ?? 'builder',
        source: 'custom',
      },
      edit,
      idx,
    );
    line.description = c.description ?? '';
    lines.push(line);
  }

  const order = (division: string) => DIVISIONS.indexOf(division as (typeof DIVISIONS)[number]);
  lines.sort((a, b) => order(a.division) - order(b.division));
  return { lines, removed };
}

/** Sets or clears fields on a line's edit. Passing undefined removes the override. */
export function applyLineEdit(
  edits: Record<string, LineEdit>,
  key: string,
  patch: { [K in keyof LineEdit]: LineEdit[K] | undefined },
): Record<string, LineEdit> {
  const next: LineEdit = { ...edits[key], ...patch };
  for (const k of Object.keys(next) as (keyof LineEdit)[]) {
    if (next[k] === undefined) delete next[k];
  }
  const result = { ...edits };
  if (Object.keys(next).length) result[key] = next;
  else delete result[key];
  return result;
}

/** Everything needed to show or export a priced estimate, from one project and one set of prices. */
/** The quote's own markups, or for an older project, the defaults from the settings it is priced with. */
export function markupsOf(project: Project, settings: Settings): Markups {
  return project.markups ?? defaultMarkups(settings);
}

export function defaultMarkups(settings: Settings): Markups {
  return {
    salesTaxPct: settings.salesTaxPct,
    contingencyPct: settings.contingencyPct,
    overheadPct: settings.overheadPct,
    profitPct: settings.profitPct,
    profitAmount: null,
  };
}

/** Profit as a share of the grand total (margin), as opposed to the markup percent on cost. */
export const marginPct = (profit: number, grandTotal: number): number => (grandTotal > 0 ? (profit / grandTotal) * 100 : 0);

export function priceProject(project: Project, catalog: CatalogItem[], settings: Settings) {
  const markups = markupsOf(project, settings);
  const isHouse = project.kind === 'house';
  const { lines, removed } = resolveEstimate(project.inputs, catalog, project.lineEdits, project.customLines, isHouse);
  const totals = computeTotals(lines, markups, isHouse ? project.inputs.heatedSqft : 0);
  const divisions = summarizeDivisions(lines, markups, totals.grandTotal);
  const unverifiedCount = lines.filter((l) => l.unverified).length;
  return { lines, removed, totals, divisions, unverifiedCount, markups };
}

export type PricedProject = ReturnType<typeof priceProject>;
