import type { ReactNode } from 'react';
import { NumberCell, TextCell, qtyText } from '../../estimator/ui';
import { deriveQuantities, type Quantity } from '../../estimator/domain/house/quantities';
import type { FlooringType, Grade, HouseInputs as Inputs, Project } from '../../estimator/domain/types';

type NumKey = { [K in keyof Inputs]: Inputs[K] extends number ? K : never }[keyof Inputs];
type Opt<T> = readonly (readonly [T, string])[];
const GRADES: Opt<Grade> = [['builder', 'Builder'], ['mid', 'Mid'], ['premium', 'Premium']];
const FLOORS: Opt<FlooringType> = [['carpet', 'Carpet'], ['lvp', 'LVP'], ['hardwood', 'Hardwood'], ['tile', 'Tile']];

function Row({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <label className="inrow">
      <span title={title} className={title ? 'dotted' : undefined}>{label}</span>
      {children}
    </label>
  );
}

function Pick<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Opt<T>; onChange: (v: T) => void }) {
  return (
    <Row label={label}>
      <select aria-label={label} value={String(value)} onChange={(e) => onChange(options.find(([v]) => String(v) === e.target.value)![0])}>
        {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>
    </Row>
  );
}

export function HouseInputs({ project, update }: { project: Project; update: (change: (p: Project) => Project) => void }) {
  const i = project.inputs;
  const q = deriveQuantities(i);
  const set = (patch: Partial<Inputs>) => update((p) => ({ ...p, inputs: { ...p.inputs, ...patch } }));
  const num = (label: string, key: NumKey, min = 0) => (
    <Row label={label}><NumberCell className="field num" label={label} value={i[key]} min={min} onCommit={(v) => set({ [key]: v ?? min } as Partial<Inputs>)} /></Row>
  );
  // Worked out from the other inputs unless you type over it. Clearing it goes back to worked out.
  const auto = (label: string, value: number | null, calc: Quantity, apply: (v: number | null) => void) => (
    <Row label={label} title={calc.formula}>
      <NumberCell className="field num" label={label} value={value} nullable edited={value !== null} placeholder={`auto: ${qtyText(Math.round(calc.value))}`} onCommit={apply} />
    </Row>
  );
  const floorPct = i.flooring.filter((f) => f.sqftOverride === null).reduce((s, f) => s + f.pct, 0);
  const setFloor = (id: string, patch: Partial<Inputs['flooring'][number]>) => set({ flooring: i.flooring.map((f) => (f.id === id ? { ...f, ...patch } : f)) });

  return (
    <div className="housegrid">
      <section className="panel">
        <h3>Finish and size</h3>
        <Pick label="Finish preset" value={i.finish} options={GRADES} onChange={(finish) => set({ finish })} />
        {num('Waste %', 'wastePct')}
        {num('Heated sq ft', 'heatedSqft')}
        {num('Stories', 'stories', 1)}
        {auto('Footprint sq ft', i.footprintOverride, q.footprint, (v) => set({ footprintOverride: v }))}
        {auto('Perimeter LF', i.perimeterOverride, q.perimeter, (v) => set({ perimeterOverride: v }))}
        {num('Wall height ft', 'wallHeightFt')}
      </section>
      <section className="panel">
        <h3>Foundation and roof</h3>
        <Pick label="Foundation" value={i.foundation} options={[['slab', 'Slab'], ['crawlspace', 'Crawlspace'], ['basement_unfinished', 'Basement, unfinished'], ['basement_finished', 'Basement, finished']]} onChange={(foundation) => set({ foundation })} />
        {i.foundation === 'basement_finished' && num('Finished basement sq ft', 'finishedBasementSqft')}
        <Pick label="Roof material" value={i.roofMaterial} options={[['shingle', 'Shingle'], ['metal', 'Metal']]} onChange={(roofMaterial) => set({ roofMaterial })} />
        {num('Pitch (rise per 12)', 'roofPitch')}
        {num('Overhang inches', 'overhangIn')}
        {auto('Roof area sq ft', i.roofAreaOverride, q.roofArea, (v) => set({ roofAreaOverride: v }))}
      </section>
      <section className="panel">
        <h3>Exterior</h3>
        <Pick label="Siding" value={i.siding} options={[['vinyl', 'Vinyl'], ['fiber_cement', 'Fiber cement'], ['brick', 'Brick'], ['wood', 'Wood']]} onChange={(siding) => set({ siding })} />
        {num('Windows', 'windows')}
        {num('Exterior doors', 'exteriorDoors')}
        {num('Garage bays', 'garageBays')}
        {num('Sq ft per garage bay', 'garageSqftPerBay')}
        {num('Porch/deck sq ft', 'porchDeckSqft')}
      </section>
      <section className="panel">
        <h3>Interior</h3>
        {num('Bedrooms', 'bedrooms')}
        {num('Full baths', 'fullBaths')}
        {num('Half baths', 'halfBaths')}
        <Pick<Grade | 'same'> label="Trim level" value={i.trimLevel ?? 'same'} options={[['same', 'Same as finish'], ...GRADES]} onChange={(v) => set({ trimLevel: v === 'same' ? null : v })} />
        {auto('Interior doors', i.interiorDoorsOverride, q.interiorDoors, (v) => set({ interiorDoorsOverride: v }))}
        <div className="floorgrid muted small"><span>Flooring area</span><span>Type</span><span>%</span><span>or sq ft</span><span /></div>
        {i.flooring.map((f) => (
          <div className="floorgrid" key={f.id}>
            <TextCell label="Flooring area name" value={f.name} onCommit={(name) => setFloor(f.id, { name })} />
            <select className="cell" aria-label={`${f.name} flooring type`} value={f.type} onChange={(e) => setFloor(f.id, { type: e.target.value as FlooringType })}>
              {FLOORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <NumberCell label={`${f.name} percent`} value={f.pct} onCommit={(v) => setFloor(f.id, { pct: v ?? 0 })} />
            <NumberCell label={`${f.name} square feet`} value={f.sqftOverride} nullable onCommit={(v) => setFloor(f.id, { sqftOverride: v })} />
            <button className="linkish danger" aria-label={`Remove ${f.name}`} onClick={() => set({ flooring: i.flooring.filter((x) => x.id !== f.id) })}>×</button>
          </div>
        ))}
        <div className="row between" style={{ marginTop: 6 }}>
          <button className="btn tiny" onClick={() => set({ flooring: [...i.flooring, { id: crypto.randomUUID(), name: 'New area', type: 'lvp', pct: 0, sqftOverride: null }] })}>Add flooring area</button>
          {!i.flooring.some((f) => f.sqftOverride !== null) && floorPct !== 100 && <span className="chip warn">Shares add to {qtyText(floorPct)}%</span>}
        </div>
      </section>
      <section className="panel">
        <h3>Mechanical</h3>
        <Pick label="HVAC" value={i.hvac} options={[['gas_furnace_ac', 'Gas furnace + AC'], ['heat_pump', 'Heat pump'], ['mini_split', 'Mini-split']]} onChange={(hvac) => set({ hvac })} />
        <Pick label="Water heater" value={i.waterHeater} options={[['gas_tank', 'Gas tank'], ['electric_tank', 'Electric tank'], ['tankless', 'Tankless']]} onChange={(waterHeater) => set({ waterHeater })} />
        <Pick label="Electrical service" value={i.electricalService} options={[[100, '100 amp'], [150, '150 amp'], [200, '200 amp'], [320, '320 amp'], [400, '400 amp']]} onChange={(electricalService) => set({ electricalService })} />
        {auto('Plumbing fixtures', i.fixturesOverride, q.fixtures, (v) => set({ fixturesOverride: v }))}
      </section>
      <section className="panel">
        <h3>Site work</h3>
        <Pick label="Clearing" value={i.clearing} options={[['none', 'None'], ['light', 'Light'], ['heavy', 'Heavy']]} onChange={(clearing) => set({ clearing })} />
        {num('Driveway sq ft', 'drivewaySqft')}
        <Pick label="Water" value={i.water} options={[['city', 'City'], ['well', 'Well']]} onChange={(water) => set({ water })} />
        <Pick label="Sewer" value={i.sewer} options={[['city', 'City'], ['septic', 'Septic']]} onChange={(sewer) => set({ sewer })} />
        <Row label="Permits and fees $"><NumberCell className="field num" label="Permits and fees" value={i.permitsAllowance} nullable placeholder="from catalog" onCommit={(permitsAllowance) => set({ permitsAllowance })} /></Row>
      </section>
    </div>
  );
}
