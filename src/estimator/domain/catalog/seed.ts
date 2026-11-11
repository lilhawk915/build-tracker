import { GRADES, type CatalogItem, type Division, type Unit } from '../types';

/**
 * Every seed price is deliberately fake: repeating digits so nobody mistakes one for a real number.
 * They are all flagged unverified until you enter your own.
 */
const PLACEHOLDER: Record<Unit, [number, number, number]> = {
  sqft: [1.11, 2.22, 3.33],
  LF: [11.11, 22.22, 33.33],
  each: [111.11, 222.22, 333.33],
  box: [111.11, 222.22, 333.33],
  allowance: [1111.11, 2222.22, 3333.33],
  'lump sum': [1111.11, 2222.22, 3333.33],
};

interface SeedRow {
  family: string;
  division: Division;
  name: string;
  unit: Unit;
  graded?: boolean;
  noLabor?: boolean;
}

const ROWS: SeedRow[] = [
  { family: 'site.clearing_light', division: 'Site', name: 'Lot clearing, light', unit: 'lump sum' },
  { family: 'site.clearing_heavy', division: 'Site', name: 'Lot clearing, heavy', unit: 'lump sum' },
  { family: 'site.excavation', division: 'Site', name: 'Excavation and grading', unit: 'sqft' },
  { family: 'site.driveway', division: 'Site', name: 'Concrete driveway', unit: 'sqft' },
  { family: 'site.water_city', division: 'Site', name: 'City water tap', unit: 'lump sum' },
  { family: 'site.water_well', division: 'Site', name: 'Well', unit: 'lump sum' },
  { family: 'site.sewer_city', division: 'Site', name: 'City sewer tap', unit: 'lump sum' },
  { family: 'site.sewer_septic', division: 'Site', name: 'Septic system', unit: 'lump sum' },
  { family: 'site.power_gas', division: 'Site', name: 'Electric and gas service connection', unit: 'lump sum' },
  { family: 'site.permits', division: 'Site', name: 'Permits and fees allowance', unit: 'allowance', noLabor: true },

  { family: 'foundation.slab', division: 'Foundation', name: 'Monolithic slab', unit: 'sqft' },
  { family: 'foundation.crawl_wall', division: 'Foundation', name: 'Crawlspace footing and wall', unit: 'LF' },
  { family: 'foundation.crawl_vapor', division: 'Foundation', name: 'Crawlspace vapor barrier', unit: 'sqft' },
  { family: 'foundation.basement_wall', division: 'Foundation', name: 'Basement footing and wall', unit: 'LF' },
  { family: 'foundation.basement_slab', division: 'Foundation', name: 'Basement slab', unit: 'sqft' },
  { family: 'foundation.waterproofing', division: 'Foundation', name: 'Foundation waterproofing and drain', unit: 'LF' },
  { family: 'foundation.garage_slab', division: 'Foundation', name: 'Garage slab', unit: 'sqft' },

  { family: 'framing.floor', division: 'Framing', name: 'Floor system and subfloor', unit: 'sqft' },
  { family: 'framing.ext_walls', division: 'Framing', name: 'Exterior wall framing and sheathing', unit: 'sqft' },
  { family: 'framing.partitions', division: 'Framing', name: 'Interior partition framing', unit: 'LF' },
  { family: 'framing.roof', division: 'Framing', name: 'Roof framing and decking', unit: 'sqft' },
  { family: 'framing.garage', division: 'Framing', name: 'Garage framing, siding and drywall package', unit: 'each' },

  { family: 'roof.shingle', division: 'Roofing', name: 'Shingle roofing', unit: 'sqft', graded: true },
  { family: 'roof.metal', division: 'Roofing', name: 'Metal roofing', unit: 'sqft', graded: true },
  { family: 'roof.gutters', division: 'Roofing', name: 'Gutters and downspouts', unit: 'LF' },

  { family: 'exterior.siding_vinyl', division: 'Exterior', name: 'Vinyl siding', unit: 'sqft', graded: true },
  { family: 'exterior.siding_fiber_cement', division: 'Exterior', name: 'Fiber cement siding', unit: 'sqft', graded: true },
  { family: 'exterior.siding_brick', division: 'Exterior', name: 'Brick veneer', unit: 'sqft', graded: true },
  { family: 'exterior.siding_wood', division: 'Exterior', name: 'Wood siding', unit: 'sqft', graded: true },
  { family: 'exterior.soffit', division: 'Exterior', name: 'Soffit and fascia', unit: 'LF' },
  { family: 'exterior.porch_deck', division: 'Exterior', name: 'Porch and deck', unit: 'sqft', graded: true },

  { family: 'openings.window', division: 'Windows/Doors', name: 'Window', unit: 'each', graded: true },
  { family: 'openings.ext_door', division: 'Windows/Doors', name: 'Exterior door', unit: 'each', graded: true },
  { family: 'openings.garage_door', division: 'Windows/Doors', name: 'Garage door', unit: 'each', graded: true },
  { family: 'openings.int_door', division: 'Windows/Doors', name: 'Interior door', unit: 'each', graded: true },

  { family: 'plumbing.rough', division: 'Plumbing', name: 'Plumbing rough-in, per fixture', unit: 'each' },
  { family: 'plumbing.fixture', division: 'Plumbing', name: 'Plumbing fixture', unit: 'each', graded: true },
  { family: 'plumbing.wh_gas_tank', division: 'Plumbing', name: 'Gas tank water heater', unit: 'each' },
  { family: 'plumbing.wh_electric_tank', division: 'Plumbing', name: 'Electric tank water heater', unit: 'each' },
  { family: 'plumbing.wh_tankless', division: 'Plumbing', name: 'Tankless water heater', unit: 'each' },

  { family: 'hvac.gas_furnace_ac', division: 'HVAC', name: 'Gas furnace and AC', unit: 'each', graded: true },
  { family: 'hvac.heat_pump', division: 'HVAC', name: 'Heat pump', unit: 'each', graded: true },
  { family: 'hvac.mini_split', division: 'HVAC', name: 'Ductless mini-split system', unit: 'each', graded: true },
  { family: 'hvac.ductwork', division: 'HVAC', name: 'Ductwork', unit: 'sqft' },

  { family: 'electrical.service_100', division: 'Electrical', name: '100 amp service', unit: 'each' },
  { family: 'electrical.service_150', division: 'Electrical', name: '150 amp service', unit: 'each' },
  { family: 'electrical.service_200', division: 'Electrical', name: '200 amp service', unit: 'each' },
  { family: 'electrical.service_320', division: 'Electrical', name: '320 amp service', unit: 'each' },
  { family: 'electrical.service_400', division: 'Electrical', name: '400 amp service', unit: 'each' },
  { family: 'electrical.rough', division: 'Electrical', name: 'Electrical rough-in and devices', unit: 'sqft' },
  { family: 'electrical.fixtures', division: 'Electrical', name: 'Light fixture allowance', unit: 'allowance', graded: true, noLabor: true },

  { family: 'insulation.walls', division: 'Insulation/Drywall', name: 'Wall insulation', unit: 'sqft', graded: true },
  { family: 'insulation.attic', division: 'Insulation/Drywall', name: 'Attic insulation', unit: 'sqft', graded: true },
  { family: 'drywall.hang_finish', division: 'Insulation/Drywall', name: 'Drywall hang and finish', unit: 'sqft' },

  { family: 'interior.baseboard', division: 'Interior Finishes', name: 'Baseboard', unit: 'LF', graded: true },
  { family: 'interior.casing', division: 'Interior Finishes', name: 'Door casing, per door', unit: 'each', graded: true },
  { family: 'interior.stairs', division: 'Interior Finishes', name: 'Stairs and railing', unit: 'each', graded: true },
  { family: 'interior.closets', division: 'Interior Finishes', name: 'Closet shelving, per bedroom', unit: 'each', graded: true },
  { family: 'interior.finished_basement', division: 'Interior Finishes', name: 'Basement finish framing and egress', unit: 'sqft', graded: true },

  { family: 'flooring.carpet', division: 'Flooring', name: 'Carpet', unit: 'sqft', graded: true },
  { family: 'flooring.lvp', division: 'Flooring', name: 'Luxury vinyl plank', unit: 'sqft', graded: true },
  { family: 'flooring.hardwood', division: 'Flooring', name: 'Hardwood', unit: 'sqft', graded: true },
  { family: 'flooring.tile', division: 'Flooring', name: 'Tile', unit: 'sqft', graded: true },

  { family: 'kitchen.allowance', division: 'Kitchen', name: 'Kitchen allowance', unit: 'allowance', graded: true },

  { family: 'bath.full', division: 'Baths', name: 'Full bath finish package', unit: 'each', graded: true },
  { family: 'bath.half', division: 'Baths', name: 'Half bath finish package', unit: 'each', graded: true },

  { family: 'paint.interior', division: 'Paint', name: 'Interior paint', unit: 'sqft', graded: true },
  { family: 'paint.exterior', division: 'Paint', name: 'Exterior paint', unit: 'sqft' },

  { family: 'misc.dumpster', division: 'Cleanup/Misc', name: 'Dumpster', unit: 'each', noLabor: true },
  { family: 'misc.final_clean', division: 'Cleanup/Misc', name: 'Final cleaning', unit: 'lump sum' },
  { family: 'misc.supervision', division: 'Cleanup/Misc', name: 'Job supervision', unit: 'lump sum' },
];

export function seedCatalog(): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const row of ROWS) {
    const grades = row.graded ? GRADES : (['builder'] as const);
    grades.forEach((grade, n) => {
      const price = PLACEHOLDER[row.unit][n];
      items.push({
        id: row.graded ? `${row.family}.${grade}` : row.family,
        division: row.division,
        name: row.name,
        unit: row.unit,
        unitCost: price,
        laborCost: row.noLabor ? 0 : price,
        grade,
        notes: 'PLACEHOLDER price. Enter your real number.',
        verified: false,
      });
    });
  }
  return items;
}
