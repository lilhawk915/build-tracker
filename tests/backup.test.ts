import { describe, expect, it } from 'vitest';
import { backupsToKeep, encodePath } from '../scripts/backup-lib.mjs';

const daysBack = (n: number) => {
  const d = new Date(Date.UTC(2026, 10, 9) - n * 864e5);
  return `${d.toISOString().slice(0, 10)}T0130`;
};

describe('which backups to keep', () => {
  it('keeps 30 days of dailies and one per month for a year', () => {
    const all = Array.from({ length: 500 }, (_, i) => daysBack(i));
    const keep = backupsToKeep(all);
    for (let i = 0; i < 30; i++) expect(keep.has(daysBack(i)), `day ${i}`).toBe(true);
    expect(keep.has(daysBack(45))).toBe(false);
    const months = new Set([...keep].map((n) => n.slice(0, 7)));
    expect(months.size).toBe(12);
    expect(keep.size).toBeLessThan(45);
  });
  it('keeps only the newest of several runs on one day', () => {
    const keep = backupsToKeep(['2026-11-09T0130', '2026-11-09T1400', '2026-11-08T0130']);
    expect([...keep].sort()).toEqual(['2026-11-08T0130', '2026-11-09T1400']);
  });
  it('never deletes anything that is not a finished backup', () => {
    const keep = backupsToKeep(['LAST-RUN.txt', '2026-11-09T0130.partial', 'notes']);
    expect(keep.size).toBe(0);
  });
  it('never empties the folder', () => {
    expect(backupsToKeep(['2020-01-01T0000']).size).toBe(1);
  });
  it('handles file names with spaces and brackets', () => {
    expect(encodePath('job/site survey (final).dwg')).toBe('job/site%20survey%20(final).dwg');
  });
});
