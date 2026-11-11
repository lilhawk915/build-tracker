import { beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '../src/data/store';
import { clearUndo, rememberRows, startUndoGroup, undoLast, undoState, withUndo } from '../src/data/undo';

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
const fake = {
  mode: 'local',
  async list(t: string) { return db[t] ?? []; },
  async insert(t: string, rows: Row | Row[]) { for (const r of Array.isArray(rows) ? rows : [rows]) (db[t] ??= []).push({ ...r }); },
  async update(t: string, id: string, patch: Row) { const r = db[t].find((x) => x.id === id); if (!r) throw new Error('missing'); Object.assign(r, patch); },
  async remove(t: string, id: string) { db[t] = db[t].filter((x) => x.id !== id); },
  async removeFile() {},
} as unknown as Store;
const store = withUndo(fake);

beforeEach(() => {
  db = { estimates: [{ id: 'e1', status: 'draft', notes: 'a', job_id: null }], jobs: [] };
  clearUndo();
  rememberRows(structuredClone(db) as never);
});

describe('undo', () => {
  it('puts an edited field back the way it was', async () => {
    await store.update('estimates', 'e1', { notes: 'oops' });
    expect(undoState.next()).not.toBeNull();
    await undoLast();
    expect(db.estimates[0].notes).toBe('a');
    expect(undoState.next()).toBeNull();
  });
  it('undoes several edits one at a time, newest first', async () => {
    await store.update('estimates', 'e1', { notes: 'b' });
    await store.update('estimates', 'e1', { notes: 'c' });
    await undoLast();
    expect(db.estimates[0].notes).toBe('b');
    await undoLast();
    expect(db.estimates[0].notes).toBe('a');
  });
  it('removes something that was just added', async () => {
    await store.insert('jobs', { name: 'Accident' });
    expect(db.jobs).toHaveLength(1);
    await undoLast();
    expect(db.jobs).toHaveLength(0);
  });
  it('undoes a whole action (new job + won quote) in one press', async () => {
    const end = startUndoGroup('Job accepted');
    await store.insert('jobs', { id: 'j1', name: 'Back patios' });
    await store.update('estimates', 'e1', { status: 'won', job_id: 'j1' });
    end();
    expect(undoState.next()).toBe('Job accepted');
    await undoLast();
    expect(db.jobs).toHaveLength(0);
    expect(db.estimates[0]).toMatchObject({ status: 'draft', job_id: null });
    expect(undoState.next()).toBeNull();
  });
  it('skips saves that changed nothing', async () => {
    await store.update('estimates', 'e1', { notes: 'a' });
    expect(undoState.next()).toBeNull();
  });
});
