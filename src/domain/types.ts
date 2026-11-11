// Row shapes match supabase/migrations/0001_init.sql. Money is integer cents.
export type Role = 'admin' | 'staff' | 'crew' | 'sub' | 'none';
export type ContactStatus = 'not_contacted' | 'contacted' | 'confirmed';
export type MaterialStatus = 'needed' | 'ordered' | 'arrived';
export type JobStatus = 'planning' | 'active' | 'closed';
export type PoStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'closed';
export type BillStatus = 'submitted' | 'approved' | 'rejected' | 'paid';
export type CoStatus = 'pending' | 'approved' | 'rejected';
export type DrawStatus = 'draft' | 'requested' | 'funded';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type WaiverKind =
  | 'conditional_progress'
  | 'unconditional_progress'
  | 'conditional_final'
  | 'unconditional_final';

import type { AutoTextSettings } from '../../supabase/functions/_shared/autotext';
import type { CatalogRow, CompanyRow, EstimateRow, MarkupDefaultsRow, MarkupsRow } from '../estimator/convert';
import type { CatalogItem as EstCatalogItem, Project as EstProject, Settings as EstSettings } from '../estimator/domain/types';

export interface EstimateVersionRow {
  id: string; estimate_id: string; label: string; created_at: string;
  data: { project: EstProject; catalog: EstCatalogItem[]; settings: EstSettings };
}
export interface Expense {
  id: string; job_id: string; budget_line_id: string | null; expense_date: string; vendor_name: string; description: string;
  category: string; amount_cents: number; paid: boolean; file_path: string | null;
}

export type JobType = 'spec' | 'client' | 'flip' | 'remodel' | 'addition' | 'repair' | 'other';
export const JOB_TYPES: { value: JobType; label: string }[] = [
  { value: 'spec', label: 'Spec home' },
  { value: 'client', label: 'Client build' },
  { value: 'flip', label: 'Flip' },
  { value: 'remodel', label: 'Remodel' },
  { value: 'addition', label: 'Addition' },
  { value: 'repair', label: 'Repair or small job' },
  { value: 'other', label: 'Other' },
];
export const isNewHouse = (t: JobType) => t === 'spec' || t === 'client';
// Jobs you own and sell, as opposed to work a customer pays you for.
export const isOwnProject = (t: JobType) => t === 'spec' || t === 'flip';

export interface Vendor {
  id: string; name: string; trade: string;
  coi_expires: string | null; w9_on_file: boolean; notes: string;
}
export interface VendorContact {
  id: string; vendor_id: string; name: string; title: string; mobile: string; office_phone: string; email: string;
  address: string; notes: string; is_primary: boolean; auto_text_ok?: boolean;
}
export interface AutoTextLog {
  id: string; task_id: string | null; job_id: string | null; vendor_id: string | null; kind: 'notice' | 'reminder'; start_date: string;
  recipient: string; phone: string; body: string; status: 'accepted' | 'failed'; error: string; created_at: string;
}
export const canSeeContacts = (p: Pick<Profile, 'role' | 'can_view_contacts'>) => p.role === 'admin' || (p.role === 'staff' && Boolean(p.can_view_contacts));
export interface MaterialRequest {
  id: string; job_id: string; name: string; quantity: string; status: MaterialStatus; needed_by: string | null;
  expected_date: string | null; arrived_date: string | null; notes: string;
}
export interface Profile { id: string; email: string; name: string; role: Role; vendor_id: string | null; phone?: string; can_view_contacts?: boolean }
export interface Invite { email: string; role: Exclude<Role, 'none'>; vendor_id: string | null }
export interface Job {
  id: string; name: string; address: string; job_type: JobType; status: JobStatus;
  sale_price_cents: number; loan_amount_cents: number; lender: string;
  start_date: string | null; target_finish: string | null; notes: string;
  type_note?: string; client_name?: string; client_phone?: string; client_email?: string; plan_name?: string; permit_number?: string;
  square_feet?: number | null; bedrooms?: number | null; bathrooms?: number | null; stories?: number | null;
  finish_date?: string | null;
}
export interface BudgetLine {
  id: string; job_id: string; code: string; name: string; budget_cents: number; bought_out: boolean; sort: number;
}
export interface Po {
  id: string; job_id: string; vendor_id: string; budget_line_id: string; number: number; description: string;
  amount_cents: number; approved_co_cents: number; status: PoStatus;
}
export interface Bill {
  id: string; job_id: string; vendor_id: string; po_id: string | null; budget_line_id: string; invoice_no: string;
  amount_cents: number; bill_date: string; status: BillStatus; notes: string; file_path: string | null;
  paid_date: string | null; override_reason: string | null;
}
export interface ChangeOrder {
  id: string; job_id: string; budget_line_id: string; po_id: string | null; number: number; description: string;
  cost_delta_cents: number; price_delta_cents: number; status: CoStatus;
}
export interface Draw {
  id: string; job_id: string; number: number; status: DrawStatus; requested_date: string | null;
  funded_date: string | null; funded_cents: number; notes: string;
}
export interface DrawLine { id: string; draw_id: string; budget_line_id: string; amount_cents: number }
export interface Waiver {
  id: string; job_id: string; vendor_id: string; bill_id: string | null; kind: WaiverKind; amount_cents: number;
  through_date: string | null; status: 'requested' | 'received'; file_path: string | null;
}
export interface Task {
  id: string; job_id: string; vendor_id: string | null; name: string; start_date: string; end_date: string;
  depends_on: string | null; status: TaskStatus; notes: string; sort: number;
  assigned_to?: string | null; contact_status: ContactStatus;
}
export interface DailyLog { id: string; job_id: string; log_date: string; weather: string; notes: string; author: string }
export interface Photo {
  id: string; job_id: string; vendor_id: string | null; task_id: string | null; file_path: string; caption: string;
  review_status: 'pending' | 'approved' | 'rejected'; review_note: string;
}
export interface Selection {
  id: string; job_id: string; category: string; room: string; item: string; brand: string; color_name: string;
  color_code: string; finish: string; supplier: string; vendor_id: string | null; notes: string; file_path: string | null;
}
export interface Document {
  id: string; job_id: string; category: string; title: string; file_path: string; file_name: string; revision: string;
  doc_date: string | null; notes: string;
}
export interface JobStep {
  id: string; job_id: string; step: string; vendor_id: string | null; other_name: string; start_date: string | null;
  end_date: string | null; cost_cents: number | null; notes: string;
}
export interface ScopeItem {
  id: string; job_id: string; title: string; location: string; details: string; status: TaskStatus; sort: number;
}
export interface Material {
  id: string; job_id: string; name: string; quantity: string; supplier: string; order_number: string; status: MaterialStatus;
  needed_by: string | null; ordered_date: string | null; expected_date: string | null; arrived_date: string | null;
  cost_cents: number | null; notes: string; requested_by?: string | null; requested_by_name?: string;
}
export interface Notification {
  id: string; job_id: string; task_id: string | null; recipient: string; channel: 'text' | 'email' | 'call'; body: string;
}
export interface SubJob { id: string; name: string; address: string }

export interface Tables {
  vendors: Vendor; profiles: Profile; team_invites: Invite; jobs: Job; budget_lines: BudgetLine; pos: Po; bills: Bill;
  change_orders: ChangeOrder; draws: Draw; draw_lines: DrawLine; lien_waivers: Waiver; tasks: Task;
  daily_logs: DailyLog; photos: Photo; selections: Selection; documents: Document; job_steps: JobStep;
  scope_items: ScopeItem; materials: Material; notifications: Notification; vendor_contacts: VendorContact;
  auto_text_settings: AutoTextSettings; auto_texts: AutoTextLog;
  estimates: EstimateRow; estimate_markups: MarkupsRow; estimate_versions: EstimateVersionRow; catalog_items: CatalogRow;
  company_settings: CompanyRow & { id: string }; markup_defaults: MarkupDefaultsRow & { id: string }; expenses: Expense;
}
export type TableName = keyof Tables;

export const jobTypeLabel = (j: Pick<Job, 'job_type' | 'type_note'>) => {
  const base = JOB_TYPES.find((t) => t.value === j.job_type)?.label ?? 'Other';
  return j.type_note ? `${base}: ${j.type_note}` : base;
};
