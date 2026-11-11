import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../data';
import { rowToCatalog, rowsToSettings } from './convert';
import { defaultSettings } from './domain/house/defaults';
import type { CatalogItem, Markups, Project, Settings } from './domain/types';

export const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const qtyText = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

// Staff see costs only. Pricing with zero markups gives material + labor and nothing more.
export const COST_ONLY: Markups = { salesTaxPct: 0, contingencyPct: 0, overheadPct: 0, profitPct: 0, profitAmount: null };

const fmt = (v: number | null | undefined, decimals?: number) => {
  if (v === null || v === undefined) return '';
  if (decimals !== undefined) return v.toFixed(decimals);
  return String(Math.round(v * 10000) / 10000);
};

/** A number you type into. It saves on Enter or when you leave the box; Escape puts it back. */
export function NumberCell({
  value, onCommit, label, nullable, placeholder, decimals, edited, min = 0, className = 'cell num',
}: {
  value: number | null; onCommit: (v: number | null) => void; label: string; nullable?: boolean; placeholder?: string;
  decimals?: number; edited?: boolean; min?: number; className?: string;
}) {
  const shown = fmt(value, decimals);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    // Leaving a box you didn't change never rewrites the number, so $2.875 isn't rounded to $2.88.
    if (text === shown) return;
    const t = text.replace(/[$,\s]/g, '');
    if (t === '') {
      if (nullable) onCommit(null);
      else setText(shown);
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n) || n < min || n === value) { setText(shown); return; }
    onCommit(n);
  };
  return (
    <input
      className={`${className}${edited ? ' edited' : ''}`}
      aria-label={label}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(shown);
      }}
    />
  );
}

export function TextCell({ value, onCommit, label, edited, className = 'cell', type = 'text' }: {
  value: string; onCommit: (v: string) => void; label: string; edited?: boolean; className?: string; type?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      type={type}
      className={`${className}${edited ? ' edited' : ''}`}
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text !== value) onCommit(text); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && type !== 'textarea') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(value);
      }}
    />
  );
}

export function TextBlock({ value, onCommit, label, rows = 6 }: { value: string; onCommit: (v: string) => void; label: string; rows?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <textarea aria-label={label} rows={rows} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { if (text !== value) onCommit(text); }} />;
}

/** The live catalog and settings, in the Estimator's own shapes. Staff get settings with no markups. */
export function useEstimating(): { catalog: CatalogItem[]; settings: Settings; isAdmin: boolean } {
  const { data, me } = useData();
  return useMemo(() => {
    const company = data.company_settings[0];
    const settings = company ? rowsToSettings(company, data.markup_defaults[0] ?? null) : defaultSettings();
    if (company && !company.default_assumptions) settings.defaultAssumptions = defaultSettings().defaultAssumptions;
    return { catalog: data.catalog_items.map(rowToCatalog), settings, isAdmin: me.role === 'admin' };
  }, [data.company_settings, data.markup_defaults, data.catalog_items, me.role]);
}

export function downloadFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeName = (s: string) => s.replace(/[^a-zA-Z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') || 'quote';

/** Loads the PDF library only when someone downloads a quote. */
export function useQuotePdf() {
  const [busy, setBusy] = useState(false);
  const { say } = useData();
  const download = async (mode: 'client' | 'internal', project: Project, catalog: CatalogItem[], settings: Settings, versionLabel?: string) => {
    setBusy(true);
    try {
      const { renderQuotePdf } = await import('./QuotePdf');
      const blob = await renderQuotePdf({ mode, project, catalog, settings, versionLabel });
      const name = [safeName(project.clientName || project.address), versionLabel ? safeName(versionLabel) : null, mode === 'internal' ? 'INTERNAL' : 'quote'].filter(Boolean).join('_');
      downloadFile(`${name}.pdf`, blob);
    } catch (e) {
      const msg = (e as Error).message;
      // An open page can outlive a site update; the fresh page has the PDF maker.
      if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(msg)) say('err', 'Build Tracker was just updated. Reload this page, then make the PDF again.');
      else say('err', `The PDF could not be made: ${msg}`);
    } finally {
      setBusy(false);
    }
  };
  return { download, busy };
}

/** Saves changes in the order they were made, one at a time, so a slow save can't overwrite a newer one. */
export function useSaveQueue() {
  const chain = useRef<Promise<void>>(Promise.resolve());
  return (work: () => Promise<void>) => {
    chain.current = chain.current.then(work, work);
    return chain.current;
  };
}
