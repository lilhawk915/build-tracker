import { useEffect, useState } from 'react';
import { store, useData } from '../../data';
import { money } from '../../domain/csv';
import { dateText } from '../../domain/leads';
import { todayIso } from '../../domain/rules';
import type { Invoice, InvoicePayment, Profile } from '../../domain/types';

export const PAY_METHODS = ['Check', 'Cash', 'Card', 'Bank transfer', 'Zelle', 'Other'];

/** Who may add, change or delete payments and notes: just the owner. */
export function ownerName(profiles: Profile[]): string {
  const o = profiles.find((p) => p.is_owner);
  const n = (o?.name || o?.username || '').trim();
  return n ? n[0].toUpperCase() + n.slice(1) : 'the owner';
}

const dollars = (cents: number) => (cents ? (cents / 100).toFixed(2) : '');
const toCents = (typed: string) => Math.round(Number(typed.replace(/[$,\s]/g, '')) * 100);

/** One saved payment. Changes stay on screen until you press Save. */
function PaymentRow({ p, n, owner }: { p: InvoicePayment; n: number; owner: boolean }) {
  const { run } = useData();
  const [d, setD] = useState({ paid_on: p.paid_on, amount: dollars(Number(p.amount_cents)), method: p.method, note: p.note });
  useEffect(() => { setD({ paid_on: p.paid_on, amount: dollars(Number(p.amount_cents)), method: p.method, note: p.note }); }, [p]);
  const cents = toCents(d.amount);
  const changed = d.paid_on !== p.paid_on || cents !== Number(p.amount_cents) || d.method !== p.method || d.note !== p.note;
  const label = `payment ${n}`;

  if (!owner) {
    return (
      <tr>
        <td>{dateText(p.paid_on)}</td><td className="right num">{money(Number(p.amount_cents))}</td><td>{p.method}</td><td>{p.note}</td><td />
      </tr>
    );
  }
  const save = () => {
    if (!(cents > 0)) return run(async () => { throw new Error('Type an amount above $0.'); });
    if (!d.paid_on) return run(async () => { throw new Error('Pick the date it was paid.'); });
    return run(() => store.update('invoice_payments', p.id, { paid_on: d.paid_on, amount_cents: cents, method: d.method, note: d.note.trim() }), 'Payment saved.');
  };
  const del = () => {
    if (!window.confirm(`Delete the ${money(Number(p.amount_cents))} payment from ${dateText(p.paid_on)}?`)) return;
    return run(() => store.remove('invoice_payments', p.id), 'Payment deleted.');
  };
  return (
    <tr className={changed ? 'unsaved' : ''}>
      <td><input type="date" aria-label={`Date of ${label}`} value={d.paid_on} onChange={(e) => setD({ ...d, paid_on: e.target.value })} /></td>
      <td className="right"><input inputMode="decimal" className="num" aria-label={`Amount of ${label}`} value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} /></td>
      <td>
        <select aria-label={`How ${label} was paid`} value={d.method} onChange={(e) => setD({ ...d, method: e.target.value })}>
          <option value="">-</option>
          {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
        </select>
      </td>
      <td><input aria-label={`Note on ${label}`} value={d.note} placeholder="Check #, who paid…" onChange={(e) => setD({ ...d, note: e.target.value })} /></td>
      <td className="actions nowrap">
        <button className={`btn tiny${changed ? ' primary' : ''}`} disabled={!changed} aria-label={`Save ${label}`} onClick={() => void save()}>Save</button>
        <button className="btn tiny danger" aria-label={`Delete ${label}`} onClick={() => void del()}>Delete</button>
      </td>
    </tr>
  );
}

/** Every payment on the invoice. The owner adds, saves and deletes them; other admins just see them. */
export function Payments({ inv, total, balance }: { inv: Invoice; total: number; balance: number }) {
  const { data, run, me } = useData();
  const owner = Boolean(me.is_owner);
  const who = ownerName(data.profiles);
  const pays = data.invoice_payments.filter((p) => p.invoice_id === inv.id).sort((a, b) => a.paid_on.localeCompare(b.paid_on) || a.created_at.localeCompare(b.created_at));
  const blank = () => ({ paid_on: todayIso(), amount: '', method: '', note: '' });
  const [d, setD] = useState(blank);

  const add = async (amountCents: number, extra: Partial<InvoicePayment> = {}) => {
    if (!(amountCents > 0)) return run(async () => { throw new Error('Type how much they paid.'); });
    const ok = await run(() => store.insert('invoice_payments', { invoice_id: inv.id, paid_on: d.paid_on || todayIso(), amount_cents: amountCents, method: d.method, note: d.note.trim(), ...extra } as never),
      amountCents >= balance && balance > 0 ? `Invoice ${inv.number} marked paid in full.` : `Payment of ${money(amountCents)} saved.`);
    if (ok) setD(blank());
  };

  return (
    <section className="panel" aria-label="Payments">
      <h3>Payments</h3>
      {pays.length === 0 ? <p className="muted">No payments yet.</p> : (
        <div className="tablewrap">
          <table className="payments">
            <thead><tr><th>Date paid</th><th className="right">Amount ($)</th><th>How</th><th>Note</th><th /></tr></thead>
            <tbody>{pays.map((p, n) => <PaymentRow key={p.id} p={p} n={n + 1} owner={owner} />)}</tbody>
          </table>
        </div>
      )}

      {owner ? (
        <form className="panel addpay" aria-label="Add a payment" onSubmit={(e) => { e.preventDefault(); void add(toCents(d.amount)); }}>
          <b>Add a payment</b>
          <div className="row">
            <label className="field">Date paid<input type="date" required value={d.paid_on} onChange={(e) => setD({ ...d, paid_on: e.target.value })} /></label>
            <label className="field">Amount ($)<input inputMode="decimal" className="num" placeholder={balance > 0 ? dollars(balance) : ''} value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} /></label>
            <label className="field">How they paid
              <select value={d.method} onChange={(e) => setD({ ...d, method: e.target.value })}>
                <option value="">-</option>
                {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label className="field grow">Note<input value={d.note} placeholder="Check #, who paid…" onChange={(e) => setD({ ...d, note: e.target.value })} /></label>
          </div>
          <div className="row">
            <button className="btn primary" disabled={!(toCents(d.amount) > 0)}>Save payment</button>
            {balance > 0 && <button type="button" className="btn" onClick={() => void add(balance)}>Mark paid in full ({money(balance)})</button>}
          </div>
        </form>
      ) : <p className="muted small">Only {who} can add, change or delete payments.</p>}

      <dl className="figs strip">
        <div><dt>Total</dt><dd>{money(total)}</dd></div>
        <div><dt>Paid</dt><dd>{money(Number(inv.paid_cents))}</dd></div>
        <div><dt>Balance due</dt><dd>{money(balance)}</dd></div>
      </dl>
    </section>
  );
}

/** The invoice's notes. The owner saves or deletes them with buttons; everyone else reads them. */
export function InvoiceNotes({ inv }: { inv: Invoice }) {
  const { data, run, me } = useData();
  const [text, setText] = useState(inv.notes);
  useEffect(() => { setText(inv.notes); }, [inv.notes]);
  if (!me.is_owner) {
    return (
      <section className="panel" aria-label="Notes">
        <h3>Notes on the invoice</h3>
        {inv.notes ? <p style={{ whiteSpace: 'pre-wrap' }}>{inv.notes}</p> : <p className="muted">No notes.</p>}
        <p className="muted small">Only {ownerName(data.profiles)} can change notes.</p>
      </section>
    );
  }
  const changed = text !== inv.notes;
  return (
    <section className="panel" aria-label="Notes">
      <h3>Notes on the invoice</h3>
      <textarea aria-label="Invoice notes" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Shows at the bottom of the invoice PDF" />
      <div className="row">
        <button className={`btn${changed ? ' primary' : ''}`} disabled={!changed} onClick={() => void run(() => store.update('invoices', inv.id, { notes: text.trim() }), 'Notes saved.')}>Save notes</button>
        {changed && <button className="btn" onClick={() => setText(inv.notes)}>Cancel</button>}
        {inv.notes && <button className="btn danger" onClick={() => { if (window.confirm('Delete the notes on this invoice?')) void run(() => store.update('invoices', inv.id, { notes: '' }), 'Notes deleted.'); }}>Delete notes</button>}
        {changed && <span className="muted small">Not saved yet</span>}
      </div>
    </section>
  );
}
