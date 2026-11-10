import type { FieldDef } from '../components/ui';
import { JOB_TYPES } from '../domain/types';

export const jobFields: FieldDef[] = [
  { key: 'name', label: 'Job name', required: true },
  { key: 'address', label: 'Address' },
  { key: 'job_type', label: 'Type', type: 'select', options: JOB_TYPES },
  { key: 'type_note', label: 'What kind of job', help: 'Optional. Deck, roof replacement, storm damage…' },
  { key: 'status', label: 'Status', type: 'select', options: [{ value: 'planning', label: 'Planning' }, { value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }] },
  { key: 'sale_price_cents', label: 'Contract or expected sale price', help: 'Leave the fields below blank if they do not apply to this job.', type: 'money' },
  { key: 'loan_amount_cents', label: 'Construction loan amount', type: 'money' },
  { key: 'lender', label: 'Lender' },
  { key: 'start_date', label: 'Start date', type: 'date' },
  { key: 'target_finish', label: 'Target finish', type: 'date' },
  { key: 'finish_date', label: 'Actual finish', type: 'date' },
  { key: 'client_name', label: 'Client or buyer' },
  { key: 'client_phone', label: 'Client phone' },
  { key: 'client_email', label: 'Client email', type: 'email' },
  { key: 'plan_name', label: 'Floor plan name' },
  { key: 'square_feet', label: 'Square feet', type: 'number' },
  { key: 'bedrooms', label: 'Bedrooms', type: 'number' },
  { key: 'bathrooms', label: 'Bathrooms', type: 'number' },
  { key: 'stories', label: 'Stories', type: 'number' },
  { key: 'permit_number', label: 'Permit number' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];
