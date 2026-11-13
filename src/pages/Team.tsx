import { useState } from 'react';
import { Empty, FormModal } from '../components/ui';
import { store, useData } from '../data';
import type { Profile, Role } from '../domain/types';

const WORDS = ['Oak', 'Pine', 'Brick', 'Stone', 'Cedar', 'Maple', 'Slate', 'Birch', 'Ridge', 'Creek'];
/** An easy-to-say starting password, like Cedar-4821. They can change it after signing in. */
const makePassword = () => `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${1000 + Math.floor(Math.random() * 9000)}`;
const makeUsername = (email: string, name = '') =>
  (name.trim().split(/\s+/)[0] || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30);

const ROLE: Record<Role, string> = { admin: 'Admin', staff: 'Staff', crew: 'Crew', sub: 'Sub', none: 'No access' };

export function Team() {
  const { data, run, me } = useData();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [told, setTold] = useState<{ who: string; username: string; password: string } | null>(null);
  const [login, setLogin] = useState<{ email: string; name: string; username?: string | null } | null>(null);
  const vendorName = (id: string | null) => data.vendors.find((v) => v.id === id)?.name ?? '';
  const joined = new Set(data.profiles.map((p) => p.email));
  const waiting = data.team_invites.filter((i) => !joined.has(i.email));

  const setRole = (p: Profile, role: Role) =>
    run(() => store.update('profiles', p.id, { role, vendor_id: role === 'sub' ? p.vendor_id : null }), `${p.email} is now ${ROLE[role]}.`);

  return (
    <div className="stack">
      <div className="row between">
        <h1>Team</h1>
        <button className="btn primary" onClick={() => setAdding(true)}>Add someone</button>
      </div>
      {told && (
        <div className="alert calm" role="status" aria-label="New login">
          <b>Tell {told.who}:</b> username <b style={{ fontFamily: "var(--mono)" }}>{told.username}</b> · password <b style={{ fontFamily: "var(--mono)" }}>{told.password}</b>
          {' '}<button className="btn tiny" onClick={() => void navigator.clipboard?.writeText(`Build Tracker login\nUsername: ${told.username}\nPassword: ${told.password}\n${window.location.origin}${import.meta.env.BASE_URL}`)}>Copy to send</button>
          {' '}<button className="linkish" onClick={() => setTold(null)}>Done</button>
        </div>
      )}
      <p className="muted">Everyone signs in with a username and password that you set here. Tap <b>Set login</b> to make one or reset a forgotten password, then tell them what it is. Admins can override a payment block and manage this page. Staff run jobs day to day, and you can give one access to contractor contacts by editing them. Crew see only the jobs they have tasks on, with no money. To add a sub, use Portal access on the Subs page.</p>
      {data.profiles.length === 0 ? <Empty>Nobody has signed in yet.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Phone</th><th>Role</th><th>Sub company</th><th /></tr></thead>
            <tbody>
              {data.profiles.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.username || <span className="muted small">None yet</span>}</td>
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
                  <td className="actions">
                    <button className="btn tiny" onClick={() => setLogin({ email: p.email, name: p.name, username: p.username })} aria-label={`Set login for ${p.email}`}>Set login</button>
                    <button className="btn tiny" onClick={() => setEditing(p)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {waiting.length > 0 && (
        <>
          <h2>Allowed, no login yet</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Email</th><th>Role</th><th>Sub company</th><th /></tr></thead>
              <tbody>
                {waiting.map((i) => (
                  <tr key={i.email}>
                    <td>{i.email}</td><td>{ROLE[i.role]}</td><td>{vendorName(i.vendor_id)}</td>
                    <td className="actions">
                      <button className="btn tiny" onClick={() => setLogin({ email: i.email, name: '' })} aria-label={`Set login for ${i.email}`}>Set login</button>
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
          title="Add someone"
          submit="Add them"
          intro={<p>Pick their username and password here, then tell them. Nothing is emailed.</p>}
          fields={[
            { key: 'email', label: 'Email', type: 'email', required: true, help: 'Only used to tell people apart. It does not need to work.' },
            { key: 'role', label: 'Role', type: 'select', options: [{ value: 'crew', label: 'Crew' }, { value: 'staff', label: 'Staff' }, { value: 'admin', label: 'Admin' }] },
            { key: 'username', label: 'Username', required: true, help: 'One word, like their first name.' },
            { key: 'password', label: 'Password', required: true, help: 'At least 8 characters. They can change it after signing in.' },
          ]}
          initial={{ role: 'crew', password: makePassword() }}
          onClose={() => setAdding(false)}
          onSave={async (v) => {
            const email = (v.email as string).trim().toLowerCase();
            const username = String(v.username ?? '').trim().toLowerCase();
            const password = String(v.password ?? '');
            const ok = await run(
              async () => {
                if (!data.team_invites.some((i) => i.email === email)) await store.insert('team_invites', { email, role: v.role as 'crew' | 'staff' | 'admin', vendor_id: null });
                await store.setLogin(email, username, password);
              },
              'Added.',
            );
            if (ok) { setAdding(false); setTold({ who: email, username, password }); }
          }}
        />
      )}
      {login && (
        <FormModal
          title={`Login for ${login.name || login.email}`}
          submit="Save login"
          intro={<p>{login.username ? 'This sets a new password. Their old one stops working.' : 'Give them a username and password, then tell them what it is.'}</p>}
          fields={[
            { key: 'username', label: 'Username', required: true, help: 'One word, like their first name.' },
            { key: 'password', label: 'New password', required: true, help: 'At least 8 characters. They can change it after signing in.' },
          ]}
          initial={{ username: login.username || makeUsername(login.email, login.name), password: makePassword() }}
          onClose={() => setLogin(null)}
          onSave={async (v) => {
            const username = String(v.username ?? '').trim().toLowerCase();
            const password = String(v.password ?? '');
            if (await run(() => store.setLogin(login.email, username, password), 'Login saved.')) {
              setTold({ who: login.name || login.email, username, password });
              setLogin(null);
            }
          }}
        />
      )}
    </div>
  );
}
