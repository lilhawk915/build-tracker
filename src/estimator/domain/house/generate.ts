import type { Division, GeneratedLine, Grade, HouseInputs, Unit } from '../types';
import { deriveQuantities, finishedBasement, fmt, roundUp, type Quantity } from './quantities';

/** Turns the house inputs into line items. Pure: same inputs, same lines. */
export function generateLines(i: HouseInputs): GeneratedLine[] {
  const q = deriveQuantities(i);
  const finish = i.finish;
  const trim: Grade = i.trimLevel ?? finish;
  const waste = 1 + Math.max(0, i.wastePct) / 100;
  const lines: GeneratedLine[] = [];

  const add = (
    division: Division,
    family: string,
    label: string,
    qty: number,
    unit: Unit,
    formula: string,
    extra: Partial<GeneratedLine> = {},
  ) => {
    lines.push({
      key: extra.key ?? family,
      division,
      family,
      label,
      qty: Math.max(0, roundUp(qty)),
      unit,
      formula,
      grade: finish,
      ...extra,
    });
  };
  const fromQty = (division: Division, family: string, label: string, src: Quantity, unit: Unit, extra: Partial<GeneratedLine> = {}) =>
    add(division, family, label, src.value, unit, src.formula, extra);
  const withWaste = (division: Division, family: string, label: string, src: Quantity, extra: Partial<GeneratedLine> = {}) =>
    add(
      division,
      family,
      label,
      src.value * waste,
      'sqft',
      `${src.formula}. + ${fmt(i.wastePct)}% waste = ${fmt(roundUp(src.value * waste))} sqft`,
      extra,
    );
  const one = (division: Division, family: string, label: string, unit: Unit, why: string, extra: Partial<GeneratedLine> = {}) =>
    add(division, family, label, 1, unit, why, extra);

  const fp = q.footprint.value;
  const garage = q.garageArea.value;
  const slabGarage: Quantity = {
    value: garage,
    formula: q.garageArea.formula,
  };

  // Site
  if (i.clearing === 'light') one('Site', 'site.clearing_light', 'Lot clearing, light', 'lump sum', 'Clearing set to light');
  if (i.clearing === 'heavy') one('Site', 'site.clearing_heavy', 'Lot clearing, heavy', 'lump sum', 'Clearing set to heavy');
  add('Site', 'site.excavation', 'Excavation and grading', fp + garage, 'sqft', `${fmt(fp)} footprint + ${fmt(garage)} garage = ${fmt(fp + garage)} sqft`);
  add('Site', 'site.driveway', 'Driveway', i.drivewaySqft, 'sqft', 'Driveway sq ft from inputs');
  if (i.water === 'city') one('Site', 'site.water_city', 'City water tap', 'lump sum', 'Water set to city');
  else one('Site', 'site.water_well', 'Well', 'lump sum', 'Water set to well');
  if (i.sewer === 'city') one('Site', 'site.sewer_city', 'City sewer tap', 'lump sum', 'Sewer set to city');
  else one('Site', 'site.sewer_septic', 'Septic system', 'lump sum', 'Sewer set to septic');
  one('Site', 'site.power_gas', 'Electric and gas service connection', 'lump sum', 'One per house');
  one(
    'Site',
    'site.permits',
    'Permits and fees allowance',
    'allowance',
    i.permitsAllowance !== null ? 'Amount typed in the inputs panel' : 'One per house, priced from the catalog',
    i.permitsAllowance !== null ? { materialUnit: i.permitsAllowance, laborUnit: 0 } : {},
  );

  // Foundation
  if (i.foundation === 'slab') {
    add('Foundation', 'foundation.slab', 'Monolithic slab', fp, 'sqft', q.footprint.formula);
  }
  if (i.foundation === 'crawlspace') {
    fromQty('Foundation', 'foundation.crawl_wall', 'Crawlspace footing and wall', q.perimeter, 'LF');
    add('Foundation', 'foundation.crawl_vapor', 'Crawlspace vapor barrier', fp, 'sqft', q.footprint.formula);
  }
  if (i.foundation === 'basement_unfinished' || i.foundation === 'basement_finished') {
    fromQty('Foundation', 'foundation.basement_wall', 'Basement footing and wall', q.perimeter, 'LF');
    add('Foundation', 'foundation.basement_slab', 'Basement slab', fp, 'sqft', q.footprint.formula);
    fromQty('Foundation', 'foundation.waterproofing', 'Foundation waterproofing and drain', q.perimeter, 'LF');
  }
  fromQty('Foundation', 'foundation.garage_slab', 'Garage slab', slabGarage, 'sqft');

  // Framing
  fromQty('Framing', 'framing.floor', 'Floor system and subfloor', q.floorDeck, 'sqft');
  fromQty('Framing', 'framing.ext_walls', 'Exterior wall framing and sheathing', q.exteriorWallArea, 'sqft');
  fromQty('Framing', 'framing.partitions', 'Interior partition framing', q.partitionLf, 'LF');
  fromQty('Framing', 'framing.roof', 'Roof framing and decking', q.roofArea, 'sqft');
  add('Framing', 'framing.garage', 'Garage framing, siding and drywall package', i.garageBays, 'each', `${fmt(i.garageBays)} garage bays from inputs`);

  // Roofing
  withWaste('Roofing', `roof.${i.roofMaterial}`, i.roofMaterial === 'metal' ? 'Metal roofing' : 'Shingle roofing', q.roofArea, { key: 'roof.covering' });
  fromQty('Roofing', 'roof.gutters', 'Gutters and downspouts', q.perimeter, 'LF');

  // Exterior
  withWaste('Exterior', `exterior.siding_${i.siding}`, 'Siding', q.sidingArea, { key: 'exterior.siding' });
  fromQty('Exterior', 'exterior.soffit', 'Soffit and fascia', q.perimeter, 'LF');
  add('Exterior', 'exterior.porch_deck', 'Porch and deck', i.porchDeckSqft, 'sqft', 'Porch/deck sq ft from inputs');

  // Windows/Doors
  add('Windows/Doors', 'openings.window', 'Windows', i.windows, 'each', 'Window count from inputs');
  add('Windows/Doors', 'openings.ext_door', 'Exterior doors', i.exteriorDoors, 'each', 'Exterior door count from inputs');
  add('Windows/Doors', 'openings.garage_door', 'Garage doors', i.garageBays, 'each', 'One door per garage bay');
  fromQty('Windows/Doors', 'openings.int_door', 'Interior doors', q.interiorDoors, 'each', { grade: trim });

  // Plumbing
  fromQty('Plumbing', 'plumbing.rough', 'Plumbing rough-in, per fixture', q.fixtures, 'each');
  fromQty('Plumbing', 'plumbing.fixture', 'Plumbing fixtures', q.fixtures, 'each');
  one('Plumbing', `plumbing.wh_${i.waterHeater}`, 'Water heater', 'each', 'One per house', { key: 'plumbing.water_heater' });

  // HVAC
  one('HVAC', `hvac.${i.hvac}`, 'HVAC system', 'each', 'One system', { key: 'hvac.system' });
  if (i.hvac !== 'mini_split') {
    add('HVAC', 'hvac.ductwork', 'Ductwork', i.heatedSqft, 'sqft', 'Heated sq ft from inputs');
  }

  // Electrical
  one('Electrical', `electrical.service_${i.electricalService}`, 'Electrical service', 'each', `${i.electricalService} amp service from inputs`, { key: 'electrical.service' });
  add('Electrical', 'electrical.rough', 'Electrical rough-in and devices', i.heatedSqft, 'sqft', 'Heated sq ft from inputs');
  one('Electrical', 'electrical.fixtures', 'Light fixture allowance', 'allowance', 'One per house');

  // Insulation/Drywall
  fromQty('Insulation/Drywall', 'insulation.walls', 'Wall insulation', q.exteriorWallArea, 'sqft');
  add('Insulation/Drywall', 'insulation.attic', 'Attic insulation', fp, 'sqft', q.footprint.formula);
  withWaste('Insulation/Drywall', 'drywall.hang_finish', 'Drywall hang and finish', q.drywallArea);

  // Interior Finishes
  fromQty('Interior Finishes', 'interior.baseboard', 'Baseboard', q.baseboardLf, 'LF', { grade: trim });
  fromQty('Interior Finishes', 'interior.casing', 'Door casing, per door', q.interiorDoors, 'each', { grade: trim });
  fromQty('Interior Finishes', 'interior.stairs', 'Stairs and railing', q.stairs, 'each', { grade: trim });
  add('Interior Finishes', 'interior.closets', 'Closet shelving, per bedroom', i.bedrooms, 'each', 'Bedroom count from inputs');
  const basement = finishedBasement(i);
  if (basement > 0) {
    add('Interior Finishes', 'interior.finished_basement', 'Basement finish framing and egress', basement, 'sqft', 'Finished basement sq ft from inputs. Drywall, flooring, paint and electrical are already in their own lines through heated sq ft');
  }

  // Flooring
  for (const row of i.flooring) {
    const base = row.sqftOverride ?? (Math.max(0, i.heatedSqft) * row.pct) / 100;
    const area = base * waste;
    const how =
      row.sqftOverride !== null
        ? `${fmt(row.sqftOverride)} sqft typed in`
        : `${fmt(i.heatedSqft)} heated × ${fmt(row.pct)}%`;
    add('Flooring', `flooring.${row.type}`, 'Flooring', area, 'sqft', `${row.name}: ${how} + ${fmt(i.wastePct)}% waste = ${fmt(roundUp(area))} sqft`, {
      key: `flooring.row.${row.id}`,
      label: `Flooring: ${row.name}`,
    });
  }

  // Kitchen (replaced by the kitchen planner once that is built)
  one('Kitchen', 'kitchen.allowance', 'Kitchen allowance', 'allowance', 'One kitchen');

  // Baths
  add('Baths', 'bath.full', 'Full bath finish package', i.fullBaths, 'each', 'Full bath count from inputs');
  add('Baths', 'bath.half', 'Half bath finish package', i.halfBaths, 'each', 'Half bath count from inputs');

  // Paint
  fromQty('Paint', 'paint.interior', 'Interior paint', q.drywallArea, 'sqft');
  if (i.siding === 'wood') {
    fromQty('Paint', 'paint.exterior', 'Exterior paint', q.sidingArea, 'sqft');
  }

  // Cleanup/Misc
  fromQty('Cleanup/Misc', 'misc.dumpster', 'Dumpsters', q.dumpsters, 'each');
  one('Cleanup/Misc', 'misc.final_clean', 'Final cleaning', 'lump sum', 'One per house');
  one('Cleanup/Misc', 'misc.supervision', 'Job supervision', 'lump sum', 'One per house');

  return lines;
}
