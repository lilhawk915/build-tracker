// Stage 2 proof: an Estimator quote saved into the Build Tracker database and read back out
// prices exactly the same, to the cent, as it does in the Estimator.
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  catalogToRow, projectToRows, rowToCatalog, rowsToProject, rowsToSettings,
  type CatalogRow, type CompanyRow, type EstimateRow, type MarkupDefaultsRow, type MarkupsRow,
} from '../src/estimator/convert';
import { seedCatalog } from '../src/estimator/domain/catalog/seed';
import { defaultInputs, defaultSettings, newProject } from '../src/estimator/domain/house/defaults';
import { priceProject } from '../src/estimator/domain/pricing/resolve';
import { DIVISIONS, UNITS, type CatalogItem, type Project, type Settings } from '../src/estimator/domain/types';

const STUBS = `
  create role anon nologin; create role authenticated nologin;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select array[]::text[] $$;
`;

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
}, 60000);

// Saves the quote, its catalog and settings through the real tables, then reads them back the way the app will.
async function roundTrip(project: Project, catalog: CatalogItem[], settings: Settings) {
  await db.exec('delete from public.estimates; delete from public.catalog_items;');
  const id = crypto.randomUUID();
  const { estimate, markups } = projectToRows(project, id, settings);
  await db.query(
    `insert into public.estimates (id, legacy_id, kind, client_name, address, quote_date, notes, inputs, line_edits, custom_lines, assumptions, validity_days)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, estimate.legacy_id, estimate.kind, estimate.client_name, estimate.address, estimate.quote_date, estimate.notes,
      JSON.stringify(estimate.inputs), JSON.stringify(estimate.line_edits), JSON.stringify(estimate.custom_lines), estimate.assumptions, estimate.validity_days],
  );
  // The app sends numbers as JSON text, so the database stores exactly what was typed.
  await db.query(
    `update public.estimate_markups set sales_tax_pct = $2::text::numeric, contingency_pct = $3::text::numeric, overhead_pct = $4::text::numeric,
       profit_pct = $5::text::numeric, profit_amount = $6::text::numeric where estimate_id = $1`,
    [id, String(markups.sales_tax_pct), String(markups.contingency_pct), String(markups.overhead_pct), String(markups.profit_pct),
      markups.profit_amount === null ? null : String(markups.profit_amount)],
  );
  for (const c of catalog.map(catalogToRow)) {
    await db.query(
      `insert into public.catalog_items (id, division, name, unit, unit_cost, labor_cost, grade, notes, verified) values ($1,$2,$3,$4,$5::text::numeric,$6::text::numeric,$7,$8,$9)`,
      [c.id, c.division, c.name, c.unit, String(c.unit_cost), String(c.labor_cost), c.grade, c.notes, c.verified],
    );
  }
  await db.query(
    `update public.markup_defaults set sales_tax_pct = $1::text::numeric, contingency_pct = $2::text::numeric, overhead_pct = $3::text::numeric, profit_pct = $4::text::numeric`,
    [String(settings.salesTaxPct), String(settings.contingencyPct), String(settings.overheadPct), String(settings.profitPct)],
  );
  const e = (await db.query<EstimateRow>('select *, quote_date::text as quote_date, created_at::text as created_at, updated_at::text as updated_at from public.estimates where id = $1', [id])).rows[0];
  const m = (await db.query<MarkupsRow>('select * from public.estimate_markups where estimate_id = $1', [id])).rows[0];
  const cat = (await db.query<CatalogRow>('select * from public.catalog_items')).rows.map(rowToCatalog);
  const company = (await db.query<CompanyRow>('select * from public.company_settings')).rows[0];
  const defaults = (await db.query<MarkupDefaultsRow>('select * from public.markup_defaults')).rows[0];
  return { project: rowsToProject(e, m), catalog: cat, settings: rowsToSettings(company, defaults) };
}

const money = (p: ReturnType<typeof priceProject>) => ({
  totals: p.totals,
  divisions: p.divisions,
  lines: p.lines.map((l) => ({ key: l.key, division: l.division, qty: l.qty, material: l.material, labor: l.labor, total: l.total })),
  removed: p.removed.map((l) => l.key),
});

// Same random numbers every run, so a failure can be repeated.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCase(seed: number): { project: Project; catalog: CatalogItem[]; settings: Settings } {
  const r = rng(seed);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  // Prices with fractions of a cent, like $2.875 per sq ft, are the case most likely to drift.
  const price = () => Math.round(r() * 500000) / 1000;
  const settings: Settings = { ...defaultSettings(), salesTaxPct: pick([0, 6.5, 7.25, 7.75]), contingencyPct: pick([0, 5, 7.5]), overheadPct: pick([0, 8, 10.25]), profitPct: pick([0, 10, 12.5, 15]) };
  const catalog = seedCatalog().map((c) => ({ ...c, unitCost: r() < 0.6 ? price() : c.unitCost, laborCost: r() < 0.6 ? price() : c.laborCost }));
  const kind = r() < 0.6 ? 'house' : 'custom';
  const project = newProject(`p${seed}`, settings, '2026-11-10T00:00:00.000Z', kind);
  project.clientName = `Client ${seed}`;
  project.inputs = {
    ...defaultInputs(),
    heatedSqft: 900 + Math.floor(r() * 4000), stories: pick([1, 1.5, 2]), garageBays: pick([0, 1, 2, 3]),
    foundation: pick(['slab', 'crawlspace', 'basement_unfinished', 'basement_finished'] as const),
    roofMaterial: pick(['shingle', 'metal'] as const), siding: pick(['vinyl', 'fiber_cement', 'brick', 'wood'] as const),
    finish: pick(['builder', 'mid', 'premium'] as const), windows: 6 + Math.floor(r() * 30), drivewaySqft: Math.floor(r() * 1200),
    fullBaths: 1 + Math.floor(r() * 4), halfBaths: Math.floor(r() * 3), porchDeckSqft: Math.floor(r() * 600),
  };
  project.customLines = Array.from({ length: Math.floor(r() * 6) }, (_, i) => ({
    key: `c.${seed}.${i}`, division: pick(DIVISIONS), name: `Custom ${i}`, unit: pick(UNITS),
    qty: Math.round(r() * 20000) / 100, catalogItemId: r() < 0.3 ? pick(catalog).id : null,
  }));
  const keys = [...project.customLines.map((c) => c.key), ...priceProject(project, catalog, settings).lines.map((l) => l.key)];
  for (const key of keys) {
    if (r() < 0.35) {
      project.lineEdits[key] = {
        ...(r() < 0.5 ? { materialUnit: price() } : {}),
        ...(r() < 0.5 ? { laborUnit: price() } : {}),
        ...(r() < 0.2 ? { qty: Math.round(r() * 10000) / 100 } : {}),
        ...(r() < 0.1 ? { division: pick(DIVISIONS) } : {}),
        ...(r() < 0.08 ? { deleted: true } : {}),
      };
    }
  }
  project.markups = {
    salesTaxPct: settings.salesTaxPct, contingencyPct: settings.contingencyPct, overheadPct: settings.overheadPct,
    profitPct: settings.profitPct, profitAmount: r() < 0.3 ? price() : null,
  };
  return { project, catalog, settings };
}

describe('Stage 2: pricing survives the move to the database', () => {
  it('prices the concrete quote at $9,800, before and after', async () => {
    const file = JSON.parse(readFileSync('tests/fixtures/sample-concrete.estimator.json', 'utf8'));
    const project = file.project as Project;
    project.record = { bills: [], selections: [], log: [] };
    const catalog = seedCatalog();
    const settings = defaultSettings();
    const before = priceProject(project, catalog, settings);
    expect(before.totals.grandTotal).toBe(9800);
    expect(before.totals.profit).toBe(4900);
    const after = await roundTrip(project, catalog, settings);
    expect(money(priceProject(after.project, after.catalog, after.settings))).toEqual(money(before));
  });

  it('matches to the cent on 300 random quotes, house and custom, with odd prices and edits', async () => {
    let checked = 0;
    let lines = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const c = randomCase(seed);
      const before = priceProject(c.project, c.catalog, c.settings);
      const after = await roundTrip(c.project, c.catalog, c.settings);
      const priced = priceProject(after.project, after.catalog, after.settings);
      expect(money(priced), `quote ${seed}`).toEqual(money(before));
      checked++;
      lines += before.lines.length;
    }
    expect(checked).toBe(300);
    expect(lines).toBeGreaterThan(3000);
  }, 120000);

  it('keeps every field of the quote, not just the totals', async () => {
    const c = randomCase(7);
    const after = await roundTrip(c.project, c.catalog, c.settings);
    for (const k of ['kind', 'clientName', 'address', 'date', 'notes', 'inputs', 'lineEdits', 'customLines', 'assumptions', 'validityDays', 'markups'] as const) {
      expect(after.project[k], k).toEqual(c.project[k]);
    }
    expect(after.catalog.sort((a, b) => a.id.localeCompare(b.id))).toEqual([...c.catalog].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it('prices a staff view without markups at cost only, never a client price', async () => {
    const c = randomCase(11);
    const { estimate } = projectToRows(c.project, crypto.randomUUID(), c.settings);
    const staffView = rowsToProject(estimate, null);
    expect(staffView.markups).toBeUndefined();
  });
});
