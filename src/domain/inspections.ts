import { addDays } from './schedule';
import type { Inspection, Task } from './types';

/**
 * The usual county inspections on a new house, each tied to the step that can't start until it passes,
 * because that step covers the work up. Matched by step name. Every list can be edited per job.
 */
export const STANDARD_INSPECTIONS: { name: string; before: RegExp | null }[] = [
  { name: 'Footer', before: /footer|footing/i },
  { name: 'Under-slab plumbing', before: /basement floor|slab/i },
  { name: 'Framing', before: /insulation|insulate/i },
  { name: 'Rough plumbing, electric and HVAC', before: /insulation|insulate/i },
  { name: 'Insulation', before: /drywall/i },
  { name: 'Final', before: null },
];

export const RESULT_LABEL: Record<Inspection['result'], string> = {
  not_scheduled: 'Not scheduled', scheduled: 'Scheduled', passed: 'Passed', failed: 'Failed', not_needed: 'Not needed',
};

/** Passed or not needed: nothing left to do. */
export const isCleared = (i: Pick<Inspection, 'result'>) => i.result === 'passed' || i.result === 'not_needed';

/** Days before a step starts that its inspection should be on the calendar. */
export const SCHEDULE_AHEAD_DAYS = 7;

/** Inspections still to pass before a step can start. */
export const holdingUp = (taskId: string, inspections: Inspection[]) =>
  inspections.filter((i) => i.task_id === taskId && !isCleared(i));

/** Why a step can't start because of inspections, or null when it can. */
export function inspectionBlocker(task: Pick<Task, 'id' | 'name'>, inspections: Inspection[]): string | null {
  const open = holdingUp(task.id, inspections);
  if (!open.length) return null;
  const names = open.map((i) => `${i.name}${i.result === 'failed' ? ' (failed)' : ''}`).join(', ');
  return `${task.name} can't start until ${open.length === 1 ? 'this inspection passes' : 'these inspections pass'}: ${names}.`;
}

/** New, unscheduled inspections for a job, tied to the matching steps. Ones the job already has (by name) are skipped. */
export function standardInspectionsFor(jobId: string, tasks: Pick<Task, 'id' | 'name' | 'sort'>[], existing: Pick<Inspection, 'name'>[] = []): Omit<Inspection, 'id'>[] {
  const have = new Set(existing.map((i) => i.name.toLowerCase()));
  const ordered = [...tasks].sort((a, b) => a.sort - b.sort);
  return STANDARD_INSPECTIONS.filter((s) => !have.has(s.name.toLowerCase())).flatMap((s, sort) => {
    const step = s.before ? ordered.find((t) => s.before!.test(t.name)) : undefined;
    if (s.before && !step) return [];
    return [{
      job_id: jobId, task_id: step?.id ?? null, name: s.name, result: 'not_scheduled' as const, scheduled_date: null,
      result_date: null, inspector: '', notes: '', vendor_id: null, fail_count: 0, sort: existing.length + sort,
    }];
  });
}

export interface InspectionNeed { inspection: Inspection; step?: Task; kind: 'failed' | 'schedule' | 'result' }

/** Inspections that need someone: failed ones, ones to put on the calendar, and ones whose date passed with no result. */
export function inspectionNeeds(inspections: Inspection[], tasks: Task[], today: string): InspectionNeed[] {
  const soon = addDays(today, SCHEDULE_AHEAD_DAYS);
  return inspections.flatMap((inspection): InspectionNeed[] => {
    const step = tasks.find((t) => t.id === inspection.task_id);
    if (inspection.result === 'failed') return [{ inspection, step, kind: 'failed' }];
    if (inspection.result === 'scheduled' && inspection.scheduled_date && inspection.scheduled_date < today) return [{ inspection, step, kind: 'result' }];
    if (inspection.result === 'not_scheduled' && step && step.status === 'todo' && step.start_date <= soon) return [{ inspection, step, kind: 'schedule' }];
    return [];
  });
}
