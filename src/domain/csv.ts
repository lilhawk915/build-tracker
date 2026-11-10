// A leading = + - @ makes spreadsheets run a cell as a formula, so text cells get neutralized.
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const toCsv = (rows: (string | number | null | undefined)[][]) =>
  rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

export const centsToDecimal = (c: number) => (c / 100).toFixed(2);

export function money(cents: number): string {
  const whole = cents % 100 === 0;
  const s = (Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${cents < 0 ? '-' : ''}$${s}`;
}

// "$12,500.50" to cents. Returns null when it isn't a number.
export function parseMoney(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, '');
  if (clean === '') return 0;
  if (!/^-?\d*\.?\d{0,2}$/.test(clean) || clean === '-' || clean === '.') return null;
  return Math.round(Number(clean) * 100);
}
