import { useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { FormModal, HealthChip, money, Status } from '../components/ui';
import { store, useData } from '../data';
import { jobTypeLabel } from '../domain/types';
import { BillsTab } from './tabs/BillsTab';
import { BudgetTab } from './tabs/BudgetTab';
import { ChangesTab } from './tabs/ChangesTab';
import { ContractorsTab } from './tabs/ContractorsTab';
import { DrawsTab } from './tabs/DrawsTab';
import { MaterialsTab } from './tabs/MaterialsTab';
import { ScopeTab } from './tabs/ScopeTab';
import { FilesTab } from './tabs/FilesTab';
import { InvoicesTab } from './tabs/InvoicesTab';
import { RecordTab } from './tabs/RecordTab';
import { SelectionsTab } from './tabs/SelectionsTab';
import { LogTab } from './tabs/LogTab';
import { PosTab } from './tabs/PosTab';
import { ScheduleTab } from './tabs/ScheduleTab';
import { WaiversTab } from './tabs/WaiversTab';
import { jobFields } from './jobFields';

const TABS = [
  ['record', 'Job record'], ['scope', 'What it needs'], ['schedule', 'Schedule'], ['contractors', 'Contractors'],
  ['materials', 'Materials'], ['budget', 'Budget'], ['pos', 'POs'], ['bills', 'Bills'], ['waivers', 'Lien waivers'],
  ['changes', 'Change orders'], ['draws', 'Draws'], ['selections', 'Colors and selections'], ['files', 'Drawings and files'],
  ['log', 'Site log'],
] as const;

export function JobPage() {
  const { jobId, tab: tabParam } = useParams();
  const { data, run, me } = useData();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const job = data.jobs.find((j) => j.id === jobId);
  if (!job) return <div className="alert" role="alert">This job no longer exists or you don't have access to it.</div>;

  const tab = tabParam ?? (job.status === 'closed' ? 'record' : 'budget');

  return (
    <div>
      <div className="jobhead noprint">
        <div>
          <h1>{job.name}</h1>
          <p className="muted">
            {job.address || 'No address yet'} · {jobTypeLabel(job)}
            {job.target_finish && ` · Target finish ${job.target_finish}`}
            {job.lender && ` · ${job.lender}${job.loan_amount_cents ? ` ${money(job.loan_amount_cents)}` : ''}`}
          </p>
        </div>
        <div className="row">
          {job.status !== 'closed' && <HealthChip job={job} />}
          <Status s={job.status} />
          <button className="btn" onClick={() => setEditing(true)}>Edit job</button>
        </div>
      </div>
      <nav className="tabs" aria-label="Job sections">
        {[...TABS, ...(me.role === 'admin' ? [['invoices', 'Invoices'] as const] : [])].map(([k, label]) => (
          <NavLink key={k} to={`/jobs/${job.id}/${k}`} className={tab === k ? 'active' : ''}>{label}</NavLink>
        ))}
      </nav>
      {tab === 'scope' && <ScopeTab job={job} />}
      {tab === 'materials' && <MaterialsTab job={job} />}
      {tab === 'contractors' && <ContractorsTab job={job} />}
      {tab === 'record' && <RecordTab job={job} />}
      {tab === 'selections' && <SelectionsTab job={job} />}
      {tab === 'files' && <FilesTab job={job} />}
      {tab === 'invoices' && me.role === 'admin' && <InvoicesTab job={job} />}
      {tab === 'budget' && <BudgetTab job={job} />}
      {tab === 'schedule' && <ScheduleTab job={job} />}
      {tab === 'pos' && <PosTab job={job} />}
      {tab === 'bills' && <BillsTab job={job} />}
      {tab === 'waivers' && <WaiversTab job={job} />}
      {tab === 'changes' && <ChangesTab job={job} />}
      {tab === 'draws' && <DrawsTab job={job} />}
      {tab === 'log' && <LogTab job={job} />}
      {editing && (
        <FormModal
          title="Edit job"
          submit="Save job"
          fields={jobFields}
          initial={job as never}
          onClose={() => setEditing(false)}
          intro={me.role === 'admin' ? (
            <button
              type="button"
              className="btn danger tiny"
              style={{ justifySelf: 'start' }}
              onClick={async () => {
                if (!window.confirm(`Delete ${job.name} with its budget, bills, waivers, draws, and schedule? This cannot be undone.`)) return;
                const ok = await run(() => store.remove('jobs', job.id), 'Job deleted.');
                if (ok) nav('/');
              }}
            >
              Delete this job
            </button>
          ) : undefined}
          onSave={async (v) => {
            const ok = await run(() => store.update('jobs', job.id, v as never), 'Job saved.');
            if (ok) setEditing(false);
          }}
        />
      )}
    </div>
  );
}
