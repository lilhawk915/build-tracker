import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { store, useData, useUndoNext } from '../data';
import { centsToDecimal, money, parseMoney } from '../domain/csv';
import type { LineRollup } from '../domain/budget';
import { scheduleHealth } from '../domain/jobops';
import { todayIso } from '../domain/rules';
import type { Job } from '../domain/types';

export { money };

export function Tape({ budget, paid, billed, committed, slim, label }: {
  budget: number; paid: number; billed: number; committed: number; slim?: boolean; label?: string;
}) {
  const top = Math.max(budget, committed, billed, 1);
  const pct = (n: number) => `${Math.min(100, (n / top) * 100)}%`;
  const reach = Math.max(committed, billed);
  const over = reach > budget && budget >= 0;
  const text = label ?? `${money(paid)} paid, ${money(billed)} billed, ${money(committed)} committed of ${money(budget)} budget`;
  return (
    <div className={`tape${slim ? ' slim' : ''}`} role="img" aria-label={text} title={text}>
      <span className="committed" style={{ left: 0, width: pct(Math.min(reach, budget)) }} />
      <span className="billed" style={{ left: 0, width: pct(Math.min(billed, budget)) }} />
      <span className="paid" style={{ left: 0, width: pct(Math.min(paid, budget)) }} />
      {over && <span className="over" style={{ left: pct(budget), width: pct(reach - budget) }} />}
      {over && <span className="end" style={{ left: pct(budget) }} />}
    </div>
  );
}

export function TapeLegend() {
  return (
    <div className="legend">
      <span><b style={{ background: 'var(--ink)' }} />Paid</span>
      <span><b style={{ background: 'var(--pine)' }} />Billed</span>
      <span><b style={{ background: 'repeating-linear-gradient(135deg,var(--pine) 0 2px,rgba(31,92,77,.3) 2px 4px)' }} />Committed</span>
      <span><b style={{ background: 'var(--tape)' }} />Not spent</span>
      <span><b style={{ background: 'var(--flag)' }} />Over budget</span>
    </div>
  );
}

export const lineTape = (r: LineRollup) => (
  <Tape slim budget={r.revised} paid={r.paid} billed={r.billed} committed={r.committed} />
);

const CHIP: Record<string, string> = {
  paid: 'good', approved: 'good', accepted: 'good', funded: 'good', received: 'good', done: 'good', closed: '',
  active: 'good', planning: 'warn', submitted: 'warn', sent: 'warn', pending: 'warn', requested: 'warn', in_progress: 'warn',
  rejected: 'bad', declined: 'bad',
};
const WORD: Record<string, string> = { in_progress: 'In progress', todo: 'Not started' };
export const Status = ({ s }: { s: string }) => (
  <span className={`chip ${CHIP[s] ?? ''}`}>{WORD[s] ?? s[0].toUpperCase() + s.slice(1)}</span>
);

export const WAIVER_LABEL: Record<string, string> = {
  conditional_progress: 'Conditional progress',
  unconditional_progress: 'Unconditional progress',
  conditional_final: 'Conditional final',
  unconditional_final: 'Unconditional final',
};

export function HealthChip({ job }: { job: Job }) {
  const { data } = useData();
  const h = scheduleHealth(job, data.tasks.filter((t) => t.job_id === job.id), todayIso());
  if (h.state === 'none') return <span className="chip">No schedule</span>;
  return h.state === 'behind' ? <span className="flag">{h.label}</span> : <span className="chip good">{h.label}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Modal({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'money' | 'date' | 'select' | 'textarea' | 'check' | 'email' | 'file' | 'files' | 'number' | 'time';
  options?: { value: string; label: string }[];
  required?: boolean;
  help?: string;
  allowNegative?: boolean;
  accept?: string;
}
export type FormValues = Record<string, unknown>;

// Money fields come back as cents, checks as booleans, files as File or null.
export function FormModal({ title, fields, initial, submit, onClose, onSave, intro, wide }: {
  title: string; fields: FieldDef[]; initial?: FormValues; submit: string;
  onClose: () => void; onSave: (v: FormValues) => Promise<unknown> | void; intro?: ReactNode; wide?: boolean;
}) {
  const start = useRef(
    Object.fromEntries(fields.map((f) => {
      const v = initial?.[f.key];
      if (f.type === 'money') return [f.key, v == null ? '' : centsToDecimal(v as number)];
      if (f.type === 'check') return [f.key, Boolean(v)];
      if (f.type === 'file') return [f.key, null];
      if (f.type === 'files') return [f.key, []];
      return [f.key, v ?? ''];
    })),
  );
  const uid = useId();
  const [vals, setVals] = useState<FormValues>(start.current);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setVals((p) => ({ ...p, [k]: v }));

  async function go(e: FormEvent) {
    e.preventDefault();
    const out: FormValues = { ...vals };
    for (const f of fields) {
      if (f.type === 'money') {
        const c = parseMoney(String(vals[f.key]));
        if (c == null || (c < 0 && !f.allowNegative)) { setErr(`${f.label}: enter a dollar amount like 12500.50`); return; }
        out[f.key] = c;
      }
      if (f.type === 'date' || f.type === 'time') out[f.key] = vals[f.key] || null;
      if (f.type === 'number') {
        const raw = String(vals[f.key]).replace(/,/g, '').trim();
        if (raw !== '' && !Number.isFinite(Number(raw))) { setErr(`${f.label}: enter a number`); return; }
        out[f.key] = raw === '' ? null : Number(raw);
      }
      if (f.required && f.type === 'files' && !(vals[f.key] as File[]).length) { setErr(`${f.label}: choose at least one file`); return; }
      if (f.required && f.type === 'file' && !vals[f.key]) { setErr(`${f.label}: choose a file`); return; }
    }
    setErr('');
    setBusy(true);
    try {
      await onSave(out);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <form className="stack" onSubmit={go}>
        {intro}
        {fields.map((f) => {
          const v = vals[f.key];
          if (f.type === 'check') {
            return (
              <label className="check" key={f.key}>
                <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(f.key, e.target.checked)} />
                <span>{f.label}{f.help && <span className="help"> {f.help}</span>}</span>
              </label>
            );
          }
          return (
            <div className="field" key={f.key}>
              <label htmlFor={`${uid}-${f.key}`}>{f.label}</label>
              {f.type === 'select' ? (
                <select id={`${uid}-${f.key}`} aria-describedby={f.help ? `${uid}-${f.key}-help` : undefined} required={f.required} value={String(v)} onChange={(e) => set(f.key, e.target.value)}>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea id={`${uid}-${f.key}`} aria-describedby={f.help ? `${uid}-${f.key}-help` : undefined} required={f.required} value={String(v)} onChange={(e) => set(f.key, e.target.value)} />
              ) : f.type === 'files' ? (
                <input id={`${uid}-${f.key}`} aria-describedby={f.help ? `${uid}-${f.key}-help` : undefined} type="file" multiple accept={f.accept} onChange={(e) => set(f.key, Array.from(e.target.files ?? []))} />
              ) : f.type === 'file' ? (
                <input id={`${uid}-${f.key}`} aria-describedby={f.help ? `${uid}-${f.key}-help` : undefined} type="file" accept={f.accept ?? 'image/*,application/pdf'} onChange={(e) => set(f.key, e.target.files?.[0] ?? null)} />
              ) : (
                <input
                  id={`${uid}-${f.key}`}
                  aria-describedby={f.help ? `${uid}-${f.key}-help` : undefined}
                  type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'email' ? 'email' : 'text'}
                  inputMode={f.type === 'money' || f.type === 'number' ? 'decimal' : undefined}
                  required={f.required}
                  value={String(v)}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
              {f.help && <span className="help" id={`${uid}-${f.key}-help`}>{f.help}</span>}
            </div>
          );
        })}
        {err && <div className="alert" role="alert">{err}</div>}
        <div className="row">
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : submit}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export function FileLink({ path, label = 'View file' }: { path: string; label?: string }) {
  const { run } = useData();
  return (
    <button
      type="button"
      className="btn tiny"
      onClick={() => {
        // Open the tab during the tap: phones block windows opened after a network wait.
        const tab = window.open('', '_blank');
        void run(async () => {
          try {
            const url = await store.fileUrl(path);
            if (tab) tab.location.href = url; else window.location.href = url;
          } catch (e) {
            tab?.close();
            throw e;
          }
        });
      }}
    >
      {label}
    </button>
  );
}

export function Toast() {
  const { toast, clearToast, undo } = useData();
  const next = useUndoNext();
  useEffect(() => {
    if (toast?.kind !== 'ok') return;
    const t = setTimeout(clearToast, 3500);
    return () => clearTimeout(t);
  }, [toast, clearToast]);
  if (!toast) return null;
  return (
    <div className={`toast${toast.kind === 'err' ? ' err' : ''}`} role={toast.kind === 'err' ? 'alert' : 'status'}>
      <span>{toast.text}</span>
      {toast.kind === 'ok' && next && !toast.text.startsWith('Undone') && <button className="linkish" onClick={() => { clearToast(); void undo(); }}>Undo</button>}
      <button className="linkish" onClick={clearToast}>Dismiss</button>
    </div>
  );
}

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Top-bar Undo: reverses the last change, one step per press. */
export function UndoButton() {
  const { undo } = useData();
  const next = useUndoNext();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn tiny undo" disabled={!next || busy} title={next ? `Undo: ${next}` : 'Nothing to undo'}
      onClick={async () => { setBusy(true); try { await undo(); } finally { setBusy(false); } }}>
      ↶ Undo
    </button>
  );
}
