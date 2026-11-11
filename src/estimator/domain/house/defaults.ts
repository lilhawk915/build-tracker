import type { HouseInputs, Project, ProjectKind, Settings } from '../types';
import { emptyRecord } from '../record/record';

export function defaultInputs(): HouseInputs {
  return {
    finish: 'mid',
    wastePct: 10,
    heatedSqft: 2000,
    stories: 2,
    footprintOverride: null,
    perimeterOverride: null,
    wallHeightFt: 9,
    foundation: 'crawlspace',
    finishedBasementSqft: 800,
    roofPitch: 6,
    roofMaterial: 'shingle',
    overhangIn: 12,
    roofAreaOverride: null,
    siding: 'vinyl',
    windows: 14,
    exteriorDoors: 2,
    garageBays: 2,
    garageSqftPerBay: 264,
    porchDeckSqft: 100,
    bedrooms: 3,
    fullBaths: 2,
    halfBaths: 1,
    flooring: [
      { id: 'bedrooms', name: 'Bedrooms', type: 'carpet', pct: 40, sqftOverride: null },
      { id: 'living', name: 'Living and kitchen', type: 'lvp', pct: 50, sqftOverride: null },
      { id: 'baths', name: 'Baths and laundry', type: 'tile', pct: 10, sqftOverride: null },
    ],
    trimLevel: null,
    interiorDoorsOverride: null,
    hvac: 'gas_furnace_ac',
    waterHeater: 'gas_tank',
    electricalService: 200,
    fixturesOverride: null,
    clearing: 'none',
    drivewaySqft: 600,
    water: 'city',
    sewer: 'city',
    permitsAllowance: null,
  };
}

export function defaultSettings(): Settings {
  return {
    overheadPct: 0,
    profitPct: 0,
    contingencyPct: 0,
    salesTaxPct: 0,
    company: { name: '', address: '', phone: '', email: '', license: '', logoDataUrl: null },
    defaultAssumptions:
      'DRAFT WORDING - EDIT BEFORE SENDING.\n\nAssumptions:\n- Price is based on the selections and quantities listed in this quote.\n- Normal working hours and clear site access.\n\nExclusions:\n- Anything not listed in this quote.\n- Changes requested after acceptance are priced as change orders.',
    defaultValidityDays: 30,
  };
}

export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function newProject(id: string, settings: Settings, now: string, kind: ProjectKind = 'custom'): Project {
  return {
    id,
    kind,
    record: emptyRecord(),
    markups: {
      salesTaxPct: settings.salesTaxPct,
      contingencyPct: settings.contingencyPct,
      overheadPct: settings.overheadPct,
      profitPct: settings.profitPct,
      profitAmount: null,
    },
    clientName: '',
    address: '',
    date: today(),
    notes: '',
    inputs: defaultInputs(),
    lineEdits: {},
    customLines: [],
    assumptions: settings.defaultAssumptions,
    validityDays: settings.defaultValidityDays,
    createdAt: now,
    updatedAt: now,
  };
}

/** Quote expiry date. Works on calendar dates so time zones can't shift it a day. */
export function validUntil(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d + Math.max(0, days))).toISOString().slice(0, 10);
}
