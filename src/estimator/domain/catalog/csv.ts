import Papa from 'papaparse';
import { DIVISIONS, GRADES, UNITS, type CatalogItem, type Division, type Grade, type Unit } from '../types';

const COLUMNS = ['id', 'division', 'name', 'unit', 'unit_cost', 'labor_cost', 'grade', 'notes', 'verified'];

export function catalogToCsv(items: CatalogItem[]): string {
  return Papa.unparse({
    fields: COLUMNS,
    data: items.map((i) => [i.id, i.division, i.name, i.unit, i.unitCost, i.laborCost, i.grade, i.notes, i.verified]),
  });
}

export interface CatalogImportResult {
  /** The full catalog after import. Items not in the file are kept. Unchanged if there are errors. */
  items: CatalogItem[];
  added: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

const parseMoney = (raw: string): number | null => {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/**
 * Merges a CSV into the catalog. Any error rejects the whole file, so a bad row can never leave
 * half-updated prices. A row whose price changed counts as verified: you just typed that number.
 */
export function importCatalogCsv(text: string, existing: CatalogItem[]): CatalogImportResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const errors: string[] = [];
  const fields = parsed.meta.fields ?? [];
  for (const col of ['division', 'name', 'unit', 'unit_cost', 'labor_cost', 'grade']) {
    if (!fields.includes(col)) errors.push(`Missing column "${col}"`);
  }
  if (errors.length) return { items: existing, added: 0, updated: 0, unchanged: 0, errors };

  const byId = new Map(existing.map((i) => [i.id, i]));
  const result = new Map(byId);
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  parsed.data.forEach((row, index) => {
    const rowNum = index + 2;
    const rowErrors: string[] = [];
    const name = (row.name ?? '').trim();
    const division = (row.division ?? '').trim();
    const unit = (row.unit ?? '').trim();
    const grade = (row.grade ?? '').trim().toLowerCase();
    const unitCost = parseMoney(row.unit_cost ?? '');
    const laborCost = parseMoney(row.labor_cost ?? '');
    const id = (row.id ?? '').trim() || `custom.${slug(name)}`;

    if (!name) rowErrors.push('name is blank');
    if (!DIVISIONS.includes(division as Division)) rowErrors.push(`unknown division "${division}"`);
    if (!UNITS.includes(unit as Unit)) rowErrors.push(`unknown unit "${unit}"`);
    if (!GRADES.includes(grade as Grade)) rowErrors.push(`unknown grade "${grade}"`);
    if (unitCost === null) rowErrors.push(`bad unit_cost "${row.unit_cost ?? ''}"`);
    if (laborCost === null) rowErrors.push(`bad labor_cost "${row.labor_cost ?? ''}"`);
    if (seen.has(id)) rowErrors.push(`duplicate id "${id}"`);
    seen.add(id);
    if (rowErrors.length) {
      errors.push(`Row ${rowNum}: ${rowErrors.join('; ')}`);
      return;
    }

    const prior = byId.get(id);
    const flag = (row.verified ?? '').trim().toLowerCase();
    const priceChanged = !prior || prior.unitCost !== unitCost || prior.laborCost !== laborCost;
    const verified =
      flag === 'true'
        ? true
        : prior
          ? priceChanged || prior.verified && flag !== 'false'
          : flag !== 'false';

    const item: CatalogItem = {
      id,
      division: division as Division,
      name,
      unit: unit as Unit,
      unitCost: unitCost as number,
      laborCost: laborCost as number,
      grade: grade as Grade,
      notes: row.notes ?? prior?.notes ?? '',
      verified,
    };
    if (!prior) added++;
    else if (JSON.stringify(prior) === JSON.stringify(item)) unchanged++;
    else updated++;
    result.set(id, item);
  });

  if (errors.length) return { items: existing, added: 0, updated: 0, unchanged: 0, errors };
  return { items: [...result.values()], added, updated, unchanged, errors };
}
