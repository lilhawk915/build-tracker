import { CallList } from '../../components/CallList';
import { useData } from '../../data';
import type { Job } from '../../domain/types';

export function ContractorsTab({ job }: { job: Job }) {
  const { data } = useData();
  const rows = data.tasks
    .filter((t) => t.job_id === job.id && t.vendor_id && t.status !== 'done')
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  return (
    <div className="stack">
      <h2>Contractors</h2>
      <p className="muted">Everyone still due on this job. Assign subs to tasks on the Schedule tab.</p>
      <CallList tasks={rows} emptyText="No subs are assigned to open tasks yet. Assign them on the Schedule tab." />
    </div>
  );
}
