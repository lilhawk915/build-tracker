import { addDays } from './schedule';
import type { StepCheck, Task } from './types';

/**
 * Ready-made walk-through lists, checked BEFORE the step they're attached to starts, because that step
 * covers up the work. Matched to a step by its name. Every list can be edited per job.
 */
export const STANDARD_CHECKS: { match: RegExp; title: string; items: string[] }[] = [
  {
    match: /footer|footing/i,
    title: 'Before the footer pour',
    items: [
      'Footings dug to the depth and width on the plans',
      'Bottom of the trench is firm, with no mud or standing water',
      'Rebar in place and up off the dirt',
      'Forms square, level and staked',
      'Sewer and water lines are where the plans show',
    ],
  },
  {
    match: /basement floor|slab/i,
    title: 'Before the floor pour',
    items: [
      'Under-floor plumbing in the right spots and holding its test',
      'Gravel spread level and packed',
      'Vapor barrier down, with the seams taped',
      'Sump pit and drain tile set',
      'Radon pipe stubbed up, if using one',
    ],
  },
  {
    match: /frame|framing/i,
    title: 'Before framing',
    items: [
      'Basement walls sealed on the outside, and the drain tile is in',
      'Anchor bolts in, with the right spacing',
      'Walls square: the corner-to-corner measurements match',
      'Top of the walls is level',
      'Sill seal down',
    ],
  },
  {
    match: /insulation|insulate/i,
    title: 'Before insulation',
    items: [
      'Rough plumbing, electric and HVAC all done',
      'Plumbing held its pressure test',
      'Wires stapled, with nail plates where they go through studs',
      'Outlet and switch boxes at the right height',
      'Blocking in for cabinets, towel bars, the TV and grab bars',
      'Windows and doors flashed and sealed',
    ],
  },
  {
    match: /drywall/i,
    title: 'Before drywall',
    items: [
      'Insulation complete, with no gaps or crushed spots',
      'Gaps around pipes, wires and windows foamed',
      'Photos taken of every wall, so you know what is behind it later',
      'Nailers at every inside corner and the ceiling edges',
      'Nothing is still waiting on a sub (low-voltage, bath fans, can lights)',
    ],
  },
  {
    match: /punch|final clean|final walk/i,
    title: 'Final walk-through',
    items: [
      'Every door swings, latches and locks',
      'Every outlet and switch works, and each GFCI trips and resets',
      'Every faucet runs hot and cold with no leaks under the sinks',
      'Toilets flush and refill',
      'Heat and air reach every room',
      'Smoke and CO detectors work',
      'Paint touched up, with no dings',
      'Ground slopes away from the house, and the gutters drain away',
    ],
  },
];

/** The ready-made list for a step, if its name matches one. */
export const standardFor = (stepName: string) => STANDARD_CHECKS.find((s) => s.match.test(stepName));

export interface CheckStatus { total: number; done: number; complete: boolean }

export function checkStatus(checks: Pick<StepCheck, 'task_id' | 'done'>[], taskId: string): CheckStatus {
  const mine = checks.filter((c) => c.task_id === taskId);
  const done = mine.filter((c) => c.done).length;
  return { total: mine.length, done, complete: done === mine.length };
}

/** Why a step can't be started yet, or null when it can. */
export function startBlocker(task: Pick<Task, 'id' | 'name'>, checks: Pick<StepCheck, 'task_id' | 'done'>[]): string | null {
  const s = checkStatus(checks, task.id);
  if (s.complete) return null;
  return `Finish the walk-through checklist for ${task.name} first: ${s.done} of ${s.total} done.`;
}

/** Steps starting within `days` (or already started) whose checklist isn't finished, soonest first. */
export function checksDue(tasks: Task[], checks: StepCheck[], today: string, days = 3): { task: Task; status: CheckStatus }[] {
  const cutoff = addDays(today, days);
  return tasks
    .filter((t) => t.status !== 'done' && t.start_date <= cutoff)
    .map((task) => ({ task, status: checkStatus(checks, task.id) }))
    .filter((x) => x.status.total > 0 && !x.status.complete)
    .sort((a, b) => a.task.start_date.localeCompare(b.task.start_date));
}

/** New, unticked checklist rows for the ready-made list that matches each step. Steps that already have a list are skipped. */
export function standardChecksFor(tasks: Pick<Task, 'id' | 'job_id' | 'name'>[], existing: Pick<StepCheck, 'task_id'>[] = []): Omit<StepCheck, 'id'>[] {
  const has = new Set(existing.map((c) => c.task_id));
  return tasks.flatMap((t) => {
    const std = has.has(t.id) ? undefined : standardFor(t.name);
    return std ? std.items.map((label, sort) => ({ job_id: t.job_id, task_id: t.id, label, done: false, done_at: null, done_by: '', sort })) : [];
  });
}
