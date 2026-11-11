import { defaultInputs } from '../house/defaults';
import { emptyRecord } from '../record/record';
import type { CatalogItem, FileMeta, Project, Settings, Snapshot } from '../types';

const APP = 'estimator';
const VERSION = 1;

/** An attached file inside an export, with its contents as a data URL. */
export interface ExportedFile {
  meta: FileMeta;
  dataUrl: string;
}

export interface ProjectFile {
  app: typeof APP;
  version: number;
  kind: 'project';
  project: Project;
  snapshots: Snapshot[];
  files: ExportedFile[];
}

export interface FullBackup {
  app: typeof APP;
  version: number;
  kind: 'full';
  catalog: CatalogItem[];
  settings: Settings;
  projects: Project[];
  snapshots: Snapshot[];
  files: ExportedFile[];
}

export const projectFile = (project: Project, snapshots: Snapshot[], files: ExportedFile[] = []): ProjectFile => ({
  app: APP,
  version: VERSION,
  kind: 'project',
  project,
  snapshots,
  files,
});

export const fullBackup = (
  catalog: CatalogItem[],
  settings: Settings,
  projects: Project[],
  snapshots: Snapshot[],
  files: ExportedFile[] = [],
): FullBackup => ({ app: APP, version: VERSION, kind: 'full', catalog, settings, projects, snapshots, files });

/** Fills in fields added since the file was saved, so old backups keep working. */
export function normalizeProject(raw: Project): Project {
  return {
    ...raw,
    // Projects saved before custom quotes existed were all house estimates.
    kind: raw.kind ?? 'house',
    record: { ...emptyRecord(), ...raw.record },
    inputs: { ...defaultInputs(), ...raw.inputs },
    lineEdits: raw.lineEdits ?? {},
    customLines: raw.customLines ?? [],
    assumptions: raw.assumptions ?? '',
    validityDays: raw.validityDays ?? 30,
  };
}

function parseFile(text: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const obj = data as Record<string, unknown> | null;
  if (!obj || obj.app !== APP) throw new Error('That file is not an Estimator export.');
  if (typeof obj.version !== 'number' || obj.version > VERSION) {
    throw new Error('That file came from a newer version of this app.');
  }
  return obj;
}

const isProject = (p: unknown): p is Project =>
  !!p && typeof p === 'object' && typeof (p as Project).id === 'string' && typeof (p as Project).inputs === 'object';

const isFileList = (f: unknown): f is ExportedFile[] =>
  Array.isArray(f) &&
  f.every(
    (x) =>
      typeof (x as ExportedFile)?.dataUrl === 'string' &&
      (x as ExportedFile).dataUrl.startsWith('data:') &&
      typeof (x as ExportedFile)?.meta?.id === 'string' &&
      typeof (x as ExportedFile)?.meta?.projectId === 'string',
  );

const isSnapshotList = (s: unknown): s is Snapshot[] =>
  Array.isArray(s) &&
  s.every((x) => isProject((x as Snapshot)?.project) && Array.isArray((x as Snapshot)?.catalog) && !!(x as Snapshot)?.settings);

export function parseProjectFile(text: string): ProjectFile {
  const obj = parseFile(text);
  if (obj.kind !== 'project') throw new Error('That file is a full backup. Restore it from Settings.');
  if (!isProject(obj.project)) throw new Error('The project in that file is damaged.');
  if (!isSnapshotList(obj.snapshots ?? [])) throw new Error('The versions in that file are damaged.');
  if (!isFileList(obj.files ?? [])) throw new Error('The attached files in that file are damaged.');
  return {
    ...(obj as unknown as ProjectFile),
    project: normalizeProject(obj.project),
    snapshots: (obj.snapshots as Snapshot[] | undefined) ?? [],
    files: (obj.files as ExportedFile[] | undefined) ?? [],
  };
}

export function parseFullBackup(text: string): FullBackup {
  const obj = parseFile(text);
  if (obj.kind !== 'full') throw new Error('That file is a single project. Import it from the Projects page.');
  if (!Array.isArray(obj.catalog) || !obj.settings || !Array.isArray(obj.projects)) {
    throw new Error('That backup is damaged.');
  }
  if (!obj.projects.every(isProject)) throw new Error('A project in that backup is damaged.');
  if (!isSnapshotList(obj.snapshots ?? [])) throw new Error('The versions in that backup are damaged.');
  if (!isFileList(obj.files ?? [])) throw new Error('The attached files in that backup are damaged.');
  return {
    ...(obj as unknown as FullBackup),
    projects: (obj.projects as Project[]).map(normalizeProject),
    snapshots: (obj.snapshots as Snapshot[] | undefined) ?? [],
    files: (obj.files as ExportedFile[] | undefined) ?? [],
  };
}

/** Copies a project file under new ids, so importing can never overwrite existing work. */
export function rekeyImportedProject(
  file: ProjectFile,
  newId: () => string,
  now: string,
): { project: Project; snapshots: Snapshot[]; files: ExportedFile[] } {
  const id = newId();
  return {
    project: { ...file.project, id, updatedAt: now },
    // Bill ids stay the same, so receipts still point at the right bill.
    files: file.files.map((f) => ({ ...f, meta: { ...f.meta, id: newId(), projectId: id } })),
    snapshots: file.snapshots.map((s) => ({
      ...s,
      id: newId(),
      projectId: id,
      project: { ...normalizeProject(s.project), id },
    })),
  };
}
