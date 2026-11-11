import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../src/estimator/domain/catalog/seed';
import { defaultSettings } from '../src/estimator/domain/house/defaults';
import { planImport } from '../src/estimator/importPlan';

const projectFile = readFileSync('tests/fixtures/sample-concrete.estimator.json', 'utf8');
let n = 0;
const id = () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;

describe('import plan', () => {
  it('reads a single project file and prices it at $9,800', () => {
    const p = planImport(projectFile, new Set(), new Set(), defaultSettings(), id);
    expect(p.kind).toBe('project');
    expect(p.estimates).toHaveLength(1);
    expect(p.estimates[0]).toMatchObject({ name: '100 Sample Rd - Concrete', totalInFile: 9800, skipped: false, lines: 6 });
    expect(p.estimates[0].markups.profit_amount).toBe(4900);
    expect(p.newCatalog).toEqual([]);
    expect(p.settings).toBeNull();
  });
  it('reads a full backup with catalog and settings, and skips what is already here', () => {
    const project = JSON.parse(projectFile).project;
    const settings = { ...defaultSettings(), salesTaxPct: 6.75, company: { ...defaultSettings().company, name: 'Sample Co' } };
    const full = JSON.stringify({ app: 'estimator', version: 1, kind: 'full', catalog: seedCatalog(), settings, projects: [project], snapshots: [{ id: 's1', projectId: project.id, label: 'Sent', createdAt: '2026-11-08T00:00:00Z', project, catalog: [], settings }], files: [] });
    const fresh = planImport(full, new Set(), new Set(), defaultSettings(), id);
    expect(fresh.newCatalog).toHaveLength(seedCatalog().length);
    expect(fresh.settings?.company.name).toBe('Sample Co');
    expect(fresh.estimates[0].versionRows).toHaveLength(1);
    expect(fresh.estimates[0].versionRows[0].estimate_id).toBe(fresh.estimates[0].estimate.id);
    const again = planImport(full, new Set([project.id]), new Set(seedCatalog().map((c) => c.id)), defaultSettings(), id);
    expect(again.estimates[0].skipped).toBe(true);
    expect(again.newCatalog).toEqual([]);
    expect(again.catalogAlready).toBe(seedCatalog().length);
  });
  it('refuses a file that is not an Estimator export', () => {
    expect(() => planImport('{"hello":1}', new Set(), new Set(), defaultSettings(), id)).toThrow();
    expect(() => planImport('not json', new Set(), new Set(), defaultSettings(), id)).toThrow(/not an Estimator export/);
  });
});
