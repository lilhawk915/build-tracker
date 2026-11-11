// Moves an Estimator project, catalog and settings in and out of the Build Tracker database.
// The pricing math only ever sees the Estimator's own shapes, so it runs unchanged.
import { defaultInputs } from './domain/house/defaults';
import { emptyRecord } from './domain/record/record';
import type { CatalogItem, HouseInputs, Markups, Project, Settings } from './domain/types';

export interface EstimateRow {
  id: string;
  legacy_id: string | null;
  kind: 'custom' | 'house';
  status: 'draft' | 'sent' | 'won' | 'lost';
  client_name: string;
  address: string;
  quote_date: string;
  notes: string;
  inputs: HouseInputs;
  line_edits: Project['lineEdits'];
  custom_lines: Project['customLines'];
  assumptions: string;
  validity_days: number;
  /** Set by the database on insert. */
  number: number;
  deposit_pct: number | string;
  job_id: string | null;
  created_at: string;
  updated_at: string;
}

// The database may hand numbers back as text (exact decimals). Number() reads them back exactly.
type Num = number | string;
export interface MarkupsRow {
  estimate_id: string;
  sales_tax_pct: Num;
  contingency_pct: Num;
  overhead_pct: Num;
  profit_pct: Num;
  profit_amount: Num | null;
}
export interface CatalogRow {
  id: string; division: string; name: string; unit: string; unit_cost: Num; labor_cost: Num;
  grade: string; notes: string; verified: boolean;
}
export interface CompanyRow {
  name: string; address: string; phone: string; email: string; license: string; logo_data_url: string | null;
  default_assumptions: string; default_validity_days: number;
}
export interface MarkupDefaultsRow { sales_tax_pct: Num; contingency_pct: Num; overhead_pct: Num; profit_pct: Num }

const n = (v: Num) => Number(v);

export function projectToRows(p: Project, id: string, settings: Settings): { estimate: Omit<EstimateRow, 'number'>; markups: MarkupsRow } {
  const m = p.markups ?? {
    salesTaxPct: settings.salesTaxPct, contingencyPct: settings.contingencyPct,
    overheadPct: settings.overheadPct, profitPct: settings.profitPct, profitAmount: null,
  };
  return {
    estimate: {
      id, legacy_id: p.id, kind: p.kind, status: 'draft', client_name: p.clientName, address: p.address,
      quote_date: p.date, notes: p.notes, inputs: p.inputs, line_edits: p.lineEdits, custom_lines: p.customLines,
      assumptions: p.assumptions, validity_days: p.validityDays, deposit_pct: p.depositPct ?? 0, job_id: null, created_at: p.createdAt, updated_at: p.updatedAt,
    },
    markups: {
      estimate_id: id, sales_tax_pct: m.salesTaxPct, contingency_pct: m.contingencyPct, overhead_pct: m.overheadPct,
      profit_pct: m.profitPct, profit_amount: m.profitAmount,
    },
  };
}

export function rowsToMarkups(m: MarkupsRow): Markups {
  return {
    salesTaxPct: n(m.sales_tax_pct), contingencyPct: n(m.contingency_pct), overheadPct: n(m.overhead_pct),
    profitPct: n(m.profit_pct), profitAmount: m.profit_amount === null ? null : n(m.profit_amount),
  };
}

// Staff never get the markups row, so `markups` may be missing. Callers must not show a client price then.
export function rowsToProject(e: EstimateRow | Omit<EstimateRow, 'number'>, markups: MarkupsRow | null): Project {
  return {
    id: e.id, kind: e.kind, record: emptyRecord(), markups: markups ? rowsToMarkups(markups) : undefined,
    clientName: e.client_name, address: e.address, date: e.quote_date, notes: e.notes,
    inputs: { ...defaultInputs(), ...e.inputs }, lineEdits: e.line_edits ?? {}, customLines: e.custom_lines ?? [],
    assumptions: e.assumptions, validityDays: e.validity_days,
    depositPct: Number(e.deposit_pct ?? 0) || 0, quoteNumber: 'number' in e ? e.number : undefined, createdAt: e.created_at, updatedAt: e.updated_at,
  };
}

export const catalogToRow = (c: CatalogItem): CatalogRow => ({
  id: c.id, division: c.division, name: c.name, unit: c.unit, unit_cost: c.unitCost, labor_cost: c.laborCost,
  grade: c.grade, notes: c.notes, verified: c.verified,
});

export const rowToCatalog = (r: CatalogRow): CatalogItem => ({
  id: r.id, division: r.division as CatalogItem['division'], name: r.name, unit: r.unit as CatalogItem['unit'],
  unitCost: n(r.unit_cost), laborCost: n(r.labor_cost), grade: r.grade as CatalogItem['grade'], notes: r.notes, verified: r.verified,
});

export function rowsToSettings(c: CompanyRow, d: MarkupDefaultsRow | null): Settings {
  return {
    salesTaxPct: d ? n(d.sales_tax_pct) : 0, contingencyPct: d ? n(d.contingency_pct) : 0,
    overheadPct: d ? n(d.overhead_pct) : 0, profitPct: d ? n(d.profit_pct) : 0,
    company: { name: c.name, address: c.address, phone: c.phone, email: c.email, license: c.license, logoDataUrl: c.logo_data_url },
    defaultAssumptions: c.default_assumptions, defaultValidityDays: c.default_validity_days,
  };
}
