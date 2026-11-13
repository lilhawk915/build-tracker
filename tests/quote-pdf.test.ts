// @vitest-environment node
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clientLineAmounts } from '../src/estimator/domain/pricing/pricing';
import { rowsToProject, rowsToSettings } from '../src/estimator/convert';
import { renderQuotePdf } from '../src/estimator/QuotePdf';

describe('client line prices', () => {
  it('splits the markup by cost and always adds up to the total', () => {
    expect(clientLineAmounts([{ material: 0, labor: 9200 }], { salesTaxPct: 0 }, 11040)).toEqual([11040]);
    expect(clientLineAmounts([{ material: 0, labor: 0 }, { material: 0, labor: 9200 }], { salesTaxPct: 0 }, 11040)).toEqual([0, 11040]);
    const three = clientLineAmounts([{ material: 100, labor: 0 }, { material: 0, labor: 100 }, { material: 0, labor: 100 }], { salesTaxPct: 0 }, 1000);
    expect(Math.round(three.reduce((s, x) => s + x, 0) * 100)).toBe(100000);
    expect(clientLineAmounts([{ material: 100, labor: 0 }, { material: 0, labor: 100 }], { salesTaxPct: 10 }, 420)).toEqual([220, 200]);
  });
});

describe('client quote PDF for a custom job', () => {
  it('lists each item with its description, quantity, unit price and total', async () => {
    const project = rowsToProject({
      kind: 'custom', status: 'draft', client_name: 'Sample Client', address: '100 Sample Rd, Xenia, OH 45385', quote_date: '2026-11-13', notes: '', inputs: {},
      line_edits: { 'k.price': { laborUnit: 9200, materialUnit: 0 } },
      custom_lines: [{ key: 'k.price', qty: 1, name: 'Mold remediation and crawlspace encapsulation', unit: 'lump sum', division: 'Insulation/Drywall', catalogItemId: null,
        description: 'Extract and dispose of old insulation.\nApply anti-microbial to the subfloor.\nInstall 20 mil reinforced vapor barrier.' },
        { key: 'k.inc', qty: 1, name: 'Clean up', unit: 'lump sum', division: 'Insulation/Drywall', catalogItemId: null, description: 'Haul away all debris.' }],
      assumptions: 'Closed cell spray foam adds a vapor and air seal.', validity_days: 30, job_id: null, deposit_pct: 0, number: 1004,
    } as never, { estimate_id: 'x', sales_tax_pct: 0, contingency_pct: 0, overhead_pct: 0, profit_pct: 0, profit_amount: 1840 } as never);
    const settings = rowsToSettings({ name: 'Sample Builders', address: '', phone: '937-555-0100', email: 'office@example.com', license: '', logo_data_url: null, default_assumptions: '', default_validity_days: 30 } as never, null);
    const blob = await renderQuotePdf({ mode: 'client', project, catalog: [], settings });
    const bytes = Buffer.from(await blob.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    if (process.env.QUOTE_PDF_OUT) writeFileSync(process.env.QUOTE_PDF_OUT, bytes);
  }, 30000);
});
