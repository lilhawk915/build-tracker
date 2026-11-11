import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../catalog/seed';
import { defaultSettings, newProject } from '../house/defaults';
import type { Project, Snapshot } from '../types';
import { fullBackup, parseFullBackup, parseProjectFile, projectFile, rekeyImportedProject } from './backup';

const settings = defaultSettings();
const project = newProject('p1', settings, '2026-01-01');
const snap: Snapshot = { id: 's1', projectId: 'p1', label: 'v1', createdAt: 'x', project, catalog: seedCatalog(), settings };

describe('project files', () => {
  it('round trip', () => {
    const f = parseProjectFile(JSON.stringify(projectFile(project, [snap])));
    expect(f.project).toEqual(project);
    expect(f.snapshots[0].label).toBe('v1');
  });
  it('fills in input fields missing from an older file', () => {
    const old = JSON.parse(JSON.stringify(projectFile(project, [])));
    delete old.project.inputs.wastePct;
    delete old.project.customLines;
    delete old.project.kind;
    const f = parseProjectFile(JSON.stringify(old));
    expect(f.project.inputs.wastePct).toBe(10);
    expect(f.project.customLines).toEqual([]);
    expect(f.project.kind).toBe('house');
  });
  it('rejects junk with a plain message', () => {
    expect(() => parseProjectFile('not json')).toThrow('not valid JSON');
    expect(() => parseProjectFile('{"app":"other"}')).toThrow('not an Estimator');
    expect(() => parseProjectFile(JSON.stringify({ app: 'estimator', version: 999, kind: 'project' }))).toThrow('newer');
    expect(() => parseProjectFile(JSON.stringify({ app: 'estimator', version: 1, kind: 'project', project: {} }))).toThrow('damaged');
  });
  it('tells you when you picked the wrong kind of file', () => {
    const full = JSON.stringify(fullBackup([], settings, [], []));
    expect(() => parseProjectFile(full)).toThrow('full backup');
    expect(() => parseFullBackup(JSON.stringify(projectFile(project, [])))).toThrow('single project');
  });
  it('import gets new ids so it cannot overwrite existing work', () => {
    let n = 0;
    const r = rekeyImportedProject(projectFile(project, [snap]), () => `new${++n}`, 'now');
    expect(r.project.id).toBe('new1');
    expect(r.snapshots[0].id).toBe('new2');
    expect(r.snapshots[0].projectId).toBe('new1');
    expect(r.snapshots[0].project.id).toBe('new1');
  });
});

describe('full backup', () => {
  it('round trip', () => {
    const b = parseFullBackup(JSON.stringify(fullBackup(seedCatalog(), settings, [project], [snap])));
    expect(b.catalog).toHaveLength(seedCatalog().length);
    expect(b.projects[0].id).toBe('p1');
    expect(b.snapshots[0].id).toBe('s1');
    expect(b.settings).toEqual(settings);
  });
  it('rejects a damaged project', () => {
    const bad = fullBackup([], settings, [{ nope: true } as unknown as Project], []);
    expect(() => parseFullBackup(JSON.stringify(bad))).toThrow('damaged');
  });
});

describe('attached files in exports', () => {
  const file = { meta: { id: 'f1', projectId: 'p1', billId: 'b1', name: 'receipt.jpg', type: 'image/jpeg', size: 3, addedAt: 'x' }, dataUrl: 'data:image/jpeg;base64,AAAA' };
  it('project file round trip keeps files', () => {
    const f = parseProjectFile(JSON.stringify(projectFile(project, [], [file])));
    expect(f.files).toEqual([file]);
  });
  it('older files without attachments still load', () => {
    const old = JSON.parse(JSON.stringify(projectFile(project, [])));
    delete old.files;
    delete old.project.record;
    const f = parseProjectFile(JSON.stringify(old));
    expect(f.files).toEqual([]);
    expect(f.project.record).toEqual({ bills: [], selections: [], log: [] });
  });
  it('import gives files new ids under the new project but keeps the bill link', () => {
    let n = 0;
    const r = rekeyImportedProject(projectFile(project, [], [file]), () => `new${++n}`, 'now');
    expect(r.files[0].meta.id).not.toBe('f1');
    expect(r.files[0].meta.projectId).toBe(r.project.id);
    expect(r.files[0].meta.billId).toBe('b1');
  });
  it('damaged file entries are rejected', () => {
    const bad = { ...projectFile(project, []), files: [{ meta: { id: 'x' }, dataUrl: 'http://evil' }] };
    expect(() => parseProjectFile(JSON.stringify(bad))).toThrow('attached files');
  });
  it('full backup round trip keeps files', () => {
    expect(parseFullBackup(JSON.stringify(fullBackup([], settings, [project], [], [file]))).files).toEqual([file]);
  });
});
