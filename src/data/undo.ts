// Undo for accidental changes. Every edit and add made through the store is remembered with how to
// reverse it; Undo reverses the most recent one. One button press = one action (a save, a "Job accepted").
// Deletes are not undoable: they already ask first, and a delete can take files and child records with it.
import type { TableName } from '../domain/types';
import { rowKey, type Store } from './store';

type Row = Record<string, unknown>;
interface Entry { label: string; steps: (() => Promise<void>)[] }

const LIMIT = 30;
const stack: Entry[] = [];
const known = new Map<string, Row>();
const listeners = new Set<() => void>();
let group: Entry | null = null;
let version = 0;

const keyOf = (table: string, id: unknown) => `${table}:${String(id)}`;
const notify = () => { version++; listeners.forEach((l) => l()); };

/** The last rows loaded from the database. Undo restores an edited field to what it was here. */
export function rememberRows(data: Partial<Record<TableName, Row[]>>) {
  known.clear();
  for (const [table, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    const k = rowKey(table as TableName);
    for (const r of rows) if (r && r[k] != null) known.set(keyOf(table, r[k]), r);
  }
}

function record(step: () => Promise<void>) {
  if (group) { group.steps.push(step); return; }
  stack.push({ label: 'your last change', steps: [step] });
  if (stack.length > LIMIT) stack.shift();
  notify();
}

/** Groups every change made until the returned function is called into one undo step. */
export function startUndoGroup(label: string): () => void {
  if (group) return () => {};
  const mine: Entry = { label, steps: [] };
  group = mine;
  return () => {
    if (group === mine) group = null;
    if (mine.steps.length) {
      stack.push(mine);
      if (stack.length > LIMIT) stack.shift();
      notify();
    }
  };
}

export const undoState = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  version: () => version,
  next: () => stack[stack.length - 1]?.label ?? null,
};

/** Reverses the most recent change. Returns its label, or null if there is nothing to undo. */
export async function undoLast(): Promise<string | null> {
  const e = stack.pop();
  if (!e) return null;
  notify();
  for (const step of [...e.steps].reverse()) await step();
  return e.label;
}

export function clearUndo() { stack.length = 0; group = null; notify(); }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function withUndo(raw: Store): Store {
  return {
    ...raw,
    async update(table, id, patch) {
      const k = keyOf(table, id);
      const old = known.get(k);
      await raw.update(table, id, patch);
      if (!old) return;
      const before: Row = {};
      for (const f of Object.keys(patch as Row)) before[f] = old[f] === undefined ? null : old[f];
      known.set(k, { ...old, ...(patch as Row) });
      if (same(before, patch)) return;
      record(async () => {
        await raw.update(table, id, before as never);
        known.set(k, { ...(known.get(k) ?? old), ...before });
      });
    },
    async insert(table, rows) {
      const key = rowKey(table);
      const list = (Array.isArray(rows) ? rows : [rows]).map((r) => {
        const row = { ...(r as Row) };
        if (key === 'id' && row.id == null) row.id = crypto.randomUUID();
        return row;
      });
      await raw.insert(table, list as never);
      for (const r of list) known.set(keyOf(table, r[key]), r);
      record(async () => {
        for (const r of [...list].reverse()) {
          await raw.remove(table, String(r[key]));
          known.delete(keyOf(table, r[key]));
          if (table === 'documents' && typeof r.file_path === 'string') await raw.removeFile(r.file_path).catch(() => {});
        }
      });
    },
    async remove(table, id) {
      await raw.remove(table, id);
      known.delete(keyOf(table, id));
    },
  };
}
