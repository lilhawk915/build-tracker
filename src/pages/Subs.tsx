import { useState } from 'react';
import { Empty, FormModal, Modal, money } from '../components/ui';
import { store, useData } from '../data';
import { bestPhone, primaryContact } from '../domain/jobops';
import { coiFlag, todayIso } from '../domain/rules';
import { canSeeContacts, type Vendor, type VendorContact } from '../domain/types';

function ContactsModal({ vendor, onClose }: { vendor: Vendor; onClose: () => void }) {
  const { data, run } = useData();
  const [edit, setEdit] = useState<VendorContact | 'new' | null>(null);
  const rows = data.vendor_contacts.filter((c) => c.vendor_id === vendor.id).sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  if (edit) {
    return (
      <FormModal
        title={edit === 'new' ? `Add a contact: ${vendor.name}` : `Edit ${edit.name || 'contact'}`}
        submit={edit === 'new' ? 'Add contact' : 'Save contact'}
        fields={[
          { key: 'name', label: 'Name' },
          { key: 'title', label: 'Role', help: 'Owner, office, foreman, billing…' },
          { key: 'mobile', label: 'Mobile' },
          { key: 'office_phone', label: 'Office phone' },
          { key: 'email', label: 'Email', type: 'email' },
          { key: 'address', label: 'Address' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
          { key: 'is_primary', label: 'Main contact', type: 'check', help: 'Used for the Call and Message buttons.' },
          { key: 'auto_text_ok', label: 'Agreed to automatic texts', type: 'check', help: 'Automatic texts go only to a main contact with this checked. Get their OK first.' },
        ]}
        initial={edit === 'new' ? { is_primary: rows.length === 0 } : (edit as never)}
        onClose={() => setEdit(null)}
        intro={edit !== 'new' ? (
          <button type="button" className="btn danger tiny" style={{ justifySelf: 'start' }} onClick={async () => {
            if (await run(() => store.remove('vendor_contacts', edit.id), 'Contact deleted.')) setEdit(null);
          }}>Delete this contact</button>
        ) : undefined}
        onSave={async (v) => {
          const ok = await run(async () => {
            if (v.is_primary) {
              for (const c of rows.filter((x) => x.is_primary && (edit === 'new' || x.id !== edit.id))) {
                await store.update('vendor_contacts', c.id, { is_primary: false });
              }
            }
            if (edit === 'new') await store.insert('vendor_contacts', { ...v, vendor_id: vendor.id } as never);
            else await store.update('vendor_contacts', edit.id, v as never);
          }, 'Contact saved.');
          if (ok) setEdit(null);
        }}
      />
    );
  }
  return (
    <Modal title={`${vendor.name} contacts`} wide onClose={onClose}>
      <p className="muted small">Private. Only people with contact access can see this.</p>
      {rows.length === 0 ? <Empty>No contacts yet.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Mobile</th><th>Office</th><th>Email</th><th>Address</th><th /></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b>{c.is_primary && <div><span className="chip good">Main</span></div>}{c.notes && <div className="small muted">{c.notes}</div>}</td>
                  <td>{c.title}</td>
                  <td>{c.mobile && <a href={`tel:${c.mobile}`}>{c.mobile}</a>}</td>
                  <td>{c.office_phone && <a href={`tel:${c.office_phone}`}>{c.office_phone}</a>}</td>
                  <td>{c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}</td>
                  <td>{c.address}</td>
                  <td className="actions"><button className="btn tiny" onClick={() => setEdit(c)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        <button className="btn primary" onClick={() => setEdit('new')}>Add a contact</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

export function Subs() {
  const { data, run, me } = useData();
  const [edit, setEdit] = useState<Vendor | 'new' | null>(null);
  const [inviting, setInviting] = useState<Vendor | null>(null);
  const [contactsFor, setContactsFor] = useState<Vendor | null>(null);
  const isAdmin = me.role === 'admin';
  const contactsOk = canSeeContacts(me);
  const today = todayIso();
  const vendors = [...data.vendors].sort((a, b) => a.name.localeCompare(b.name));
  const paid = (id: string) => data.bills.filter((b) => b.vendor_id === id && b.status === 'paid').reduce((s, b) => s + b.amount_cents, 0);
  const year = today.slice(0, 4);
  const paidYear = (id: string) => data.bills.filter((b) => b.vendor_id === id && b.status === 'paid' && b.paid_date?.startsWith(year)).reduce((s, b) => s + b.amount_cents, 0);
  const inUse = (id: string) => [...data.pos, ...data.bills].some((x) => x.vendor_id === id);

  return (
    <div className="stack">
      <div className="row between">
        <h1>Subs</h1>
        <button className="btn primary" onClick={() => setEdit('new')}>Add a sub</button>
      </div>
      {vendors.length === 0 ? <Empty>Add your subs and their insurance dates. Bills can't be paid without current insurance.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Sub</th><th>Trade</th>{contactsOk && <th>Contact</th>}<th>Insurance</th><th>W-9</th><th className="right">Paid {year}</th><th className="right">Paid all time</th><th /></tr></thead>
            <tbody>
              {vendors.map((v) => {
                const f = coiFlag(v, today);
                return (
                  <tr key={v.id}>
                    <td><b>{v.name}</b></td>
                    <td>{v.trade}</td>
                    {contactsOk && (
                      <td>
                        {(() => {
                          const c = primaryContact(data.vendor_contacts, v.id);
                          const count = data.vendor_contacts.filter((x) => x.vendor_id === v.id).length;
                          return (
                            <>
                              {c?.name}
                              {bestPhone(c) && <div><a href={`tel:${bestPhone(c)}`}>{bestPhone(c)}</a></div>}
                              {c?.email && <div className="small"><a href={`mailto:${c.email}`}>{c.email}</a></div>}
                              {count > 1 && <div className="small muted">+{count - 1} more</div>}
                            </>
                          );
                        })()}
                      </td>
                    )}
                    <td>
                      {f?.severity === 'stop' ? <span className="flag">Expired</span>
                        : f ? <span className="chip warn">{v.coi_expires ? 'Expires soon' : 'None on file'}</span>
                        : <span className="chip good">Current</span>}
                      {v.coi_expires && <div className="num small muted">{v.coi_expires}</div>}
                    </td>
                    <td>{v.w9_on_file ? <span className="chip good">On file</span> : <span className="chip warn">Missing</span>}</td>
                    <td className="right num">{money(paidYear(v.id))}</td>
                    <td className="right num">{money(paid(v.id))}</td>
                    <td className="actions">
                      {contactsOk && <button className="btn tiny" onClick={() => setContactsFor(v)}>Contacts</button>}
                      <button className="btn tiny" onClick={() => setEdit(v)}>Edit</button>
                      {me.role === 'admin' && <button className="btn tiny" onClick={() => setInviting(v)}>Portal access</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <FormModal
          title={edit === 'new' ? 'Add a sub' : `Edit ${edit.name}`}
          submit={edit === 'new' ? 'Add sub' : 'Save sub'}
          fields={[
            { key: 'name', label: 'Company name', required: true },
            { key: 'trade', label: 'Trade' },
            ...(edit === 'new' && contactsOk ? [
              { key: 'c_name', label: 'Contact name' },
              { key: 'c_mobile', label: 'Mobile' },
              { key: 'c_email', label: 'Email', type: 'email' as const, help: 'Only people with contact access can see this.' },
            ] : []),
            { key: 'coi_expires', label: 'Insurance certificate expires', type: 'date', help: 'Bills are blocked from payment after this date.' },
            { key: 'w9_on_file', label: 'W-9 on file', type: 'check' },
            { key: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          initial={edit === 'new' ? {} : (edit as never)}
          onClose={() => setEdit(null)}
          intro={edit !== 'new' && !inUse(edit.id) ? (
            <button type="button" className="btn danger tiny" style={{ justifySelf: 'start' }} onClick={async () => {
              if (await run(() => store.remove('vendors', edit.id), 'Sub deleted.')) setEdit(null);
            }}>Delete this sub</button>
          ) : undefined}
          onSave={async ({ c_name, c_mobile, c_email, ...v }) => {
            const ok = await run(async () => {
              if (edit !== 'new') { await store.update('vendors', edit.id, v as never); return; }
              const id = crypto.randomUUID();
              await store.insert('vendors', { ...v, id } as never);
              if (c_name || c_mobile || c_email) {
                await store.insert('vendor_contacts', { vendor_id: id, name: c_name as string, mobile: c_mobile as string, email: c_email as string, title: '', office_phone: '', address: '', notes: '', is_primary: true });
              }
            }, 'Sub saved.');
            if (ok) setEdit(null);
          }}
        />
      )}
      {contactsFor && <ContactsModal vendor={contactsFor} onClose={() => setContactsFor(null)} />}
      {inviting && (
        <FormModal
          title={`Portal access for ${inviting.name}`}
          submit="Send invite"
          fields={[{ key: 'email', label: 'Their email', type: 'email', required: true }]}
          initial={{ email: primaryContact(data.vendor_contacts, inviting.id)?.email ?? '' }}
          intro={<p className="muted">This login sees only {inviting.name}'s work orders, tasks, bills, and waivers. It never sees budgets, prices, loans, or other subs.</p>}
          onClose={() => setInviting(null)}
          onSave={async (v) => {
            const email = (v.email as string).trim().toLowerCase();
            const exists = data.team_invites.some((i) => i.email === email);
            const row = { role: 'sub' as const, vendor_id: inviting.id };
            const ok = await run(
              async () => {
                if (exists) await store.update('team_invites', email, row);
                else await store.insert('team_invites', { email, ...row });
                await store.inviteUser(email);
              },
              `${email} is invited. A sign-in link is on its way.`,
            );
            if (ok) setInviting(null);
          }}
        />
      )}
    </div>
  );
}
