import type { Task } from './types';

const DAY = 86400000;
export const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const span = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / DAY);

export interface DateChange { id: string; start_date: string; end_date: string }

// Applies a date change and pushes later work out, keeping each task's length.
// Dependent tasks only move later. Finished tasks stay put. Days are calendar days.
export function cascade(tasks: Task[], changedId: string, start: string, end: string): DateChange[] {
  const dates = new Map(tasks.map((t) => [t.id, { start: t.start_date, end: t.end_date }]));
  dates.set(changedId, { start, end });
  const out = new Map<string, DateChange>([[changedId, { id: changedId, start_date: start, end_date: end }]]);
  const seen = new Set([changedId]);
  const queue = [changedId];
  while (queue.length) {
    const id = queue.shift()!;
    const parent = dates.get(id)!;
    for (const t of tasks.filter((x) => x.depends_on === id && !seen.has(x.id))) {
      seen.add(t.id);
      queue.push(t.id);
      if (t.status === 'done') continue;
      const cur = dates.get(t.id)!;
      const earliest = addDays(parent.end, 1);
      if (cur.start < earliest) {
        const moved = { start: earliest, end: addDays(earliest, span(cur.start, cur.end)) };
        dates.set(t.id, moved);
        out.set(t.id, { id: t.id, start_date: moved.start, end_date: moved.end });
      }
    }
  }
  return [...out.values()];
}

// True if making task depend on candidate would create a loop.
export function wouldLoop(tasks: Task[], taskId: string, candidateId: string): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let cur: string | null | undefined = candidateId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === taskId) return true;
    seen.add(cur);
    cur = byId.get(cur)?.depends_on;
  }
  return false;
}
