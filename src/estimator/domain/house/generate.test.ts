import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../catalog/seed';
import { DIVISIONS, type HouseInputs } from '../types';
import { defaultInputs, validUntil } from './defaults';
import { generateLines } from './generate';

const lines = (patch: Partial<HouseInputs> = {}) => generateLines({ ...defaultInputs(), ...patch });
const byKey = (patch: Partial<HouseInputs>, key: string) => lines(patch).find((l) => l.key === key);

describe('generateLines', () => {
  it('applies 10% waste and rounds up', () => {
    expect(byKey({}, 'roof.covering')?.qty).toBe(2043); // 1857.16 x 1.1 = 2042.9
    expect(byKey({}, 'exterior.siding')?.qty).toBe(2279); // 2071.8 x 1.1 = 2278.97
  });

  it('every line has a formula and a positive-or-zero whole quantity', () => {
    for (const l of lines()) {
      expect(l.formula.length).toBeGreaterThan(0);
      expect(Number.isInteger(l.qty)).toBe(true);
      expect(l.qty).toBeGreaterThanOrEqual(0);
    }
  });

  it('line keys are unique', () => {
    const keys = lines().map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('foundation choice swaps the lines', () => {
    const keys = (f: HouseInputs['foundation']) => lines({ foundation: f }).filter((l) => l.division === 'Foundation').map((l) => l.key);
    expect(keys('slab')).toEqual(['foundation.slab', 'foundation.garage_slab']);
    expect(keys('crawlspace')).toContain('foundation.crawl_wall');
    expect(keys('basement_unfinished')).toContain('foundation.waterproofing');
    expect(lines({ foundation: 'basement_finished' }).some((l) => l.key === 'interior.finished_basement')).toBe(true);
    expect(lines({ foundation: 'basement_unfinished' }).some((l) => l.key === 'interior.finished_basement')).toBe(false);
  });

  it('well and septic replace city hookups', () => {
    const keys = lines({ water: 'well', sewer: 'septic' }).map((l) => l.key);
    expect(keys).toContain('site.water_well');
    expect(keys).toContain('site.sewer_septic');
    expect(keys).not.toContain('site.water_city');
    expect(keys).not.toContain('site.sewer_city');
  });

  it('clearing adds a line only when chosen', () => {
    expect(lines({ clearing: 'none' }).some((l) => l.key.startsWith('site.clearing'))).toBe(false);
    expect(byKey({ clearing: 'heavy' }, 'site.clearing_heavy')?.qty).toBe(1);
  });

  it('roof material and siding keep a stable key when swapped, so your edits follow', () => {
    expect(byKey({ roofMaterial: 'metal' }, 'roof.covering')?.family).toBe('roof.metal');
    expect(byKey({ siding: 'brick' }, 'exterior.siding')?.family).toBe('exterior.siding_brick');
  });

  it('mini-split drops the ductwork', () => {
    expect(byKey({ hvac: 'mini_split' }, 'hvac.ductwork')).toBeUndefined();
    expect(byKey({ hvac: 'heat_pump' }, 'hvac.ductwork')?.qty).toBe(2000);
  });

  it('only wood siding gets exterior paint', () => {
    expect(byKey({ siding: 'vinyl' }, 'paint.exterior')).toBeUndefined();
    expect(byKey({ siding: 'wood' }, 'paint.exterior')?.qty).toBe(2072);
  });

  it('flooring: share of heated plus waste, or a typed sq ft', () => {
    expect(byKey({}, 'flooring.row.bedrooms')?.qty).toBe(880); // 2000 x 40% x 1.1
    const flooring = [{ id: 'a', name: 'Den', type: 'hardwood' as const, pct: 0, sqftOverride: 100 }];
    const row = byKey({ flooring }, 'flooring.row.a');
    expect(row?.qty).toBe(110);
    expect(row?.family).toBe('flooring.hardwood');
  });

  it('finish level sets the grade and trim level can differ', () => {
    const all = lines({ finish: 'premium', trimLevel: 'builder' });
    expect(all.find((l) => l.key === 'roof.covering')?.grade).toBe('premium');
    expect(all.find((l) => l.key === 'interior.baseboard')?.grade).toBe('builder');
    expect(lines({ finish: 'premium', trimLevel: null }).find((l) => l.key === 'interior.baseboard')?.grade).toBe('premium');
  });

  it('typed permits allowance becomes the price', () => {
    const l = byKey({ permitsAllowance: 4200 }, 'site.permits');
    expect(l?.materialUnit).toBe(4200);
    expect(l?.laborUnit).toBe(0);
    expect(byKey({ permitsAllowance: null }, 'site.permits')?.materialUnit).toBeUndefined();
  });

  it('every option maps to a seeded catalog item', () => {
    const ids = new Set(seedCatalog().map((i) => i.id.replace(/\.(builder|mid|premium)$/, '')));
    const variants: Partial<HouseInputs>[] = [
      {},
      { foundation: 'slab', clearing: 'light', roofMaterial: 'metal', siding: 'fiber_cement', hvac: 'heat_pump', waterHeater: 'tankless', electricalService: 100, water: 'well', sewer: 'septic' },
      { foundation: 'basement_finished', clearing: 'heavy', siding: 'brick', hvac: 'mini_split', waterHeater: 'electric_tank', electricalService: 150 },
      { foundation: 'basement_unfinished', siding: 'wood', electricalService: 320 },
      { electricalService: 400 },
    ];
    for (const v of variants) {
      for (const l of lines({ ...v, flooring: (['carpet', 'lvp', 'hardwood', 'tile'] as const).map((type) => ({ id: type, name: type, type, pct: 25, sqftOverride: null })) })) {
        expect(ids.has(l.family), l.family).toBe(true);
      }
    }
  });

  it('generated lines use units that match the seeded item', () => {
    const units = new Map(seedCatalog().map((i) => [i.id.replace(/\.(builder|mid|premium)$/, ''), i.unit]));
    for (const l of lines()) expect(units.get(l.family), l.key).toBe(l.unit);
  });

  it('all divisions used are valid', () => {
    for (const l of lines()) expect(DIVISIONS).toContain(l.division);
  });
});

describe('seed catalog', () => {
  const seed = seedCatalog();
  it('every seed item is unverified and labelled placeholder', () => {
    for (const i of seed) {
      expect(i.verified).toBe(false);
      expect(i.notes).toContain('PLACEHOLDER');
    }
  });
  it('ids are unique', () => {
    expect(new Set(seed.map((i) => i.id)).size).toBe(seed.length);
  });
  it('every division has at least one item', () => {
    for (const d of DIVISIONS) expect(seed.some((i) => i.division === d), d).toBe(true);
  });
});

describe('validUntil', () => {
  it('adds days across month and year ends', () => {
    expect(validUntil('2026-11-09', 30)).toBe('2026-12-09');
    expect(validUntil('2026-12-20', 30)).toBe('2027-01-19');
  });
  it('returns blank for a blank date', () => {
    expect(validUntil('', 30)).toBe('');
  });
});
