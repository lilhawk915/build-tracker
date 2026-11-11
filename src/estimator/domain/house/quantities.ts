import type { HouseInputs } from '../types';

export interface Quantity {
  value: number;
  formula: string;
}

export interface HouseQuantities {
  footprint: Quantity;
  perimeter: Quantity;
  garageArea: Quantity;
  roofArea: Quantity;
  exteriorWallArea: Quantity;
  sidingArea: Quantity;
  partitionLf: Quantity;
  drywallArea: Quantity;
  baseboardLf: Quantity;
  fixtures: Quantity;
  interiorDoors: Quantity;
  stairs: Quantity;
  floorDeck: Quantity;
  dumpsters: Quantity;
}

/** Rounds up to a whole unit, ignoring floating-point dust like 100.00000000001. */
export const roundUp = (n: number): number => Math.ceil(n - 1e-9);

export const fmt = (n: number): string =>
  n.toLocaleString('en-US', { maximumFractionDigits: 2 });

const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

/** Footprint is assumed to be a rectangle this many times longer than it is wide. */
export const ASSUMED_ASPECT_RATIO = 1.5;
/** Interior wall length per heated sq ft; a rule of thumb, shown in the formula. */
export const PARTITION_LF_PER_SQFT = 0.1;
export const WINDOW_DEDUCT_SQFT = 15;
export const DOOR_DEDUCT_SQFT = 21;
export const SQFT_PER_DUMPSTER = 1000;

export function finishedBasement(i: HouseInputs): number {
  if (i.foundation !== 'basement_finished') return 0;
  return Math.min(nonNeg(i.finishedBasementSqft), nonNeg(i.heatedSqft));
}

export function deriveQuantities(i: HouseInputs): HouseQuantities {
  const heated = nonNeg(i.heatedSqft);
  const stories = Math.max(1, nonNeg(i.stories));
  const wall = nonNeg(i.wallHeightFt);
  const basement = finishedBasement(i);

  const footprintCalc = (heated - basement) / stories;
  const footprint: Quantity =
    i.footprintOverride !== null
      ? { value: nonNeg(i.footprintOverride), formula: `Footprint typed in by you (calculated: ${fmt(footprintCalc)} sqft)` }
      : {
          value: footprintCalc,
          formula: `(${fmt(heated)} heated − ${fmt(basement)} finished basement) ÷ ${fmt(stories)} stories = ${fmt(footprintCalc)} sqft`,
        };
  const fp = footprint.value;

  const perimeterCalc = 2 * (1 + ASSUMED_ASPECT_RATIO) * Math.sqrt(fp / ASSUMED_ASPECT_RATIO);
  const perimeter: Quantity =
    i.perimeterOverride !== null
      ? { value: nonNeg(i.perimeterOverride), formula: `Perimeter typed in by you (calculated: ${fmt(perimeterCalc)} LF)` }
      : {
          value: perimeterCalc,
          formula: `Assumes a ${ASSUMED_ASPECT_RATIO}:1 rectangle: 2 × (1 + ${ASSUMED_ASPECT_RATIO}) × √(${fmt(fp)} ÷ ${ASSUMED_ASPECT_RATIO}) = ${fmt(perimeterCalc)} LF. Override it if the plan is cut up.`,
        };
  const per = perimeter.value;

  const bays = nonNeg(i.garageBays);
  const garageValue = bays * nonNeg(i.garageSqftPerBay);
  const garageArea: Quantity = {
    value: garageValue,
    formula: `${fmt(bays)} bays × ${fmt(nonNeg(i.garageSqftPerBay))} sqft per bay = ${fmt(garageValue)} sqft`,
  };

  const oh = nonNeg(i.overhangIn) / 12;
  const pitchFactor = Math.sqrt(1 + (nonNeg(i.roofPitch) / 12) ** 2);
  const roofPlan = fp + garageValue + per * oh + 4 * oh * oh;
  const roofCalc = roofPlan * pitchFactor;
  const roofArea: Quantity =
    i.roofAreaOverride !== null
      ? { value: nonNeg(i.roofAreaOverride), formula: `Roof area typed in by you (calculated: ${fmt(roofCalc)} sqft)` }
      : {
          value: roofCalc,
          formula: `Plan area (${fmt(fp)} footprint + ${fmt(garageValue)} garage + ${fmt(per)} LF × ${fmt(oh)} ft overhang + 4 corners × ${fmt(oh)}²) = ${fmt(roofPlan)} sqft; × pitch factor √(1 + (${fmt(nonNeg(i.roofPitch))}/12)²) = ${fmt(pitchFactor)}; total ${fmt(roofCalc)} sqft before waste`,
        };

  const wallValue = per * wall * stories;
  const exteriorWallArea: Quantity = {
    value: wallValue,
    formula: `${fmt(per)} LF perimeter × ${fmt(wall)} ft wall × ${fmt(stories)} stories = ${fmt(wallValue)} sqft (house only; garage walls are in the garage package)`,
  };

  const windows = nonNeg(i.windows);
  const doors = nonNeg(i.exteriorDoors);
  const sidingValue = Math.max(0, wallValue - windows * WINDOW_DEDUCT_SQFT - doors * DOOR_DEDUCT_SQFT);
  const sidingArea: Quantity = {
    value: sidingValue,
    formula: `${fmt(wallValue)} wall − ${fmt(windows)} windows × ${WINDOW_DEDUCT_SQFT} − ${fmt(doors)} doors × ${DOOR_DEDUCT_SQFT} = ${fmt(sidingValue)} sqft before waste`,
  };

  const partitionValue = heated * PARTITION_LF_PER_SQFT;
  const partitionLf: Quantity = {
    value: partitionValue,
    formula: `${fmt(heated)} heated × ${PARTITION_LF_PER_SQFT} LF per sqft (rule of thumb) = ${fmt(partitionValue)} LF`,
  };

  const basementShare = fp > 0 ? Math.min(1, basement / fp) : 0;
  const basementWalls = basementShare * per * wall;
  const drywallValue = wallValue + partitionValue * wall * 2 + heated + basementWalls;
  const drywallArea: Quantity = {
    value: drywallValue,
    formula: `${fmt(wallValue)} exterior walls + ${fmt(partitionValue)} LF partitions × ${fmt(wall)} ft × 2 sides + ${fmt(heated)} ceilings + ${fmt(basementWalls)} finished basement walls = ${fmt(drywallValue)} sqft before waste`,
  };

  const baseValue = per * stories + partitionValue * 2;
  const baseboardLf: Quantity = {
    value: baseValue,
    formula: `${fmt(per)} LF perimeter × ${fmt(stories)} stories + ${fmt(partitionValue)} LF partitions × 2 sides = ${fmt(baseValue)} LF`,
  };

  const full = nonNeg(i.fullBaths);
  const half = nonNeg(i.halfBaths);
  const fixturesCalc = full * 3 + half * 2 + 2 + 1;
  const fixtures: Quantity =
    i.fixturesOverride !== null
      ? { value: nonNeg(i.fixturesOverride), formula: `Fixture count typed in by you (calculated: ${fmt(fixturesCalc)})` }
      : {
          value: fixturesCalc,
          formula: `${fmt(full)} full baths × 3 + ${fmt(half)} half baths × 2 + 2 kitchen (sink, dishwasher) + 1 laundry = ${fmt(fixturesCalc)}`,
        };

  const beds = nonNeg(i.bedrooms);
  const doorsCalc = beds * 2 + full + half + 3;
  const interiorDoors: Quantity =
    i.interiorDoorsOverride !== null
      ? { value: nonNeg(i.interiorDoorsOverride), formula: `Door count typed in by you (calculated: ${fmt(doorsCalc)})` }
      : {
          value: doorsCalc,
          formula: `${fmt(beds)} bedrooms × 2 (room + closet) + ${fmt(full + half)} baths + 3 for linen, coat and utility = ${fmt(doorsCalc)}`,
        };

  const hasBasement = i.foundation === 'basement_unfinished' || i.foundation === 'basement_finished';
  const upperFlights = roundUp(stories) - 1;
  const stairsValue = upperFlights + (hasBasement ? 1 : 0);
  const stairs: Quantity = {
    value: stairsValue,
    formula: `${fmt(upperFlights)} between floors + ${hasBasement ? 1 : 0} to basement = ${fmt(stairsValue)} flights`,
  };

  const deckFloors = i.foundation === 'slab' ? roundUp(stories) - 1 : roundUp(stories);
  const deckValue = fp * deckFloors;
  const floorDeck: Quantity = {
    value: deckValue,
    formula: `${fmt(fp)} footprint × ${fmt(deckFloors)} framed floors${i.foundation === 'slab' ? ' (first floor is on slab)' : ''} = ${fmt(deckValue)} sqft`,
  };

  const dumpstersValue = Math.max(1, roundUp(heated / SQFT_PER_DUMPSTER));
  const dumpsters: Quantity = {
    value: dumpstersValue,
    formula: `${fmt(heated)} heated ÷ ${SQFT_PER_DUMPSTER} sqft per dumpster, rounded up = ${fmt(dumpstersValue)}`,
  };

  return {
    footprint,
    perimeter,
    garageArea,
    roofArea,
    exteriorWallArea,
    sidingArea,
    partitionLf,
    drywallArea,
    baseboardLf,
    fixtures,
    interiorDoors,
    stairs,
    floorDeck,
    dumpsters,
  };
}
