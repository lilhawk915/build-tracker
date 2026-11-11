import { describe, expect, it } from 'vitest';
import { defaultSettings, newProject } from '../house/defaults';
import type { Bill, Project } from '../types';
import { billsToCsv, emptyRecord, matchedIn, projectMatches, summarizeRecord } from './record';

const bill = (amount: number, category: Bill['category'] = 'Material', paid = true, extra: Partial<Bill> = {}): Bill => ({
  id: String(Math.random()),
  date: '2026-11-10',
  vendor: 'Ready Mix Co',
  description: 'Concrete',
  category,
  amount,
  paid,
  ...extra,
});

describe('summarizeRecord: quoted vs actual', () => {
  const totals = { grandTotal: 9800, profit: 4900 };

  it('nothing spent yet: actual profit is the whole price', () => {
    const s = summarizeRecord(emptyRecord(), totals);
    expect(s.spent).toBe(0);
    expect(s.actualProfit).toBe(9800);
    expect(s.estimatedCost).toBe(4900);
    expect(s.overEstimate).toBe(-4900);
  });

  it('Sample Rd on budget', () => {
    const s = summarizeRecord({ ...emptyRecord(), bills: [bill(3000), bill(500), bill(1400, 'Labor')] }, totals);
    expect(s.spent).toBe(4900);
    expect(s.actualProfit).toBe(4900);
    expect(s.overEstimate).toBe(0);
    expect(s.byCategory).toEqual([
      { category: 'Material', amount: 3500 },
      { category: 'Labor', amount: 1400 },
    ]);
  });

  it('over budget shows less profit', () => {
    const s = summarizeRecord({ ...emptyRecord(), bills: [bill(3333.33), bill(2000.01, 'Labor', false)] }, totals);
    expect(s.spent).toBe(5333.34);
    expect(s.actualProfit).toBe(4466.66);
    expect(s.overEstimate).toBe(433.34);
    expect(s.unpaid).toBe(2000.01);
  });

  it('a bad amount counts as zero instead of breaking the totals', () => {
    expect(summarizeRecord({ ...emptyRecord(), bills: [bill(NaN), bill(10)] }, totals).spent).toBe(10);
  });
});

describe('billsToCsv', () => {
  it('sorted by date with paid flag', () => {
    const csv = billsToCsv([bill(5, 'Labor', false, { date: '2026-11-12', vendor: 'B' }), bill(7, 'Material', true, { date: '2026-11-01', vendor: 'A, Inc' })]);
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('Date,Vendor,Description,Category,Amount,Paid');
    expect(rows[1]).toBe('2026-11-01,"A, Inc",Concrete,Material,7,yes');
    expect(rows[2]).toBe('2026-11-12,B,Concrete,Labor,5,no');
  });
});

describe('search', () => {
  const p: Project = {
    ...newProject('s', defaultSettings(), 'now'),
    clientName: 'Smith',
    address: '100 Sample Rd',
    record: {
      bills: [bill(100, 'Material', true, { vendor: 'Sherwin-Williams' })],
      selections: [
        { id: '1', category: 'Paint', area: 'Living room', product: 'Emerald interior', color: 'Agreeable Gray SW 7029', finish: 'Eggshell', supplier: 'Sherwin-Williams', quantity: '3 gal', notes: '' },
      ],
      log: [{ id: 'l', date: '2026-11-10', text: 'Poured the big pad' }],
    },
  };
  it('finds a paint color by code or name, any case', () => {
    expect(projectMatches(p, 'sw 7029')).toBe(true);
    expect(projectMatches(p, 'agreeable')).toBe(true);
    expect(projectMatches(p, 'AGREEABLE gray')).toBe(true);
  });
  it('every word must match', () => {
    expect(projectMatches(p, 'agreeable sample')).toBe(true);
    expect(projectMatches(p, 'agreeable blue')).toBe(false);
  });
  it('blank search matches everything', () => {
    expect(projectMatches(p, '  ')).toBe(true);
  });
  it('says where it matched', () => {
    expect(matchedIn(p, 'sherwin')).toEqual(['materials', 'bills']);
    expect(matchedIn(p, 'poured')).toEqual(['job log']);
    expect(matchedIn(p, 'sample')).toEqual([]);
  });
});
