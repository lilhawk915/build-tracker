import { CallList } from '../components/CallList';
import { useData } from '../data';
import { CALL_WINDOW_DAYS, callList } from '../domain/jobops';
import { todayIso } from '../domain/rules';

export function CallsPage() {
  const { data } = useData();
  const open = new Set(data.jobs.filter((j) => j.status !== 'closed').map((j) => j.id));
  const rows = callList(data.tasks.filter((t) => open.has(t.job_id)), todayIso());
  return (
    <div className="stack">
      <h1>Call list</h1>
      <p className="muted">Contractors due on a job in the next {CALL_WINDOW_DAYS} days who haven't confirmed. If a date changes, they come back on this list.</p>
      <CallList tasks={rows} showJob emptyText={`Every contractor due in the next ${CALL_WINDOW_DAYS} days has confirmed.`} />
    </div>
  );
}
