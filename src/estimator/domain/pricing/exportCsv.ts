import Papa from 'papaparse';
import type { ResolvedLine, Totals } from '../types';

/** Line-item CSV, with the totals as rows at the bottom. */
export function linesToCsv(lines: ResolvedLine[], totals: Totals): string {
  const fields = ['Division', 'Item', 'Grade', 'Qty', 'Unit', 'Material/unit', 'Labor/unit', 'Material', 'Labor', 'Total', 'Price status', 'Formula'];
  const rows = lines.map((l) => [
    l.division,
    l.name,
    l.hasGrades ? l.grade : '',
    l.qty,
    l.unit,
    l.materialUnit,
    l.laborUnit,
    l.material,
    l.labor,
    l.total,
    l.unverified ? 'UNVERIFIED' : '',
    l.formula ?? '',
  ]);
  const summary: [string, number][] = [
    ['Material', totals.material],
    ['Labor', totals.labor],
    ['Sales tax on materials', totals.tax],
    ['Subtotal', totals.subtotal],
    ['Contingency', totals.contingency],
    ['Overhead', totals.overhead],
    ['Profit', totals.profit],
    ['Grand total', totals.grandTotal],
    ['Cost per heated sq ft', totals.costPerSqft],
  ];
  const summaryRows = summary.map(([label, value]) => ['TOTALS', label, '', '', '', '', '', '', '', value, '', '']);
  return Papa.unparse({ fields, data: [...rows, ...summaryRows] });
}
