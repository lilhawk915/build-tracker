import { describe, expect, it } from 'vitest';
import { catalogToCsv, importCatalogCsv } from './csv';
import { seedCatalog } from './seed';
import type { CatalogItem } from '../types';

const item: CatalogItem = {
  id: 'a.b',
  division: 'Site',
  name: 'Thing, with comma',
  unit: 'each',
  unitCost: 10,
  laborCost: 5,
  grade: 'builder',
  notes: 'note "quoted"',
  verified: false,
};
const header = 'id,division,name,unit,unit_cost,labor_cost,grade,notes,verified';

describe('catalog CSV', () => {
  it('round trips the whole seed catalog with no changes', () => {
    const seed = seedCatalog();
    const r = importCatalogCsv(catalogToCsv(seed), seed);
    expect(r.errors).toEqual([]);
    expect(r.items).toEqual(seed);
    expect(r.unchanged).toBe(seed.length);
  });

  it('keeps commas and quotes', () => {
    const r = importCatalogCsv(catalogToCsv([item]), []);
    expect(r.items[0].name).toBe('Thing, with comma');
    expect(r.items[0].notes).toBe('note "quoted"');
  });

  it('a changed price becomes verified, even if the column still says false', () => {
    const r = importCatalogCsv(`${header}\na.b,Site,Thing,each,12,5,builder,,false`, [item]);
    expect(r.items[0].unitCost).toBe(12);
    expect(r.items[0].verified).toBe(true);
    expect(r.updated).toBe(1);
  });

  it('an unchanged price stays unverified', () => {
    const r = importCatalogCsv(`${header}\na.b,Site,Thing,each,10,5,builder,,false`, [item]);
    expect(r.items[0].verified).toBe(false);
  });

  it('verified=true marks an unchanged price verified', () => {
    const r = importCatalogCsv(`${header}\na.b,Site,Thing,each,10,5,builder,,TRUE`, [item]);
    expect(r.items[0].verified).toBe(true);
  });

  it('keeps items that are not in the file', () => {
    const r = importCatalogCsv(`${header}\nnew.one,Site,New,each,1,1,mid,,`, [item]);
    expect(r.items.map((i) => i.id)).toEqual(['a.b', 'new.one']);
    expect(r.added).toBe(1);
    expect(r.items[1].verified).toBe(true);
  });

  it('blank id gets one from the name', () => {
    const r = importCatalogCsv(`${header}\n,Site,Tree Removal,each,1,1,mid,,`, []);
    expect(r.items[0].id).toBe('custom.tree_removal');
  });

  it('accepts dollar signs and thousands commas', () => {
    const r = importCatalogCsv(`${header}\na.b,Site,Thing,each,"$1,250.50",0,builder,,`, []);
    expect(r.items[0].unitCost).toBe(1250.5);
  });

  it('one bad row rejects the whole file and leaves prices alone', () => {
    const r = importCatalogCsv(`${header}\na.b,Site,Thing,each,99,5,builder,,\nb.c,Nope,Thing,yards,abc,5,gold,,`, [item]);
    expect(r.items).toEqual([item]);
    expect(r.added + r.updated).toBe(0);
    expect(r.errors[0]).toContain('Row 3');
    expect(r.errors[0]).toContain('unknown division');
    expect(r.errors[0]).toContain('unknown unit');
    expect(r.errors[0]).toContain('bad unit_cost');
    expect(r.errors[0]).toContain('unknown grade');
  });

  it('rejects negative prices, blank prices and duplicate ids', () => {
    expect(importCatalogCsv(`${header}\na,Site,T,each,-1,0,mid,,`, []).errors).toHaveLength(1);
    expect(importCatalogCsv(`${header}\na,Site,T,each,,0,mid,,`, []).errors).toHaveLength(1);
    expect(importCatalogCsv(`${header}\na,Site,T,each,1,0,mid,,\na,Site,T,each,1,0,mid,,`, []).errors[0]).toContain('duplicate');
  });

  it('reports missing columns', () => {
    const r = importCatalogCsv('id,name\na,b', [item]);
    expect(r.errors.join()).toContain('unit_cost');
    expect(r.items).toEqual([item]);
  });

  it('handles the byte-order mark Excel adds', () => {
    const r = importCatalogCsv(`﻿${header}\na.b,Site,Thing,each,10,5,builder,,`, []);
    expect(r.errors).toEqual([]);
    expect(r.items[0].id).toBe('a.b');
  });
});
