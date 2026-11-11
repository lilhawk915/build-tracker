export const DIVISIONS = [
  'Site',
  'Foundation',
  'Framing',
  'Roofing',
  'Exterior',
  'Windows/Doors',
  'Plumbing',
  'HVAC',
  'Electrical',
  'Insulation/Drywall',
  'Interior Finishes',
  'Flooring',
  'Kitchen',
  'Baths',
  'Paint',
  'Cleanup/Misc',
] as const;
export type Division = (typeof DIVISIONS)[number];

export const UNITS = ['sqft', 'LF', 'each', 'box', 'allowance', 'lump sum'] as const;
export type Unit = (typeof UNITS)[number];

export const GRADES = ['builder', 'mid', 'premium'] as const;
export type Grade = (typeof GRADES)[number];

export interface CatalogItem {
  /** Graded items use "<family>.<grade>", e.g. "roof.shingle.mid". Others use just the family. */
  id: string;
  division: Division;
  name: string;
  unit: Unit;
  /** Material cost per unit. */
  unitCost: number;
  /** Labor cost per unit. */
  laborCost: number;
  grade: Grade;
  notes: string;
  verified: boolean;
}

export interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  license: string;
  logoDataUrl: string | null;
}

export interface Settings {
  overheadPct: number;
  profitPct: number;
  contingencyPct: number;
  salesTaxPct: number;
  company: CompanyInfo;
  defaultAssumptions: string;
  defaultValidityDays: number;
}

export type Foundation = 'slab' | 'crawlspace' | 'basement_unfinished' | 'basement_finished';
export type RoofMaterial = 'shingle' | 'metal';
export type Siding = 'vinyl' | 'fiber_cement' | 'brick' | 'wood';
export type FlooringType = 'carpet' | 'lvp' | 'hardwood' | 'tile';
export type Hvac = 'gas_furnace_ac' | 'heat_pump' | 'mini_split';
export type WaterHeater = 'gas_tank' | 'electric_tank' | 'tankless';
export type ElectricalService = 100 | 150 | 200 | 320 | 400;
export type Clearing = 'none' | 'light' | 'heavy';

export interface FlooringArea {
  id: string;
  name: string;
  type: FlooringType;
  /** Share of heated sq ft this area covers. */
  pct: number;
  /** When set, replaces the share calculation. */
  sqftOverride: number | null;
}

export interface HouseInputs {
  finish: Grade;
  wastePct: number;
  heatedSqft: number;
  stories: number;
  footprintOverride: number | null;
  perimeterOverride: number | null;
  wallHeightFt: number;
  foundation: Foundation;
  finishedBasementSqft: number;
  roofPitch: number;
  roofMaterial: RoofMaterial;
  overhangIn: number;
  roofAreaOverride: number | null;
  siding: Siding;
  windows: number;
  exteriorDoors: number;
  garageBays: number;
  garageSqftPerBay: number;
  porchDeckSqft: number;
  bedrooms: number;
  fullBaths: number;
  halfBaths: number;
  flooring: FlooringArea[];
  trimLevel: Grade | null;
  interiorDoorsOverride: number | null;
  hvac: Hvac;
  waterHeater: WaterHeater;
  electricalService: ElectricalService;
  fixturesOverride: number | null;
  clearing: Clearing;
  drivewaySqft: number;
  water: 'city' | 'well';
  sewer: 'city' | 'septic';
  permitsAllowance: number | null;
}

/** Your manual changes to a line. A missing field means "use the calculated value". */
export interface LineEdit {
  name?: string;
  /** Moves the line to another division. */
  division?: Division;
  qty?: number;
  unit?: Unit;
  materialUnit?: number;
  laborUnit?: number;
  grade?: Grade;
  catalogItemId?: string;
  deleted?: boolean;
}

export interface CustomLine {
  key: string;
  division: Division;
  name: string;
  unit: Unit;
  qty: number;
  catalogItemId: string | null;
}

/** custom: only the lines you add. house: lines generated from the house inputs. */
export type ProjectKind = 'custom' | 'house';

/** Tax and markups for one quote. Profit is a percent, or a flat dollar amount when profitAmount is set. */
export interface Markups {
  salesTaxPct: number;
  contingencyPct: number;
  overheadPct: number;
  profitPct: number;
  profitAmount: number | null;
}

export const BILL_CATEGORIES = ['Material', 'Labor', 'Subcontractor', 'Equipment rental', 'Permit/fee', 'Other'] as const;
export type BillCategory = (typeof BILL_CATEGORIES)[number];

/** Money actually spent on the job. */
export interface Bill {
  id: string;
  date: string;
  vendor: string;
  description: string;
  category: BillCategory;
  amount: number;
  paid: boolean;
}

/** A material or finish that went into the job: paint color, tile, fixture, concrete mix. */
export interface Selection {
  id: string;
  category: string;
  area: string;
  product: string;
  color: string;
  finish: string;
  supplier: string;
  quantity: string;
  notes: string;
}

export interface LogEntry {
  id: string;
  date: string;
  text: string;
}

/** What actually happened on the job, as opposed to what was quoted. */
export interface JobRecord {
  bills: Bill[];
  selections: Selection[];
  log: LogEntry[];
}

/** An attached photo, receipt or drawing. The file itself is stored separately, by id. */
export interface FileMeta {
  id: string;
  projectId: string;
  /** Set when the file is a bill's receipt. */
  billId: string | null;
  name: string;
  type: string;
  size: number;
  addedAt: string;
}

export interface Project {
  id: string;
  kind: ProjectKind;
  record: JobRecord;
  /** Missing only on projects saved before markups moved onto each quote; those use the settings they were saved with. */
  markups?: Markups;
  clientName: string;
  address: string;
  date: string;
  notes: string;
  inputs: HouseInputs;
  lineEdits: Record<string, LineEdit>;
  customLines: CustomLine[];
  assumptions: string;
  validityDays: number;
  createdAt: string;
  updatedAt: string;
}

/** A frozen copy of a project and the prices and settings in force when it was saved. */
export interface Snapshot {
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
  project: Project;
  catalog: CatalogItem[];
  settings: Settings;
}

/** A line calculated from the house inputs, before your edits and catalog prices apply. */
export interface GeneratedLine {
  key: string;
  division: Division;
  family: string;
  label: string;
  qty: number;
  unit: Unit;
  formula: string;
  grade: Grade;
  /** Price typed in the inputs panel, such as the permits allowance. */
  materialUnit?: number;
  laborUnit?: number;
}

export interface ResolvedLine {
  key: string;
  source: 'auto' | 'custom';
  division: Division;
  name: string;
  unit: Unit;
  qty: number;
  formula: string | null;
  grade: Grade;
  hasGrades: boolean;
  catalogItemId: string | null;
  materialUnit: number;
  laborUnit: number;
  material: number;
  labor: number;
  total: number;
  edited: {
    name: boolean;
    division: boolean;
    qty: boolean;
    unit: boolean;
    materialUnit: boolean;
    laborUnit: boolean;
    grade: boolean;
    catalogItem: boolean;
  };
  unverified: boolean;
  warnings: string[];
}

export interface Totals {
  material: number;
  labor: number;
  tax: number;
  subtotal: number;
  contingency: number;
  overhead: number;
  profit: number;
  grandTotal: number;
  costPerSqft: number;
}

export interface DivisionSummary {
  division: Division;
  material: number;
  labor: number;
  /** Material + labor, before tax and markups. */
  direct: number;
  /** This division's share of the grand total, with tax and markups rolled in. */
  clientAmount: number;
}
