import { useState } from 'react';
import { Empty, FormModal } from '../components/ui';
import { store, useData } from '../data';
import type { Profile, Role } from '../domain/types';

const ROLE: Record<Role, string> = { admin: 'Admin', staff: 'Staff', crew: 'Crew', sub: 'Sub', none: 'No access' };

export function Team() {
  const { data, run, me } = useData();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const vendorName = (id: string | null) => data.vendors.find((v) => v.id === id)?.name ?? '';
  const joined = new Set(data.profiles.map((p) => p.email));
  const waiting = data.team_invites.filter((i) => !joined.has(i.email));

  const setRole = (p: Profile, role: Role) =>
    run(() => store.update('profiles', p.id, { role, vendor_id: role === 'sub' ? p.vendor_id : null }), `${p.email} is now ${ROLE[role]}.`);

  return (
    <div className="stack">
      <div className="row between">
        <h1>Team</h1>
        <button className="btn primary" onClick={() => setAdding(true)}>Invite someone</button>
      </div>
      <p className="muted">Admins can override a payment block and manage this page. Staff run jobs day to day, and you can give one access to contractor contacts by editing them. Crew see only the jobs they have tasks on, with no money. To add a sub, use Portal access on the Subs page.</p>
      {data.profiles.length === 0 ? <Empty>Nobody has signed in yet.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Sub company</th><th /></tr></thead>
            <tbody>
              {data.profiles.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.email}</td>
                  <td>{p.phone}{p.can_view_contacts && p.role === 'staff' && <div><span className="chip good">Sees contacts</span></div>}</td>
                  <td>
                    {p.role === 'sub' ? ROLE.sub : (
                      <select
                        aria-label={`Role for ${p.email}`}
                        value={p.role}
                        disabled={p.id === me.id}
                        style={{ width: 'auto' }}
                        onChange={(e) => setRole(p, e.target.value as Role)}
                      >
                        <option value="admin">Admin</option>
                        <option value="staff">Staff</option>
                        <option value="crew">Crew</option>
                        <option value="none">No access</option>
                      </select>
                    )}
                  </td>
                  <td>{vendorName(p.vendor_id)}</td>
                  <td className="actions"><button className="btn tiny" onClick={() => setEditing(p)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {waiting.length > 0 && (
        <>
          <h2>Allowed, invite not sent</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Email</th><th>Role</th><th>Sub company</th><th /></tr></thead>
              <tbody>
                {waiting.map((i) => (
                  <tr key={i.email}>
                    <td>{i.email}</td><td>{ROLE[i.role]}</td><td>{vendorName(i.vendor_id)}</td>
                    <td className="actions">
                      <button className="btn tiny" onClick={() => run(() => store.inviteUser(i.email), `${i.email} is invited. A sign-in link is on its way.`)}>Send invite</button>
                      <button className="btn tiny" onClick={() => run(() => store.remove('team_invites', i.email), 'Email removed.')}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {editing && (
        <FormModal
          title={`Edit ${editing.name || editing.email}`}
          submit="Save person"
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'phone', label: 'Phone' },
            ...(editing.role === 'staff' ? [{ key: 'can_view_contacts', label: 'Can see contractor contacts', type: 'check' as const, help: 'For an office person who makes the calls. It does not allow payment overrides or managing logins.' }] : []),
          ]}
          initial={editing as never}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            if (await run(() => store.update('profiles', editing.id, v as never), 'Person saved.')) setEditing(null);
          }}
        />
      )}
      {adding && (
        <FormModal
          title="Invite someone"
          submit="Send invite"
          fields={[
            { key: 'email', label: 'Email', type: 'email', required: true },
            { key: 'role', label: 'Role', type: 'select', options: [{ value: 'crew', label: 'Crew' }, { value: 'staff', label: 'Staff' }, { value: 'admin', label: 'Admin' }] },
          ]}
          initial={{ role: 'crew' }}
          onClose={() => setAdding(false)}
          onSave={async (v) => {
            const email = (v.email as string).trim().toLowerCase();
            const ok = await run(
              async () => {
                await store.insert('team_invites', { email, role: v.role as 'crew' | 'staff' | 'admin', vendor_id: null });
                await store.inviteUser(email);
              },
              `${email} is invited. A sign-in link is on its way.`,
            );
            if (ok) setAdding(false);
          }}
        />
      )}
    </div>
  );
}
