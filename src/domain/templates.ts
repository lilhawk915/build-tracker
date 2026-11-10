import { addDays } from './schedule';
import type { BudgetLine, Task } from './types';

// Starter list for a new house. Budgets start at $0. Durations are placeholders to edit per job.
const STEPS: { code: string; name: string; task?: string; days?: number }[] = [
  { code: '01', name: 'Land and closing costs' },
  { code: '02', name: 'Plans and engineering' },
  { code: '03', name: 'Permits and fees', task: 'Pull permits', days: 14 },
  { code: '04', name: 'Excavation and site work', task: 'Clear lot and excavate', days: 5 },
  { code: '05', name: 'Septic, well, or utility tap', task: 'Utility connections', days: 5 },
  { code: '06', name: 'Foundation', task: 'Pour footers and foundation', days: 10 },
  { code: '07', name: 'Framing', task: 'Frame house', days: 15 },
  { code: '08', name: 'Roofing', task: 'Dry-in and roof', days: 4 },
  { code: '09', name: 'Windows and exterior doors', task: 'Set windows and doors', days: 3 },
  { code: '10', name: 'Plumbing', task: 'Rough plumbing', days: 5 },
  { code: '11', name: 'HVAC', task: 'Rough HVAC', days: 5 },
  { code: '12', name: 'Electrical', task: 'Rough electrical', days: 5 },
  { code: '13', name: 'Siding and exterior', task: 'Siding and exterior trim', days: 10 },
  { code: '14', name: 'Insulation', task: 'Rough inspections and insulation', days: 4 },
  { code: '15', name: 'Drywall', task: 'Hang and finish drywall', days: 10 },
  { code: '16', name: 'Interior trim and doors', task: 'Interior trim', days: 7 },
  { code: '17', name: 'Cabinets and countertops', task: 'Cabinets and countertops', days: 7 },
  { code: '18', name: 'Paint', task: 'Paint', days: 6 },
  { code: '19', name: 'Flooring and tile', task: 'Flooring and tile', days: 8 },
  { code: '20', name: 'Appliances and fixtures', task: 'Finish plumbing, electrical, HVAC', days: 5 },
  { code: '21', name: 'Driveway, flatwork, and landscaping', task: 'Driveway and landscaping', days: 6 },
  { code: '22', name: 'Cleaning and punch list', task: 'Final clean and punch list', days: 5 },
  { code: '23', name: 'Final inspections', task: 'Final inspection and occupancy', days: 3 },
  { code: '24', name: 'Loan interest and carrying costs' },
  { code: '25', name: 'Contingency' },
];

const uuid = () => crypto.randomUUID();

export function starterBudget(jobId: string): Omit<BudgetLine, never>[] {
  return STEPS.map((s, i) => ({
    id: uuid(), job_id: jobId, code: s.code, name: s.name, budget_cents: 0, bought_out: false, sort: i,
  }));
}

export function starterSchedule(jobId: string, start: string): Task[] {
  let cursor = start;
  let prev: string | null = null;
  const tasks: Task[] = [];
  for (const s of STEPS) {
    if (!s.task || !s.days) continue;
    const id = uuid();
    const end = addDays(cursor, s.days - 1);
    tasks.push({
      id, job_id: jobId, vendor_id: null, name: s.task, start_date: cursor, end_date: end,
      depends_on: prev, status: 'todo', notes: '', sort: tasks.length, contact_status: 'not_contacted',
    });
    prev = id;
    cursor = addDays(end, 1);
  }
  return tasks;
}
