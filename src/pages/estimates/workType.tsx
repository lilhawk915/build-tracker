import { useData } from '../../data';

export const WORK_TYPE_HINT = 'Custom home, Insulation, Mold remediation…';

/** What the Estimates list shows as the type: the words typed in, or the old House / Custom label. */
export function workTypeText(e: { work_type?: string; kind: 'custom' | 'house' }): string {
  return e.work_type?.trim() || (e.kind === 'house' ? 'House' : 'Custom');
}

/** Suggestions for "Type of work": a few common ones plus every type already used. */
export function WorkTypeList() {
  const { data } = useData();
  const used = data.estimates.map((e) => (e as { work_type?: string }).work_type?.trim() ?? '').filter(Boolean);
  const all = [...new Set([...used, 'Custom home', 'Insulation', 'Mold remediation', 'Crawlspace encapsulation', 'Concrete', 'Drywall', 'Remodel'])];
  return <datalist id="work-types">{all.sort((a, b) => a.localeCompare(b)).map((t) => <option key={t} value={t} />)}</datalist>;
}
