// Makes a ready-to-use login on the LOCAL test system. Usage: node scripts/invite-local.mjs you@example.com
// Then sign in at http://127.0.0.1:5183 and open the link in the mailbox at http://127.0.0.1:54324
import { execSync } from 'node:child_process';

const email = process.argv[2]?.toLowerCase();
if (!email) throw new Error('Give an email address.');
const status = JSON.parse(execSync('npx supabase status -o json 2>/dev/null').toString());
if (!/^http:\/\/127\.0\.0\.1/.test(status.API_URL)) throw new Error('Refusing to run against anything but the local system.');
const key = status.SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const res = await fetch(`${status.API_URL}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify({ email, email_confirm: true }) });
if (!res.ok) {
  const list = await (await fetch(`${status.API_URL}/auth/v1/admin/users?per_page=1000`, { headers })).json();
  const user = list.users.find((u) => u.email === email);
  if (!user) throw new Error(`Could not create ${email}: ${await res.text()}`);
  await fetch(`${status.API_URL}/auth/v1/admin/users/${user.id}`, { method: 'PUT', headers, body: JSON.stringify({ email_confirm: true }) });
}
console.log(`${email} is ready. Sign in at http://127.0.0.1:5183, then open the link at http://127.0.0.1:54324`);
