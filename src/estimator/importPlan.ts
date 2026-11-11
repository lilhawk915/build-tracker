// Reads an Estimator export and works out exactly what importing it will add, before anything is saved.
import { catalogToRow, projectToRows, type CatalogRow, type EstimateRow, type MarkupsRow } from './convert';
import { parseFullBackup, parseProjectFile } from './domain/backup/backup';
import { defaultSettings } from './domain/house/defaults';
import { priceProject } from './domain/pricing/resolve';
import type { CatalogItem, Project, Settings, Snapshot } from './domain/types';

export interface ImportPlanItem {
  legacyId: string;
  name: string;
  kind: Project['kind'];
  lines: number;
  totalInFile: number;
  versions: number;
  skipped: boolean;          // already imported before
  recordEntries: number;     // bills, materials and notes in the Estimator's Job Record tab (not imported here)
  estimate: Omit<EstimateRow, 'number'>;
  markups: MarkupsRow;
  versionRows: { estimate_id: string; label: string; data: { project: Project; catalog: CatalogItem[]; settings: Settings }; created_at: string }[];
}

export interface ImportPlan {
  kind: 'full' | 'project';
  estimates: ImportPlanItem[];
  newCatalog: CatalogRow[];
  catalogAlready: number;
  settings: Settings | null;
  attachedFiles: number;
}

export function planImport(text: string, existingLegacyIds: Set<string>, existingCatalogIds: Set<string>, liveSettings: Settings, newId: () => string): ImportPlan {
  let kind: 'full' | 'project';
  let projects: Project[];
  let snapshots: Snapshot[];
  let catalog: CatalogItem[];
  let settings: Settings | null;
  let attachedFiles: number;
  const head = (() => { try { return JSON.parse(text) as { kind?: string }; } catch { throw new Error('That file is not an Estimator export.'); } })();
  if (head.kind === 'full') {
    const b = parseFullBackup(text);
    kind = 'full'; projects = b.projects; snapshots = b.snapshots; catalog = b.catalog; settings = b.settings; attachedFiles = b.files.length;
  } else {
    const p = parseProjectFile(text);
    kind = 'project'; projects = [p.project]; snapshots = p.snapshots; catalog = []; settings = null; attachedFiles = p.files.length;
  }
  // A single-project file has no catalog or settings, so it's priced with what's already live.
  const pricingSettings = settings ?? liveSettings ?? defaultSettings();
  const estimates = projects.map((p): ImportPlanItem => {
    const id = newId();
    const { estimate, markups } = projectToRows(p, id, pricingSettings);
    const own = snapshots.filter((s) => s.projectId === p.id);
    const priced = priceProject(p, catalog, pricingSettings);
    return {
      legacyId: p.id, name: p.clientName || p.address || '(no name)', kind: p.kind, lines: priced.lines.length,
      totalInFile: priced.totals.grandTotal, versions: own.length, skipped: existingLegacyIds.has(p.id),
      recordEntries: p.record.bills.length + p.record.selections.length + p.record.log.length,
      estimate: { ...estimate, status: 'draft' }, markups,
      versionRows: own.map((s) => ({ estimate_id: id, label: s.label, data: { project: { ...s.project, id }, catalog: s.catalog, settings: s.settings }, created_at: s.createdAt })),
    };
  });
  const rows = catalog.map(catalogToRow);
  return {
    kind, estimates, settings, attachedFiles,
    newCatalog: rows.filter((r) => !existingCatalogIds.has(r.id)),
    catalogAlready: rows.filter((r) => existingCatalogIds.has(r.id)).length,
  };
}
