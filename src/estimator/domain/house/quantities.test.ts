import { describe, expect, it } from 'vitest';
import { defaultInputs } from './defaults';
import { deriveQuantities, finishedBasement, roundUp } from './quantities';
import type { HouseInputs } from '../types';

const base = (patch: Partial<HouseInputs> = {}): HouseInputs => ({ ...defaultInputs(), ...patch });

describe('deriveQuantities: 2,000 sqft, 2 story, 6/12, 12" overhang, 2-bay garage', () => {
  const q = deriveQuantities(base());

  it('footprint is heated divided by stories', () => {
    expect(q.footprint.value).toBe(1000);
  });
  it('perimeter matches a 1.5:1 rectangle (25.82 x 38.73 ft)', () => {
    expect(q.perimeter.value).toBeCloseTo(129.1, 1);
  });
  it('roof area includes garage, overhang and pitch', () => {
    // (1000 + 528 + 129.1 x 1 + 4) x sqrt(1 + 0.25) = 1661.1 x 1.11803
    expect(q.roofArea.value).toBeCloseTo(1857.16, 1);
  });
  it('exterior wall area is perimeter x height x stories', () => {
    expect(q.exteriorWallArea.value).toBeCloseTo(2323.8, 1);
  });
  it('siding deducts 14 windows and 2 doors', () => {
    expect(q.sidingArea.value).toBeCloseTo(2323.8 - 210 - 42, 1);
  });
  it('drywall is walls + both sides of partitions + ceilings', () => {
    expect(q.drywallArea.value).toBeCloseTo(2323.8 + 3600 + 2000, 1);
  });
  it('fixtures: 2 full x 3 + 1 half x 2 + 2 kitchen + 1 laundry', () => {
    expect(q.fixtures.value).toBe(11);
  });
  it('doors: 3 beds x 2 + 3 baths + 3', () => {
    expect(q.interiorDoors.value).toBe(12);
  });
  it('one flight of stairs, no basement', () => {
    expect(q.stairs.value).toBe(1);
  });
  it('crawlspace frames both floors', () => {
    expect(q.floorDeck.value).toBe(2000);
  });
  it('two dumpsters', () => {
    expect(q.dumpsters.value).toBe(2);
  });
});

describe('footprint and basement', () => {
  it('finished basement comes off the above-grade footprint', () => {
    const q = deriveQuantities(base({ foundation: 'basement_finished', finishedBasementSqft: 500 }));
    expect(q.footprint.value).toBe(750);
  });
  it('finished basement sq ft is ignored for other foundations', () => {
    expect(finishedBasement(base({ foundation: 'slab', finishedBasementSqft: 500 }))).toBe(0);
    expect(deriveQuantities(base({ foundation: 'basement_unfinished', finishedBasementSqft: 500 })).footprint.value).toBe(1000);
  });
  it('finished basement cannot exceed heated area', () => {
    expect(finishedBasement(base({ foundation: 'basement_finished', finishedBasementSqft: 9000 }))).toBe(2000);
  });
  it('basement adds a flight of stairs and slab removes a framed floor', () => {
    expect(deriveQuantities(base({ foundation: 'basement_unfinished' })).stairs.value).toBe(2);
    expect(deriveQuantities(base({ foundation: 'slab' })).floorDeck.value).toBe(1000);
  });
});

describe('overrides', () => {
  it('footprint override flows into perimeter', () => {
    const q = deriveQuantities(base({ footprintOverride: 1500 }));
    expect(q.footprint.value).toBe(1500);
    expect(q.perimeter.value).toBeCloseTo(5 * Math.sqrt(1000), 5);
    expect(q.footprint.formula).toContain('typed in');
  });
  it('perimeter, roof, fixtures and door overrides win', () => {
    const q = deriveQuantities(
      base({ perimeterOverride: 200, roofAreaOverride: 3000, fixturesOverride: 20, interiorDoorsOverride: 25 }),
    );
    expect(q.perimeter.value).toBe(200);
    expect(q.roofArea.value).toBe(3000);
    expect(q.fixtures.value).toBe(20);
    expect(q.interiorDoors.value).toBe(25);
  });
});

describe('bad input never produces NaN or negatives', () => {
  it('zero and negative values', () => {
    const q = deriveQuantities(base({ heatedSqft: 0, stories: 0, wallHeightFt: -9, windows: 500 }));
    for (const v of Object.values(q)) {
      expect(Number.isFinite(v.value)).toBe(true);
      expect(v.value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('roundUp', () => {
  it('ignores floating-point dust', () => {
    expect(roundUp(100.00000000001)).toBe(100);
    expect(roundUp(100.01)).toBe(101);
  });
});

describe('formulas show the real numbers', () => {
  it('footprint formula', () => {
    expect(deriveQuantities(base()).footprint.formula).toContain('2,000 heated');
  });
});
