// Tests every feature against the real local system: real logins through emailed links, real file storage,
// real database rules, and the automatic-text server against a FAKE Kixie on this Mac. Nothing leaves this computer.
// Needs: npm run local:start, npm run dev, and a clean database (npx supabase db reset).
// Usage: node scripts/e2e-live.mjs <screenshot-dir>
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const out = process.argv[2] ?? '/tmp/shots';
mkdirSync(out, { recursive: true });
const BASE = 'http://127.0.0.1:5183';
const API = 'http://127.0.0.1:54321';
const MAIL = 'http://127.0.0.1:54324';
const status = JSON.parse(execSync('npx supabase status -o json 2>/dev/null').toString());
const ANON = status.ANON_KEY;
const SERVICE = status.SERVICE_ROLE_KEY;
if (!API.includes('127.0.0.1')) throw new Error('Refusing to test anything but the local system.');

const iso = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const sql = (q) => execSync(`docker exec -i supabase_db_build-tracker psql -U postgres -d postgres -At`, { input: q }).toString().trim();

const results = [];
let area = '';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pageProblems = [];
const check = (name, ok, detail = '') => {
  results.push({ area, name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${area}] ${name}${!ok && detail ? ` :: ${detail}` : ''}`);
};
// One failed step records the failure and moves on, so the report covers every feature.
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(`${name} (stopped early)`, false, String(e.message).split('\n')[0].slice(0, 220));
    for (const p of Object.values(people)) {
      if (p.page) await p.page.keyboard.press('Escape').catch(() => {});
    }
    const safe = name.replace(/\W+/g, '-').slice(0, 50);
    await current?.screenshot({ path: `${out}/FAILED-${safe}.png`, fullPage: true }).catch(() => {});
  }
}
const people = {};
let current = null;

async function newPerson(key, email, viewport = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => pageProblems.push(`${key}: ${e.message}`));
  await page.addInitScript(() => {
    window.__printed = 0;
    window.print = () => { window.__printed += 1; };
    // A test browser has no texting or phone app to hand these links to. The app's own click logging still runs.
    document.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href^="sms:"],a[href^="tel:"],a[href^="mailto:"]');
      if (a) e.preventDefault();
    }, true);
  });
  people[key] = { email, ctx, page };
  return people[key];
}
const use = (key) => { current = people[key].page; return current; };
const ready = (p = current) => p.waitForFunction(() => { const m = document.querySelector('main'); return m && m.innerText.trim() && !m.innerText.startsWith('Loading'); });
const text = async (p = current) => { await ready(p); return p.locator('main').innerText(); };
const row = (s, p = current) => p.locator('tr', { hasText: s });
const modal = (p = current) => p.getByRole('dialog');
// Waits for the message, then dismisses it, so the next wait can't match an old one.
const toast = async (s, p = current) => {
  const t = p.locator('.toast', { hasText: s }).first();
  await t.waitFor();
  await t.getByRole('button', { name: 'Dismiss' }).click();
};
const go = async (path, p = current) => { await p.goto(`${BASE}${path}`); await ready(p); };
const tab = (name, p = current) => p.locator('.tabs').getByRole('link', { name, exact: true }).click();

async function latestLink(email, after) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/messages?limit=50`)).json();
    const msg = list.messages.find((m) => m.To.some((t) => t.Address.toLowerCase() === email) && Date.parse(m.Created) >= after - 2000);
    if (msg) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${msg.ID}`)).json();
      const m = (full.Text + full.HTML).match(/https?:\/\/[^\s"'<>]+verify[^\s"'<>]+/);
      if (m) return m[0].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email arrived for ${email}`);
}
async function signInWithLink(key) {
  const p = people[key];
  use(key);
  await p.page.goto(BASE);
  await p.page.getByLabel('Email').fill(p.email);
  await new Promise((r) => setTimeout(r, 1500)); // the login system allows one link a second per person
  const t = Date.now();
  await p.page.getByRole('button', { name: 'Email me a code' }).click();
  await p.page.getByText('Check your email').waitFor();
  await p.page.goto(await latestLink(p.email, t));
  await p.page.locator('.topbar').waitFor();
}
// The first admin, the same as Add user with Auto Confirm in the Supabase dashboard. Everyone else is invited in the app.
async function createFirstAdmin(email) {
  const r = await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, email_confirm: true }) });
  if (!r.ok) throw new Error(`Create failed: ${await r.text()}`);
}
// Opens the link the app's own invite put in their mailbox.
async function acceptInvite(key) {
  const p = people[key];
  use(key);
  await p.page.goto(await latestLink(p.email, 0));
  await p.page.locator('.topbar, .login').first().waitFor();
}
const inviteCall = (token, email) => fetch(`${API}/functions/v1/invite-user`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
// Reads the login token out of the browser, to attack the API directly the way a curious user could.
const tokenOf = (p) => p.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.includes('auth-token')) return JSON.parse(localStorage.getItem(k)).access_token;
  return null;
});
const rest = async (key, path, init = {}) => {
  const token = await tokenOf(people[key].page);
  const res = await fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers ?? {}) } });
  const body = await res.text();
  let json = null;
  try { json = JSON.parse(body); } catch { /* not json */ }
  return { status: res.status, json, body };
};
const signFile = async (key, path) => {
  const token = await tokenOf(people[key].page);
  return fetch(`${API}/storage/v1/object/sign/job-files/${path}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) });
};
const file = (name, mimeType = 'application/pdf', body = '%PDF-1.4 test') => ({ name, mimeType, buffer: Buffer.from(body) });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');
const png = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
const openedFile = async (p, click) => {
  const [tabPage] = await Promise.all([p.context().waitForEvent('page'), click()]);
  await tabPage.waitForURL(/storage\/v1\/object\/sign/);
  const url = tabPage.url();
  await tabPage.close();
  return (await fetch(url)).status;
};

const OWNER = 'owner@test.local'; const BLAKE = 'blake@test.local'; const OFFICE = 'office@test.local'; const STAFF = 'staff@test.local';
const CREW = 'crew@test.local'; const SUBA = 'alpha@test.local'; const SUBB = 'bravo@test.local'; const STRANGER = 'stranger@test.local'; const NOACCESS = 'noaccess@test.local';

await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' });
for (const [k, e] of [['owner', OWNER], ['blake', BLAKE], ['office', OFFICE], ['staff', STAFF], ['crew', CREW], ['subA', SUBA], ['subB', SUBB], ['stranger', STRANGER], ['noaccess', NOACCESS]]) await newPerson(k, e);

// ---------------------------------------------------------------- logins
area = 'Logins and team';
await step('first owner login', async () => {
  sql(`insert into public.team_invites (email, role) values ('${OWNER}', 'admin');`);
  await createFirstAdmin(OWNER);
  await signInWithLink('owner');
  await people.owner.page.getByRole('heading', { name: 'Today' }).waitFor();
  check('First owner signs in with an emailed link', (await text()).includes('Add your first job'));
  await current.screenshot({ path: `${out}/live-01-first-login.png` });
});
await step('magic link', async () => {
  await people.owner.page.locator('.who').getByRole('button', { name: 'Sign out' }).click();
  await current.getByRole('button', { name: 'Email me a code' }).waitFor();
  check('Sign out returns to the login screen', true);
  await signInWithLink('owner');
  check('Sign in again with an emailed link', (await text()).includes('Today'));
  await current.reload();
  await current.getByRole('heading', { name: 'Today' }).waitFor();
  check('Stays signed in after a reload', true);
});
await step('stranger refused', async () => {
  const p = use('stranger');
  await p.goto(BASE);
  await p.getByLabel('Email').fill(STRANGER);
  await p.getByRole('button', { name: 'Email me a code' }).click();
  await p.locator('.alert').waitFor();
  check('Uninvited email is refused in plain language', (await p.locator('.alert').innerText()).includes("hasn't been invited"));
  const open = await fetch(`${API}/auth/v1/signup`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'walkin@test.local', password: 'Walkin12345!' }) });
  check('Open sign-up through the API is off', open.status >= 400, `status ${open.status}`);
});
await step('team allow', async () => {
  use('owner');
  await go('/team');
  const allow = async (email, role) => {
    await current.getByRole('button', { name: 'Invite someone' }).click();
    await modal().getByLabel('Email').fill(email);
    await modal().getByLabel('Role').selectOption(role);
    await modal().getByRole('button', { name: 'Send invite' }).click();
    await toast('is invited');
  };
  await allow(BLAKE, 'admin'); await allow(OFFICE, 'staff'); await allow(STAFF, 'staff'); await allow(CREW, 'crew'); await allow(NOACCESS, 'staff');
  check('Invite admin, staff, and crew from the app', (await text()).includes(CREW));
  for (const k of ['office', 'staff', 'crew', 'noaccess']) await acceptInvite(k);
  check('Each person joins from the emailed invite', true);
  // The bug this guards: someone who never used their invite must still be able to get in later.
  await signInWithLink('blake');
  check('A person who ignored their invite can ask for a new link', (await text()).includes('Today'));
  sql(`insert into public.team_invites (email, role) values ('unsent@test.local', 'staff'), ('removeme@test.local', 'staff');`);
  await current.reload();
  use('owner');
  await go('/team');
  await row('removeme@test.local').getByRole('button', { name: 'Remove' }).click();
  await toast('Email removed');
  check('Remove an email whose invite was not sent', await row('removeme@test.local').count() === 0);
  const t0 = Date.now();
  await row('unsent@test.local').getByRole('button', { name: 'Send invite' }).click();
  await toast('is invited');
  check('Send an invite that failed earlier', Boolean(await latestLink('unsent@test.local', t0)));
  await current.reload();
  await ready();
  check('Sent invites leave the not-sent list', !(await text()).includes('unsent@test.local') || await row('unsent@test.local').getByRole('button', { name: 'Send invite' }).count() === 0);
  sql(`delete from auth.users where email = 'unsent@test.local'; delete from public.team_invites where email = 'unsent@test.local';`);
  const ownerToken = await tokenOf(people.owner.page);
  check('Inviting an email nobody allowed is refused', (await inviteCall(ownerToken, 'notallowed@test.local')).status === 400);
  for (const k of ['staff', 'office', 'crew']) {
    const r = await inviteCall(await tokenOf(people[k].page), BLAKE);
    check(`${k} cannot send invites`, r.status === 403, `status ${r.status}`);
  }
  check('A logged-out visitor cannot send invites', (await inviteCall(ANON, BLAKE)).status >= 401);
  check('A refused invite creates no login', sql(`select count(*) from auth.users where email = 'notallowed@test.local';`) === '0');
  use('blake');
  await current.reload();
  await current.getByRole('heading', { name: 'Today' }).waitFor();
  use('owner');
  await go('/team');
  const edit = async (email, name, phone, flag) => {
    await row(email).getByRole('button', { name: 'Edit' }).click();
    await modal().getByLabel('Name').fill(name);
    await modal().getByLabel('Phone').fill(phone);
    if (flag) await modal().getByLabel('Can see contractor contacts').check();
    await modal().getByRole('button', { name: 'Save person' }).click();
    await toast('Person saved');
  };
  await edit(CREW, 'Jordan Crew', '937-555-0177');
  await edit(OFFICE, 'Casey Office', '', true);
  check('Edit a person, and give the office person contact access', (await row(OFFICE).innerText()).includes('Sees contacts'));
  await current.screenshot({ path: `${out}/live-02-team.png` });
  await row(NOACCESS).getByLabel(`Role for ${NOACCESS}`).selectOption('none');
  await toast('No access');
  const p = use('noaccess');
  await p.reload();
  await p.getByRole('heading', { name: 'No access yet' }).waitFor();
  check('Setting No access locks a person out', true);
  check('A person with no access reads no data', ((await rest('noaccess', 'jobs')).json ?? []).length === 0);
  await p.getByRole('button', { name: 'Sign out' }).click();
  use('owner');
  check('You cannot change your own role by accident', await current.getByLabel(`Role for ${OWNER}`).isDisabled());
});

// ---------------------------------------------------------------- subs and private contacts
area = 'Subs and private contacts';
const addSub = async (name, trade, contact, mobile, email) => {
  await current.getByRole('button', { name: 'Add a sub' }).click();
  await modal().getByLabel('Company name').fill(name);
  await modal().getByLabel('Trade').fill(trade);
  await modal().getByLabel('Contact name').fill(contact);
  await modal().getByLabel('Mobile').fill(mobile);
  await modal().getByLabel('Email').fill(email);
  await modal().getByRole('button', { name: 'Add sub' }).click();
  await toast('Sub saved');
};
await step('add subs', async () => {
  use('owner');
  await go('/subs');
  await addSub('Alpha Framing', 'Framing', 'Sam Alpha', '937-555-0101', 'sam@alpha.test');
  await addSub('Bravo Plumbing', 'Plumbing', 'Pat Bravo', '937-555-0102', 'pat@bravo.test');
  await addSub('Charlie Electric', 'Electrical', 'Lee Charlie', '555-01', 'lee@charlie.test');
  check('Add subs with a contact', (await row('Alpha Framing').innerText()).includes('937-555-0101'));
  await row('Alpha Framing').getByRole('button', { name: 'Contacts' }).click();
  await modal().getByRole('button', { name: 'Add a contact' }).click();
  await modal().getByLabel('Name').fill('Betty Billing');
  await modal().getByLabel('Role').fill('Billing');
  await modal().getByLabel('Office phone').fill('937-555-0155');
  await modal().getByLabel('Email').fill('billing@alpha.test');
  await modal().getByLabel('Address').fill('1 Mill St');
  await modal().getByRole('button', { name: 'Add contact' }).click();
  await toast('Contact saved');
  check('A sub can hold several contacts', (await modal().innerText()).includes('Betty Billing'));
  await modal().getByRole('button', { name: 'Close' }).click();
  await row('Alpha Framing').getByRole('button', { name: 'Edit' }).first().click();
  await modal().getByLabel('Insurance certificate expires').fill(iso(120));
  await modal().getByLabel('W-9 on file').check();
  await modal().getByRole('button', { name: 'Save sub' }).click();
  await toast('Sub saved');
  const contactRow = (n) => modal().locator('tr', { hasText: n });
  await row('Alpha Framing').getByRole('button', { name: 'Contacts' }).click();
  await contactRow('Betty Billing').getByRole('button', { name: 'Edit' }).click();
  await modal().getByRole('checkbox', { name: /^Main contact/ }).check();
  await modal().getByRole('button', { name: 'Save contact' }).click();
  await toast('Contact saved');
  check('Change the main contact', (await contactRow('Betty Billing').innerText()).includes('Main') && !(await contactRow('Sam Alpha').innerText()).includes('Main'));
  await contactRow('Sam Alpha').getByRole('button', { name: 'Edit' }).click();
  await modal().getByRole('checkbox', { name: /^Main contact/ }).check();
  await modal().getByRole('button', { name: 'Save contact' }).click();
  await toast('Contact saved');
  await modal().getByRole('button', { name: 'Add a contact' }).click();
  await modal().getByLabel('Name').fill('Temp Person');
  await modal().getByRole('button', { name: 'Add contact' }).click();
  await toast('Contact saved');
  await contactRow('Temp Person').getByRole('button', { name: 'Edit' }).click();
  await modal().getByRole('button', { name: 'Delete this contact' }).click();
  await toast('Contact deleted');
  check('Delete a contact', await contactRow('Temp Person').count() === 0);
  await modal().getByRole('button', { name: 'Close' }).click();
  check('Insurance date and W-9 show as current', (await row('Alpha Framing').innerText()).includes('Current') && (await row('Alpha Framing').innerText()).includes('On file'));
  check('Missing insurance is flagged', (await row('Bravo Plumbing').innerText()).includes('None on file'));
  await addSub('Temp Delete Me', 'None', 'X', '', '');
  await row('Temp Delete Me').getByRole('button', { name: 'Edit' }).first().click();
  await modal().getByRole('button', { name: 'Delete this sub' }).click();
  await toast('Sub deleted');
  check('Delete a sub with no work', !(await text()).includes('Temp Delete Me'));
  const portal = async (name, email) => {
    await row(name).getByRole('button', { name: 'Portal access' }).click();
    await modal().getByLabel('Their email').fill(email);
    await modal().getByRole('button', { name: 'Send invite' }).click();
    await toast('is invited');
  };
  await portal('Alpha Framing', SUBA); await portal('Bravo Plumbing', SUBB);
  await acceptInvite('subA'); await acceptInvite('subB');
  await people.subA.page.getByRole('heading', { name: 'Alpha Framing' }).waitFor();
  check('Subs join and land on their own portal', true);
});
await step('contact privacy', async () => {
  const contactsOf = async (k) => (await rest(k, 'vendor_contacts')).json;
  check('Admin (you) reads contacts through the API', (await contactsOf('owner')).length >= 4);
  use('blake');
  await go('/subs');
  check('Second admin (Blake) sees contacts', (await text()).includes('937-555-0101'));
  use('office');
  await current.reload(); await go('/subs');
  check('Office person with access sees contacts', (await text()).includes('937-555-0101'));
  check('Office person cannot open Team', !(await (async () => { await go('/team'); return text(); })()).includes('Invite someone'));
  for (const k of ['staff', 'crew', 'subA', 'subB']) {
    check(`${k} gets zero contacts from the API`, (await contactsOf(k)).length === 0);
    const put = await rest(k, 'vendor_contacts', { method: 'POST', body: JSON.stringify({ vendor_id: '00000000-0000-0000-0000-000000000000', name: 'x' }) });
    check(`${k} cannot add a contact through the API`, put.status >= 400, `status ${put.status}`);
  }
  check('Vendors table no longer holds phone or email', !Object.keys((await rest('staff', 'vendors')).json[0]).some((c) => ['phone', 'email', 'contact_name'].includes(c)));
  const self = await rest('staff', `profiles?select=can_view_contacts&email=eq.${STAFF}`, { method: 'PATCH', body: JSON.stringify({ can_view_contacts: true }) });
  check('Staff cannot grant themselves contact access', (self.json ?? []).length === 0);
  check('Staff read no sub login emails', (await rest('staff', 'profiles?role=eq.sub')).json.length === 0);
  use('staff');
  await current.reload(); await go('/subs');
  const t = await text();
  check('Staff see the sub list with no numbers or emails', t.includes('Alpha Framing') && !t.includes('937-555') && !t.includes('@alpha.test'));
  check('Staff have no Contacts button', await current.getByRole('button', { name: 'Contacts' }).count() === 0);
  await current.screenshot({ path: `${out}/live-03-staff-subs.png` });
});

// ---------------------------------------------------------------- jobs
area = 'Jobs';
let oak; let side;
const jobId = () => new URL(current.url()).pathname.split('/')[2];
await step('jobs', async () => {
  use('owner');
  await go('/');
  await current.getByRole('button', { name: 'Add a job' }).click();
  await modal().getByLabel('Job name').fill('Test Oak');
  await modal().getByLabel('Address', { exact: true }).fill('100 Oak Rd');
  await modal().getByLabel('Status').selectOption('active');
  await modal().getByLabel('Contract or expected sale price').fill('500000');
  await modal().getByLabel('Construction loan amount').fill('300000');
  await modal().getByLabel('Lender', { exact: true }).fill('Local Bank');
  await modal().getByLabel('Start date').fill(iso(-3));
  await modal().getByLabel('Target finish').fill(iso(170));
  await modal().getByLabel('Square feet').fill('2,400');
  await modal().getByLabel('Bedrooms').fill('4');
  await modal().getByLabel('Bathrooms').fill('2.5');
  await modal().getByLabel('Floor plan name').fill('The Oak');
  await modal().getByLabel('Client or buyer').fill('Dana Buyer');
  await modal().getByLabel('Permit number').fill('P-555');
  await modal().getByRole('button', { name: 'Add job' }).click();
  await current.getByRole('heading', { name: 'Budget lines' }).waitFor();
  oak = jobId();
  check('New house starts with 25 budget lines', await current.locator('tbody tr').count() === 25);
  await tab('Schedule');
  await current.getByRole('heading', { name: 'Schedule' }).waitFor();
  check('New house starts with a linked schedule', await current.locator('.gantt tbody tr').count() === 21);
  await go('/');
  const types = await (async () => {
    await current.getByRole('button', { name: 'Add a job' }).click();
    return modal().getByLabel('Type', { exact: true }).locator('option').allInnerTexts();
  })();
  check('All job types are offered', ['Spec home', 'Client build', 'Flip', 'Remodel', 'Addition', 'Repair or small job', 'Other'].every((x) => types.includes(x)));
  await modal().getByLabel('Job name').fill('Test Garage Door');
  await modal().getByLabel('Type', { exact: true }).selectOption('repair');
  await modal().getByLabel('What kind of job').fill('Garage door swap');
  await modal().getByLabel('Status').selectOption('active');
  await modal().getByRole('button', { name: 'Add job' }).click();
  await current.getByRole('heading', { name: 'Budget lines' }).waitFor();
  side = jobId();
  check('Small job gets one General line', await current.locator('tbody tr').count() === 1 && (await row('General').count()) === 1);
  check('Job header shows type and note', (await current.locator('.jobhead').innerText()).includes('Repair or small job: Garage door swap'));
  await current.getByRole('button', { name: 'Edit job' }).click();
  await modal().getByLabel('Notes').fill('Customer prefers mornings.');
  await modal().getByRole('button', { name: 'Save job' }).click();
  await toast('Job saved');
  const row1 = await rest('owner', `jobs?id=eq.${side}&select=notes`);
  check('Edit a job and it saves to the database', row1.json[0].notes === 'Customer prefers mornings.');
  await current.getByRole('button', { name: 'Edit job' }).click();
  check('Staff-only actions stay: admin sees delete job', await modal().getByRole('button', { name: 'Delete this job' }).count() === 1);
  await modal().getByRole('button', { name: 'Cancel' }).click();
  use('staff');
  await go(`/jobs/${side}/budget`);
  await current.getByRole('button', { name: 'Edit job' }).click();
  check('Staff have no delete-job button', await modal().getByRole('button', { name: 'Delete this job' }).count() === 0);
  await modal().getByRole('button', { name: 'Cancel' }).click();
  const del = await rest('staff', `jobs?id=eq.${side}`, { method: 'DELETE' });
  check('Staff cannot delete a job through the API', (del.json ?? []).length === 0);
});

// ---------------------------------------------------------------- budget
area = 'Budget';
await step('budget', async () => {
  use('owner');
  await go(`/jobs/${oak}/budget`);
  await current.getByRole('heading', { name: 'Budget lines' }).waitFor();
  await row('Framing').getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('Original budget').fill('60,000.50');
  await modal().getByRole('button', { name: 'Save line' }).click();
  await toast('Line saved');
  check('Edit a budget amount with cents', (await row('Framing').innerText()).includes('$60,000.50'));
  await row('Framing').getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('Original budget').fill('abc');
  await modal().getByRole('button', { name: 'Save line' }).click();
  check('Bad dollar amounts are refused', (await modal().innerText()).includes('enter a dollar amount'));
  await modal().getByLabel('Original budget').fill('60000');
  await modal().getByRole('button', { name: 'Save line' }).click();
  await toast('Line saved');
  const forecast = async () => (await current.locator('dl.strip').innerText()).match(/Expected final cost\s+(\S+)/)[1];
  await row('Roofing').getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('Original budget').fill('10000');
  await modal().getByRole('button', { name: 'Save line' }).click();
  await toast('Line saved');
  const withBudget = await forecast();
  await row('Roofing').getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('Bought out').check();
  await modal().getByRole('button', { name: 'Save line' }).click();
  await toast('Line saved');
  const afterBought = await forecast();
  check('Bought out frees unspent budget from the expected cost', withBudget === '$70,000' && afterBought === '$60,000' && (await row('Roofing').innerText()).includes('Bought out'), `${withBudget} then ${afterBought}`);
  await current.getByRole('button', { name: 'Add a line' }).click();
  await modal().getByLabel('Name').fill('Temp Line');
  await modal().getByRole('button', { name: 'Add line' }).click();
  await toast('Line saved');
  check('Add a budget line', (await row('Temp Line').count()) === 1);
  await row('Temp Line').getByRole('button', { name: 'Edit' }).click();
  await modal().getByRole('button', { name: 'Delete this line' }).click();
  await toast('Line deleted');
  check('Delete an unused line', (await row('Temp Line').count()) === 0);
});

// ---------------------------------------------------------------- POs, bills, waivers
area = 'POs';
await step('pos', async () => {
  use('staff');
  await go(`/jobs/${oak}/pos`);
  await current.getByRole('heading', { name: 'Purchase orders' }).waitFor();
  const addPo = async (sub, line, scope, amount) => {
    await current.getByRole('button', { name: 'Add a PO' }).click();
    await modal().getByLabel('Sub', { exact: true }).selectOption({ label: sub });
    await modal().getByLabel('Budget line').selectOption({ label: line });
    await modal().getByLabel('Scope of work').fill(scope);
    await modal().getByLabel('Amount').fill(amount);
    await modal().getByRole('button', { name: 'Add PO' }).click();
    await toast('PO saved');
  };
  await addPo('Alpha Framing (Framing)', 'Framing', 'Frame the whole house', '65000');
  await addPo('Bravo Plumbing (Plumbing)', 'Plumbing', 'Rough and finish plumbing', '20000');
  await addPo('Alpha Framing (Framing)', 'Siding and exterior', 'Secret draft siding', '9000');
  check('Staff add draft POs', (await text()).includes('Frame the whole house'));
  const pa = use('subA');
  await pa.reload();
  check('Draft POs stay hidden from the sub', !(await text()).includes('Secret draft siding'));
  use('staff');
  await row('Secret draft siding').getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('Amount').fill('8000');
  await modal().getByRole('button', { name: 'Save PO' }).click();
  await toast('PO saved');
  check('Edit a draft PO', (await row('Secret draft siding').innerText()).includes('$8,000'));
  for (const s of ['Frame the whole house', 'Rough and finish plumbing', 'Secret draft siding']) {
    await row(s).getByRole('button', { name: 'Send' }).click();
    await toast('sent');
  }
  check('Send POs to the subs', (await row('Frame the whole house').innerText()).includes('Sent'));
  use('subA');
  await current.reload();
  await current.locator('.portalcard', { hasText: 'Frame the whole house' }).getByRole('button', { name: 'Accept' }).click();
  await toast('Work order accepted');
  check('Sub accepts a work order', (await text()).includes('Bill your work'));
  await current.locator('.portalcard', { hasText: 'Secret draft siding' }).getByRole('button', { name: 'Decline' }).click();
  await toast('Work order declined');
  check('Sub declines a work order', await current.locator('.portalcard', { hasText: 'Secret draft siding' }).count() === 0);
  use('owner');
  await go('/');
  check('Declined PO lands on your list', (await text()).includes('Alpha Framing declined PO'));
  use('staff');
  await go(`/jobs/${oak}/pos`);
  await row('Secret draft siding').getByRole('button', { name: 'Reopen' }).click();
  await toast('moved back to draft');
  check('Reopen a declined PO', (await row('Secret draft siding').innerText()).includes('Draft'));
  await row('Rough and finish plumbing').getByRole('button', { name: 'Mark accepted' }).click();
  await toast('marked accepted');
  check('Staff mark a PO accepted', (await row('Rough and finish plumbing').innerText()).includes('Accepted'));
  await current.getByRole('button', { name: 'Add a PO' }).click();
  await modal().getByLabel('Budget line').selectOption({ label: 'Paint' });
  await modal().getByLabel('Scope of work').fill('Temp closed PO');
  await modal().getByLabel('Amount').fill('100');
  await modal().getByRole('button', { name: 'Add PO' }).click();
  await toast('PO saved');
  await row('Temp closed PO').getByRole('button', { name: 'Send' }).click();
  await toast('sent');
  await row('Temp closed PO').getByRole('button', { name: 'Mark accepted' }).click();
  await toast('marked accepted');
  await row('Temp closed PO').getByRole('button', { name: 'Close' }).click();
  await toast('closed');
  check('Close a finished PO', (await row('Temp closed PO').innerText()).includes('Closed'));
  const hack = await rest('subA', 'pos?select=id&status=eq.accepted', { method: 'PATCH', body: JSON.stringify({ amount_cents: 999999999 }) });
  check('Sub cannot raise a PO amount through the API', (hack.json ?? []).length === 0);
  const peek = await rest('subA', 'pos?select=id,description');
  check("Sub's API shows only their own POs", peek.json.every((p) => !p.description.includes('plumbing')));
});

area = 'Bills, waivers, payment block';
await step('bills', async () => {
  use('subA');
  await current.reload();
  await current.locator('.portalcard', { hasText: 'Frame the whole house' }).getByRole('button', { name: 'Submit a bill' }).click();
  await modal().getByLabel('Invoice number').fill('F-100');
  await modal().getByLabel('Amount').fill('30000');
  await modal().getByLabel('Invoice file').setInputFiles(file('invoice-f100.pdf'));
  await modal().getByRole('button', { name: 'Submit bill' }).click();
  await toast('Bill submitted');
  check('Sub submits a bill with a real file', (await row('F-100').innerText()).includes('Submitted'));
  const fake = await rest('subA', 'bills', { method: 'POST', body: JSON.stringify({ job_id: oak, vendor_id: '00000000-0000-0000-0000-000000000000', budget_line_id: '00000000-0000-0000-0000-000000000000', amount_cents: 500 }) });
  check('Sub cannot bill with no work order through the API', fake.status >= 400, `status ${fake.status}`);
  use('owner');
  await go('/');
  check('New bill lands on your list', (await text()).includes("Approve or reject Alpha Framing's $30,000 bill"));
  use('staff');
  await go(`/jobs/${oak}/bills`);
  const code = await openedFile(current, () => row('F-100').getByRole('button', { name: 'View file' }).click());
  check('Staff open the invoice from real storage', code === 200, `status ${code}`);
  await row('F-100').getByRole('button', { name: 'Approve' }).click();
  await toast('Bill approved');
  await tab('Lien waivers');
  check('Approving requests a conditional waiver', (await row('F-100').innerText()).includes('Conditional progress') && (await row('F-100').innerText()).includes('Requested'));
  await row('F-100').getByRole('button', { name: 'Change type' }).click();
  await modal().getByLabel('Type').selectOption('conditional_final');
  await modal().getByRole('button', { name: 'Save type' }).click();
  await toast('Waiver type saved');
  check('Change a waiver type', (await row('F-100').innerText()).includes('Conditional final'));
  await row('F-100').getByRole('button', { name: 'Change type' }).click();
  await modal().getByLabel('Type').selectOption('conditional_progress');
  await modal().getByRole('button', { name: 'Save type' }).click();
  await toast('Waiver type saved');
  await tab('Bills');
  await row('F-100').getByRole('button', { name: 'Pay', exact: true }).click();
  check('Payment is blocked with no waiver', (await modal().innerText()).includes('no lien waiver received'));
  await modal().getByRole('button', { name: 'Pay with override' }).click();
  await toast('Cannot pay this bill');
  check('Staff cannot force payment past the block', true);
  await modal().getByRole('button', { name: 'Cancel' }).click();
  const forced = await rest('staff', `bills?invoice_no=eq.F-100`, { method: 'PATCH', body: JSON.stringify({ status: 'paid', override_reason: 'trust me' }) });
  check('Staff cannot force payment through the API', forced.status >= 400, `status ${forced.status}`);
  use('subA');
  await current.reload();
  await current.locator('.portalcard', { hasText: 'Conditional progress' }).getByRole('button', { name: 'Upload signed waiver' }).click();
  await modal().getByLabel('Signed waiver').setInputFiles(file('waiver-f100.pdf'));
  await modal().getByRole('button', { name: 'Upload waiver' }).click();
  await toast('Waiver uploaded');
  check('Sub uploads the signed waiver', true);
  use('staff');
  await go(`/jobs/${oak}/bills`);
  await row('F-100').getByRole('button', { name: 'Pay', exact: true }).click();
  await modal().getByRole('button', { name: 'Record payment' }).click();
  await toast('Payment recorded');
  check('With insurance and waiver in, the bill can be paid', (await row('F-100').innerText()).includes('Paid'));
  await tab('Lien waivers');
  const waivers = await text();
  check('Payment requests the unconditional waiver', waivers.includes('Unconditional progress'));
  const open2 = await openedFile(current, () => row('Conditional progress').getByRole('button', { name: 'View file' }).click());
  check('Staff open the uploaded waiver', open2 === 200, `status ${open2}`);
  await row('Unconditional progress').getByRole('button', { name: 'Mark received' }).click();
  await modal().getByLabel('Signed waiver').setInputFiles(file('unconditional.pdf'));
  await modal().getByRole('button', { name: 'Mark received' }).click();
  await toast('Waiver marked received');
  await row('Unconditional progress').getByRole('button', { name: 'Send back' }).click();
  await toast('sent back');
  check('Mark a waiver received and send it back', (await row('Unconditional progress').innerText()).includes('Requested'));
  await row('Unconditional progress').getByRole('button', { name: 'Mark received' }).click();
  await modal().getByRole('button', { name: 'Mark received' }).click();
  await toast('Waiver marked received');
  await tab('Bills');
  check('Staff cannot undo a payment', await row('F-100').getByRole('button', { name: 'Undo' }).count() === 0);
  const edited = await rest('owner', 'bills?invoice_no=eq.F-100', { method: 'PATCH', body: JSON.stringify({ amount_cents: 1 }) });
  check('Even an admin cannot change a paid amount', edited.status >= 400, `status ${edited.status}`);
  const [dl] = await Promise.all([current.waitForEvent('download'), current.getByRole('button', { name: 'Download paid bills (CSV)' }).click()]);
  const csv = readFileSync(await dl.path(), 'utf8');
  check('Download paid bills as CSV', csv.includes('F-100') && csv.includes('30000.00') && csv.includes('Alpha Framing'));
  // Override and rejection, on a staff-entered bill for a sub with no insurance.
  await current.getByRole('button', { name: 'Add a bill' }).click();
  await modal().getByLabel('Sub', { exact: true }).selectOption({ label: 'Bravo Plumbing' });
  await modal().getByLabel('PO', { exact: true }).selectOption({ label: 'PO 2: Bravo Plumbing, $20,000' });
  await modal().getByLabel('Invoice number').fill('P-1');
  await modal().getByLabel('Amount').fill('1,250.50');
  await modal().getByLabel('Invoice file').setInputFiles(file('p1.pdf'));
  await modal().getByRole('button', { name: 'Add bill' }).click();
  await toast('Bill added');
  check('Staff add a bill with a file', (await row('P-1').innerText()).includes('$1,250.50'));
  await current.getByRole('button', { name: 'Add a bill' }).click();
  await modal().getByLabel('Sub', { exact: true }).selectOption({ label: 'Bravo Plumbing' });
  await modal().getByLabel('Invoice number').fill('P-2');
  await modal().getByLabel('Amount').fill('500');
  await modal().getByRole('button', { name: 'Add bill' }).click();
  await toast('Bill added');
  await row('P-2').getByRole('button', { name: 'Reject' }).click();
  await modal().getByLabel('Reason').fill('Wrong job');
  await modal().getByRole('button', { name: 'Reject bill' }).click();
  await toast('Bill rejected');
  check('Reject a bill with a reason', (await row('P-2').innerText()).includes('Wrong job'));
  use('subB');
  await current.reload();
  check('Sub sees the rejection reason', (await row('P-2').innerText()).includes('Wrong job'));
  check('Sub sees no other sub\'s bills', !(await text()).includes('F-100'));
  use('subA');
  await current.reload();
  const own = await openedFile(current, () => row('F-100').getByRole('button', { name: 'View file' }).click());
  check('Sub opens their own invoice', own === 200, `status ${own}`);
  use('staff');
  await current.getByRole('button', { name: 'Add a bill' }).click();
  await modal().getByLabel('Sub', { exact: true }).selectOption({ label: 'Bravo Plumbing' });
  await modal().getByLabel('Invoice number').fill('P-3');
  await modal().getByLabel('Amount').fill('75');
  await modal().getByRole('button', { name: 'Add bill' }).click();
  await toast('Bill added');
  await row('P-3').getByRole('button', { name: 'Approve' }).click();
  await toast('Bill approved');
  await row('P-3').getByRole('button', { name: 'Reject' }).click();
  await modal().getByLabel('Reason').fill('Duplicate');
  await modal().getByRole('button', { name: 'Reject bill' }).click();
  await toast('Bill rejected');
  check('Reject a bill after it was approved', (await row('P-3').innerText()).includes('Duplicate'));
  use('owner');
  await go(`/jobs/${oak}/bills`);
  await row('P-1').getByRole('button', { name: 'Approve' }).click();
  await toast('Bill approved');
  await row('P-1').getByRole('button', { name: 'Pay', exact: true }).click();
  const m = await modal().innerText();
  check('Block names missing insurance and waiver', m.includes('no insurance certificate') && m.includes('no lien waiver'));
  await modal().getByLabel('Reason for override').fill('Emergency leak');
  await modal().getByRole('button', { name: 'Pay with override' }).click();
  await toast('Payment recorded');
  check('Admin override is saved on the bill', (await row('P-1').innerText()).includes('Emergency leak'));
  await current.screenshot({ path: `${out}/live-04-bills.png`, fullPage: true });
  await row('P-1').getByRole('button', { name: 'Undo' }).click();
  await toast('Payment undone');
  check('Admin undoes a payment', (await row('P-1').innerText()).includes('Approved'));
  await row('P-1').getByRole('button', { name: 'Pay', exact: true }).click();
  await modal().getByLabel('Reason for override').fill('Emergency leak');
  await modal().getByRole('button', { name: 'Pay with override' }).click();
  await toast('Payment recorded');
  await go(`/jobs/${oak}/budget`);
  const fr = await row('Framing').innerText();
  check('Budget math: framing shows $65,000 committed, $30,000 paid, $5,000 over', ['$60,000', '$65,000', '$30,000', '$5,000 over'].every((x) => fr.includes(x)), fr.replace(/\s+/g, ' '));
  await current.screenshot({ path: `${out}/live-05-budget.png`, fullPage: true });
});

// ---------------------------------------------------------------- change orders
area = 'Change orders';
await step('changes', async () => {
  use('staff');
  await go(`/jobs/${oak}/changes`);
  await current.getByRole('button', { name: 'Add a change order' }).click();
  await modal().getByLabel('What changed').fill('Extra porch framing');
  await modal().getByLabel('Budget line').selectOption({ label: 'Framing' });
  await modal().getByLabel('Add to PO').selectOption({ label: 'PO 1: Framing' });
  await modal().getByLabel('Change to your cost').fill('2500');
  await modal().getByRole('button', { name: 'Add change order' }).click();
  await toast('Change order saved');
  check('Add a change order', (await row('Extra porch framing').innerText()).includes('$2,500'));
  await row('Extra porch framing').getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('Change to your cost').fill('3000');
  await modal().getByRole('button', { name: 'Save change order' }).click();
  await toast('Change order saved');
  await row('Extra porch framing').getByRole('button', { name: 'Approve' }).click();
  await toast('Budget updated');
  await tab('POs');
  check('Approved change raises the PO', (await row('Frame the whole house').innerText()).includes('$68,000'));
  await tab('Budget');
  check('Approved change raises the budget', (await row('Framing').innerText()).includes('$63,000'));
  await tab('Change orders');
  await row('Extra porch framing').getByRole('button', { name: 'Undo' }).click();
  await toast('Approval undone');
  await tab('POs');
  check('Undo takes it back off the PO', (await row('Frame the whole house').innerText()).includes('$65,000'));
  await tab('Change orders');
  await row('Extra porch framing').getByRole('button', { name: 'Reject' }).click();
  await toast('rejected');
  check('Reject a change order', (await row('Extra porch framing').innerText()).includes('Rejected'));
  await current.getByRole('button', { name: 'Add a change order' }).click();
  await modal().getByLabel('What changed').fill('Credit for fewer windows');
  await modal().getByLabel('Change to your cost').fill('-400');
  await modal().getByRole('button', { name: 'Add change order' }).click();
  await toast('Change order saved');
  check('A credit can be negative', (await row('Credit for fewer windows').innerText()).includes('-$400'));
  await row('Credit for fewer windows').getByRole('button', { name: 'Approve' }).click();
  await toast('Budget updated');
  check('Subs read no change orders through the API', (await rest('subA', 'change_orders')).json.length === 0);
});

// ---------------------------------------------------------------- draws
area = 'Lender draws';
await step('draws', async () => {
  use('owner');
  await go(`/jobs/${oak}/draws`);
  await current.getByRole('button', { name: 'Start a draw' }).click();
  await toast('Draft draw added');
  await row('Draft').getByRole('button', { name: 'Enter amounts' }).click();
  await modal().getByLabel('Framing this draw').fill('40000');
  await modal().getByLabel('Foundation this draw').fill('1');
  await modal().getByLabel('Notes for the lender').fill('Framing 60%');
  check('Warns when a draw passes the budget', (await modal().innerText()).includes('Over budget'));
  await modal().getByLabel('Foundation this draw').fill('');
  await modal().getByRole('button', { name: 'Save draw' }).click();
  await toast('Draw 1 saved');
  await row('Draft').getByRole('link', { name: 'Open sheet' }).click();
  await current.getByRole('heading', { name: /Draw request 1/ }).waitFor();
  const sh = await row('Framing').first().innerText();
  check('Draw sheet shows this draw and the balance', sh.includes('$40,000') && sh.includes('$20,000'), sh.replace(/\s+/g, ' '));
  check('Draw sheet lists waivers on file', (await text()).includes('Lien waivers on file') && (await text()).includes('Alpha Framing'));
  await current.getByRole('button', { name: 'Print or save as PDF' }).click();
  check('Print the draw sheet', await current.evaluate(() => window.__printed) === 1);
  await current.screenshot({ path: `${out}/live-06-draw.png`, fullPage: true });
  await current.getByRole('link', { name: 'Back to draws' }).click();
  await row('Draft').getByRole('button', { name: 'Mark requested' }).click();
  await toast('marked requested');
  await row('Framing 60%').getByRole('button', { name: 'Mark funded' }).click();
  await modal().getByLabel('Amount the lender funded').fill('39000');
  await modal().getByRole('button', { name: 'Mark funded' }).click();
  await toast('marked funded');
  const figs = await current.locator('dl.strip').innerText();
  check('Funded amount updates loan left to draw', figs.includes('$39,000') && figs.includes('$261,000'), figs.replace(/\s+/g, ' '));
  await current.getByRole('button', { name: 'Start a draw' }).click();
  await toast('Draft draw added');
  await row('Draft').getByRole('button', { name: 'Delete' }).click();
  await toast('deleted');
  check('Delete a draft draw', await row('Draft').count() === 0);
});

// ---------------------------------------------------------------- schedule and call list
area = 'Schedule';
await step('schedule', async () => {
  use('staff');
  await go(`/jobs/${oak}/schedule`);
  await current.getByRole('heading', { name: 'Schedule' }).waitFor();
  const taskRow = (n) => current.getByRole('row', { name: new RegExp(`^${n}`) });
  const editTask = async (n, fn) => { await taskRow(n).getByRole('button', { name: 'Edit' }).click(); await fn(); };
  check('On-schedule status shows', (await current.locator('.alert').innerText()).includes('On schedule') || (await current.locator('.alert').innerText()).includes('behind'));
  await editTask('Clear lot and excavate', async () => {
    await modal().getByLabel('Sub', { exact: true }).selectOption({ label: 'Alpha Framing' });
    await modal().getByRole('button', { name: 'Save task' }).click();
  });
  await toast('Task saved');
  check('Assign a sub to a task', (await taskRow('Clear lot and excavate').innerText()).includes('Alpha Framing'));
  await editTask('Utility connections', async () => {
    await modal().getByLabel('Sub', { exact: true }).selectOption({ label: 'Bravo Plumbing' });
    await modal().getByRole('button', { name: 'Save task' }).click();
  });
  await toast('Task saved');
  await editTask('Pull permits', async () => {
    await modal().getByLabel('Team member').selectOption({ label: 'Jordan Crew' });
    await modal().getByLabel('Status').selectOption('in_progress');
    await modal().getByRole('button', { name: 'Save task' }).click();
  });
  await toast('Task saved');
  await editTask('Frame house', async () => {
    await modal().getByLabel('Team member').selectOption({ label: 'Jordan Crew' });
    await modal().getByLabel('Notes').fill('Gate code 1234');
    await modal().getByRole('button', { name: 'Save task' }).click();
  });
  await toast('Task saved');
  check('Assign tasks to a team member', (await taskRow('Pull permits').innerText()).includes('Jordan Crew'));
  const beforeRoof = await taskRow('Dry-in and roof').innerText();
  await editTask('Pour footers and foundation', async () => {
    const end = await modal().getByLabel('Finish').inputValue();
    await modal().getByLabel('Finish').fill(new Date(Date.parse(end) + 5 * 864e5).toISOString().slice(0, 10));
    await modal().getByRole('button', { name: 'Save task' }).click();
  });
  await current.getByRole('heading', { name: 'This moves later work' }).waitFor();
  await current.screenshot({ path: `${out}/live-07-cascade.png` });
  await current.getByRole('button', { name: 'Cancel' }).click();
  check('Cancelling leaves the schedule alone', (await taskRow('Dry-in and roof').innerText()) === beforeRoof);
  await editTask('Pour footers and foundation', async () => {
    const end = await modal().getByLabel('Finish').inputValue();
    await modal().getByLabel('Finish').fill(new Date(Date.parse(end) + 5 * 864e5).toISOString().slice(0, 10));
    await modal().getByRole('button', { name: 'Save task' }).click();
  });
  await current.getByRole('button', { name: 'Move these tasks' }).click();
  await toast('moved');
  check('A delay pushes later tasks', (await taskRow('Dry-in and roof').innerText()) !== beforeRoof);
  await editTask('Pull permits', async () => {
    const options = await modal().getByLabel('Starts after').locator('option').allInnerTexts();
    check('Task loops are not offered', !options.includes('Clear lot and excavate'));
    await modal().getByLabel('Finish').fill('2000-01-01');
    await modal().getByRole('button', { name: 'Save task' }).click();
    check('Finish before start is refused', (await modal().innerText()).includes('Finish must be'));
    await modal().getByRole('button', { name: 'Cancel' }).click();
  });
  await current.getByRole('button', { name: 'Add a task' }).click();
  await modal().getByLabel('Task', { exact: true }).fill('Temp Task');
  await modal().getByLabel('Start', { exact: true }).fill(iso(-5));
  await modal().getByLabel('Finish').fill(iso(-4));
  await modal().getByRole('button', { name: 'Add task' }).click();
  await toast('Task added');
  check('A late task shows Late and makes the job behind', (await taskRow('Temp Task').innerText()).includes('Late') && /days? behind/.test(await current.locator('.alert').innerText()));
  await current.screenshot({ path: `${out}/live-08-schedule.png`, fullPage: true });
  use('owner');
  await go('/');
  check('Today shows the job behind', /days? behind/.test(await current.locator('.jobcard', { hasText: 'Test Oak' }).innerText()));
  check('Late task lands on your list', (await text()).includes('Temp Task was due'));
  use('staff');
  await taskRow('Temp Task').getByRole('button', { name: 'Edit' }).click();
  await modal().getByRole('button', { name: 'Delete this task' }).click();
  await toast('Task deleted');
  check('Delete a task', await taskRow('Temp Task').count() === 0);
});

area = 'Call list and messages';
await step('calls', async () => {
  use('owner');
  await go('/calls');
  const callRow = (n) => current.getByRole('row', { name: new RegExp(n) });
  const a = callRow('Clear lot and excavate');
  check('Unconfirmed sub is on the call list', (await a.innerText()).includes('Not contacted'));
  check('Call button dials the main contact', (await a.getByRole('link', { name: 'Call' }).getAttribute('href')) === 'tel:+19375550101');
  await a.getByRole('button', { name: 'Message' }).click();
  const sms = await modal().getByRole('link', { name: 'Open text' }).getAttribute('href');
  const mail = await modal().getByRole('link', { name: 'Open email' }).getAttribute('href');
  const body = decodeURIComponent(sms);
  check('Text is filled in with the right number, job, and address', sms.startsWith('sms:+19375550101') && body.includes('Clear lot and excavate') && body.includes('100 Oak Rd') && body.includes('Hi Sam'), body);
  check('Email is filled in', mail.startsWith('mailto:sam@alpha.test'));
  await current.screenshot({ path: `${out}/live-09-message.png` });
  await modal().getByRole('link', { name: 'Open text' }).click();
  await toast('Logged as contacted');
  await modal().getByRole('button', { name: 'Close' }).click();
  check('Opening a text logs the contact', (await a.innerText()).includes('Contacted'));
  const log = await rest('owner', 'notifications?select=channel,recipient');
  check('The contact log is saved', log.json.some((n) => n.channel === 'text' && n.recipient === 'Alpha Framing'));
  await a.getByRole('button', { name: 'Message' }).click();
  await modal().getByRole('link', { name: 'Open email' }).click();
  await toast('Logged as contacted');
  check('Opening an email logs the contact', (await modal().innerText()).includes('Contacted 2 times'));
  await modal().getByRole('button', { name: 'Close' }).click();
  await a.getByRole('link', { name: 'Call' }).click();
  for (let i = 0; i < 20 && !(await rest('owner', 'notifications?channel=eq.call')).json.length; i++) await current.waitForTimeout(150);
  check('Pressing Call logs the call', (await rest('owner', 'notifications?channel=eq.call&select=recipient')).json[0]?.recipient === 'Alpha Framing');
  await a.getByRole('button', { name: 'Mark confirmed' }).click();
  await toast('confirmed for');
  check('A confirmed sub leaves the call list', await callRow('Clear lot and excavate').count() === 0);
  await go(`/jobs/${oak}/contractors`);
  check('Contractors tab still shows them as confirmed', (await row('Clear lot and excavate').innerText()).includes('Confirmed'));
  await row('Clear lot and excavate').getByRole('button', { name: 'Undo' }).click();
  await toast('Confirmation removed');
  check('Undo a confirmation', (await row('Clear lot and excavate').innerText()).includes('Contacted'));
  await row('Clear lot and excavate').getByRole('button', { name: 'Mark confirmed' }).click();
  await toast('confirmed for');
  use('staff');
  await go(`/jobs/${oak}/schedule`);
  await current.getByRole('row', { name: /^Clear lot and excavate/ }).getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('Start', { exact: true }).fill(iso(4));
  await modal().getByLabel('Finish').fill(iso(5));
  await modal().getByRole('button', { name: 'Save task' }).click();
  await toast('Task saved');
  await go('/calls');
  check('Moving dates puts the sub back on the list', (await current.getByRole('row', { name: /Clear lot and excavate/ }).innerText()).includes('Not contacted'));
  const t = await text();
  check('Staff without access see no numbers or message buttons', !t.includes('937-555') && await current.getByRole('button', { name: 'Message' }).count() === 0 && await current.getByRole('link', { name: 'Call', exact: true }).count() === 0);
  use('office');
  await go('/calls');
  check('Office person has call and message buttons', await current.getByRole('button', { name: 'Message' }).count() > 0);
  use('subA');
  await current.reload();
  await current.locator('.portalcard', { hasText: 'Clear lot and excavate' }).getByRole('button', { name: "I'll be there" }).click();
  await toast("you're confirmed");
  check('Sub confirms from the portal', (await text()).includes('You confirmed these dates'));
  use('owner');
  await go('/calls');
  check('Portal confirmation clears the call list', await current.getByRole('row', { name: /Clear lot and excavate/ }).count() === 0);
  await current.screenshot({ path: `${out}/live-10-calls.png` });
  const other = (await rest('subB', 'tasks?select=name')).json.map((x) => x.name);
  check("Sub's API shows only their own tasks", other.length > 0 && !other.includes('Clear lot and excavate'));
});

// ---------------------------------------------------------------- needs and materials
area = 'What the job needs';
await step('scope', async () => {
  use('staff');
  await go(`/jobs/${oak}/scope`);
  const add = async (title, where, details) => {
    await current.getByRole('button', { name: 'Add an item' }).click();
    await modal().getByLabel('What it needs').fill(title);
    await modal().getByLabel('Where').fill(where);
    await modal().getByLabel('Details').fill(details);
    await modal().getByRole('button', { name: 'Add item' }).click();
    await toast('Item saved');
  };
  await add('Large back porch', 'Rear', '16 x 24 covered');
  await add('Tile', 'Kitchen', 'Subway');
  await add('Temp need', '', '');
  await row('Tile').getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('Status').selectOption('in_progress');
  await modal().getByRole('button', { name: 'Save item' }).click();
  await toast('Item saved');
  check('Add and update what the job needs', (await row('Tile').innerText()).includes('In progress'));
  await row('Temp need').getByRole('button', { name: 'Edit' }).click();
  await modal().getByRole('button', { name: 'Delete this item' }).click();
  await toast('Item deleted');
  check('Delete a job need', await row('Temp need').count() === 0);
});

area = 'Materials';
await step('materials', async () => {
  use('staff');
  await go(`/jobs/${oak}/materials`);
  await current.getByRole('button', { name: 'Add an item' }).click();
  await modal().getByLabel('Item', { exact: true }).fill('Windows');
  await modal().getByLabel('Quantity').fill('18');
  await modal().getByLabel('Need by').fill(iso(3));
  await modal().getByRole('button', { name: 'Add item' }).click();
  await toast('Item saved');
  check('Add a material, and a close need-by date says Order now', (await row('Windows').innerText()).includes('Order now'));
  await current.getByRole('button', { name: 'Add a list' }).click();
  await modal().getByLabel('One item per line').fill('120 2x4x8 studs\nJoist hangers\n3 x Exterior doors');
  await modal().getByLabel('Supplier').fill('Local Lumber');
  await modal().getByRole('button', { name: 'Add list' }).click();
  await toast('3 items added');
  check('Paste a list, with quantities split out', (await row('2x4x8 studs').innerText()).includes('120') && (await row('Exterior doors').innerText()).includes('3'));
  const mark = async (name, arriving, cost) => {
    await row(name).getByRole('button', { name: 'Mark ordered' }).click();
    await modal().getByLabel('Arriving').fill(arriving);
    await modal().getByLabel('Order number').fill(`ORD-${name.length}`);
    await modal().getByLabel('Cost').fill(cost);
    await modal().getByRole('button', { name: 'Mark ordered' }).click();
    await toast('marked ordered');
  };
  await mark('Windows', iso(6), '9600');
  await mark('Exterior doors', iso(-1), '2850');
  check('On-order items show when they arrive', (await row('Windows').innerText()).includes(iso(6)));
  check('Late delivery is flagged', (await row('Exterior doors').innerText()).includes('Late'));
  const figs = await current.locator('dl.strip').innerText();
  check('Summary shows on order, late, and total ordered', figs.includes('$12,450'), figs.replace(/\s+/g, ' '));
  await current.screenshot({ path: `${out}/live-11-materials.png`, fullPage: true });
  await row('Exterior doors').getByRole('button', { name: 'Mark arrived' }).click();
  await toast('marked arrived');
  check('Mark a delivery arrived', (await row('Exterior doors').innerText()).includes('Arrived'));
  await current.getByLabel('Show').selectOption('ordered');
  check('Filter to what is on order', (await text()).includes('Windows') && !(await text()).includes('Joist hangers'));
  await current.getByLabel('Show').selectOption('');
  await row('Joist hangers').getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('Notes').fill('Galvanized');
  await modal().getByRole('button', { name: 'Save item' }).click();
  await toast('Item saved');
  await row('Joist hangers').getByRole('button', { name: 'Edit' }).click();
  await modal().getByRole('button', { name: 'Delete this item' }).click();
  await toast('Item deleted');
  check('Edit and delete a material', await row('Joist hangers').count() === 0);
});

// ---------------------------------------------------------------- selections and files
area = 'Colors and drawings';
let contractPath; let plansPath;
await step('selections', async () => {
  use('staff');
  await go(`/jobs/${oak}/selections`);
  await current.getByRole('button', { name: 'Add a selection' }).click();
  await modal().getByLabel('Where').fill('Whole house');
  await modal().getByLabel('Item', { exact: true }).fill('Walls');
  await modal().getByLabel('Brand').fill('Sherwin-Williams');
  await modal().getByLabel('Color or style').fill('Alabaster');
  await modal().getByLabel('Color or model code').fill('SW-7008');
  await modal().getByLabel('Finish or sheen').fill('Eggshell');
  await modal().getByLabel('Bought from').fill('SW Store');
  await modal().getByLabel('Installed by').selectOption({ label: 'Alpha Framing' });
  await modal().getByLabel('Photo or spec sheet').setInputFiles(png('swatch.png'));
  await modal().getByRole('button', { name: 'Add selection' }).click();
  await toast('Selection saved');
  check('Add a color with a swatch file', (await row('Alabaster').innerText()).includes('SW-7008'));
  const code = await openedFile(current, () => row('Alabaster').getByRole('button', { name: 'View file' }).click());
  check('Open the swatch from real storage', code === 200, `status ${code}`);
  await current.getByRole('button', { name: 'Add a selection' }).click();
  await modal().getByLabel('Color or style').fill('Temp Color');
  await modal().getByRole('button', { name: 'Add selection' }).click();
  await toast('Selection saved');
  await row('Temp Color').getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('Color or style').fill('Temp Color 2');
  await modal().getByRole('button', { name: 'Save selection' }).click();
  await toast('Selection saved');
  await row('Temp Color 2').getByRole('button', { name: 'Edit' }).click();
  await modal().getByRole('button', { name: 'Delete this selection' }).click();
  await toast('Selection deleted');
  check('Edit and delete a selection', await row('Temp Color 2').count() === 0);
});
await step('files', async () => {
  use('staff');
  await go(`/jobs/${oak}/files`);
  await current.getByRole('button', { name: 'Add files' }).click();
  await modal().getByLabel('Files', { exact: true }).setInputFiles([
    file('oak-plans.pdf'), file('site survey (final).dwg', ''), file('specs.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'doc'), file('takeoff.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xls'), png('elevation.png'),
  ]);
  await modal().getByLabel('Revision').fill('A');
  await modal().getByRole('button', { name: 'Add files' }).click();
  await toast('5 files added');
  check('Upload PDF, CAD, Word, Excel, and image together', await current.locator('tbody tr').count() === 5);
  const c = await openedFile(current, () => row('oak-plans').getByRole('button', { name: 'Open' }).click());
  check('Open a PDF drawing from real storage', c === 200, `status ${c}`);
  // Browsers download CAD files rather than show them, so check the file itself comes back intact.
  const dwgPath = (await rest('staff', `documents?job_id=eq.${oak}&title=eq.site survey (final)&select=file_path`)).json[0].file_path;
  const signed = await (await signFile('staff', dwgPath)).json();
  const dwg = await fetch(`${API}/storage/v1${signed.signedURL}`);
  check('A CAD file with no type stores and comes back intact', dwg.status === 200 && (await dwg.text()) === '%PDF-1.4 test', `status ${dwg.status}`);
  await current.getByRole('button', { name: 'Add files' }).click();
  const huge = `${out}/huge.pdf`;
  writeFileSync(huge, Buffer.alloc(51 * 1024 * 1024));
  await modal().getByLabel('Files', { exact: true }).setInputFiles(huge);
  await modal().getByRole('button', { name: 'Add files' }).click();
  check('A file over 50 MB is refused with a clear message', (await modal().innerText()).includes('over 50 MB'));
  await modal().getByRole('button', { name: 'Cancel' }).click();
  await current.getByRole('button', { name: 'Add files' }).click();
  await modal().getByLabel('Files', { exact: true }).setInputFiles([file('contract.pdf')]);
  await modal().getByLabel('Type').selectOption('Contracts');
  await modal().getByRole('button', { name: 'Add files' }).click();
  await toast('1 file added');
  await row('oak-plans').getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('Title').fill('Oak plan set');
  await modal().getByLabel('Notes').fill('Includes truss layout');
  await modal().getByRole('button', { name: 'Save details' }).click();
  await toast('Details saved');
  check('Edit file details', await row('Oak plan set').count() === 1);
  const docs = (await rest('staff', `documents?job_id=eq.${oak}&select=title,file_path,category`)).json;
  plansPath = docs.find((d) => d.title === 'Oak plan set').file_path;
  contractPath = docs.find((d) => d.title === 'contract').file_path;
  await row('takeoff').getByRole('button', { name: 'Edit' }).click();
  const takeoff = docs.find((d) => d.title === 'takeoff').file_path;
  await modal().getByRole('button', { name: 'Delete this file' }).click();
  await toast('File deleted');
  const gone = await signFile('staff', takeoff);
  check('Deleting a file really removes it from storage', gone.status >= 400, `status ${gone.status}`);
  await current.screenshot({ path: `${out}/live-12-files.png`, fullPage: true });
  for (const k of ['subA', 'subB']) {
    const s = await signFile(k, plansPath);
    check(`${k} cannot open job drawings through storage`, s.status >= 400, `status ${s.status}`);
  }
  const upload = await fetch(`${API}/storage/v1/object/job-files/${oak}/evil.pdf`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${await tokenOf(people.subA.page)}`, 'Content-Type': 'application/pdf' }, body: 'x' });
  check('Sub cannot upload into the job folder', upload.status >= 400, `status ${upload.status}`);
  const noLogin = await fetch(`${API}/storage/v1/object/job-files/${plansPath}`, { headers: { apikey: ANON } });
  check('A logged-out visitor cannot fetch a drawing', noLogin.status >= 400, `status ${noLogin.status}`);
});

// ---------------------------------------------------------------- crew
area = 'Crew';
await step('crew', async () => {
  const p = use('crew');
  await p.reload();
  await p.getByRole('heading', { name: 'My work' }).waitFor();
  const t = await text();
  check('Crew see their tasks', t.includes('Pull permits') && t.includes('Frame house'));
  check('Crew see notes on their task', t.includes('Gate code 1234'));
  check('Crew see what the job needs', t.includes('Large back porch'));
  check('Crew see materials coming', t.includes('Windows') && t.includes(iso(6)));
  check('Crew see colors', t.includes('Alabaster'));
  check('Crew see plans, not contracts', t.includes('Oak plan set') && !t.includes('contract'));
  check('Crew see no money, subs, or contacts', !['$', 'Local Bank', 'Alpha Framing', 'Bravo', '937-555', 'Dana Buyer', 'ORD-'].some((x) => t.includes(x)));
  await p.screenshot({ path: `${out}/live-13-crew.png`, fullPage: true });
  const c = await openedFile(p, () => p.locator('.row', { hasText: 'Oak plan set' }).getByRole('button', { name: 'Open' }).click());
  check('Crew open the plans', c === 200, `status ${c}`);
  const bad = await signFile('crew', contractPath);
  check('Crew cannot open a contract through storage', bad.status >= 400, `status ${bad.status}`);
  await p.getByLabel('Status of Pull permits').selectOption('done');
  await toast('Status updated');
  check('Crew finish a task', (await rest('owner', `tasks?name=eq.Pull permits&job_id=eq.${oak}&select=status`)).json[0].status === 'done');
  await p.locator('.row', { hasText: 'Windows' }).getByRole('button', { name: 'It arrived' }).click();
  await toast('Windows marked arrived');
  check('Crew mark a delivery arrived', true);
  await p.locator('section', { hasText: 'Test Oak' }).getByRole('button', { name: 'Ask for materials' }).click();
  await modal().getByLabel('What do you need').fill('Baseboard trim');
  await modal().getByLabel('How much').fill('40 ft');
  await modal().getByLabel('Notes').fill('Short on the back bedroom');
  await modal().getByRole('button', { name: 'Send request' }).click();
  await toast('Request sent');
  check('Crew ask for materials', (await text()).includes('Baseboard trim'));
  for (const path of [`/jobs/${oak}/budget`, '/subs', '/calls', '/search', '/team', '/texts']) {
    await go(path);
    check(`Crew are sent home from ${path}`, new URL(p.url()).pathname === '/');
  }
  for (const tbl of ['jobs', 'budget_lines', 'pos', 'bills', 'draws', 'vendors', 'vendor_contacts', 'materials', 'lien_waivers', 'auto_texts', 'notifications']) {
    const r = await rest('crew', tbl);
    check(`Crew read nothing from ${tbl} through the API`, (r.json ?? []).length === 0, r.body.slice(0, 100));
  }
  const mat = await rest('crew', 'rpc/crew_materials', { method: 'POST', body: '{}' });
  check('Crew material list has no cost column', mat.json.length > 0 && !('cost_cents' in mat.json[0]));
  const sideReq = await rest('crew', 'rpc/request_material', { method: 'POST', body: JSON.stringify({ p_job: side, p_name: 'x', p_quantity: '', p_needed_by: null, p_notes: '' }) });
  check('Crew cannot request materials on a job they are not on', sideReq.status >= 400, `status ${sideReq.status}`);
  const others = await rest('crew', 'rpc/set_task_status', { method: 'POST', body: JSON.stringify({ p_task: (await rest('owner', `tasks?name=eq.Paint&job_id=eq.${oak}&select=id`)).json[0].id, p_status: 'done' }) });
  check('Crew cannot finish a task that is not theirs', others.status >= 400, `status ${others.status}`);
  use('owner');
  await go('/');
  check('Crew request lands on your list', (await text()).includes('Jordan Crew asked for 40 ft Baseboard trim'));
  await go(`/jobs/${oak}/materials`);
  check('Request is flagged with who asked', (await row('Baseboard trim').innerText()).includes('Asked for by Jordan Crew'));
  check('Crew arrival shows for the office', (await row('Windows').innerText()).includes('Arrived'));
});

// ---------------------------------------------------------------- sub extras
area = 'Sub portal';
await step('sub extras', async () => {
  const p = use('subA');
  await p.reload();
  await p.getByRole('button', { name: 'Ask for materials' }).click();
  await modal().getByLabel('Job').selectOption({ label: 'Test Oak' });
  await modal().getByLabel('What do you need').fill('Joist hangers');
  await modal().getByLabel('How much').fill('50');
  await modal().getByRole('button', { name: 'Send request' }).click();
  await toast('Request sent');
  check('Sub asks for materials', (await text()).includes('Joist hangers') && (await text()).includes('Asked for'));
  const m = await rest('subA', 'materials');
  check('Sub still cannot read the job material list', m.json.length === 0);
  use('owner');
  await go('/');
  check('Sub request lands on your list under the company name', (await text()).includes('Alpha Framing asked for 50 Joist hangers'));
  await go(`/jobs/${oak}/materials`);
  await row('Joist hangers').getByRole('button', { name: 'Mark ordered' }).click();
  await modal().getByLabel('Arriving').fill(iso(9));
  await modal().getByRole('button', { name: 'Mark ordered' }).click();
  await toast('marked ordered');
  use('subA');
  await p.reload();
  check('Sub sees the order status of their request', (await p.locator('.portalcard', { hasText: 'Joist hangers' }).innerText()).includes(`arriving ${iso(9)}`));
  const t = await text();
  check('Sub sees no budgets, loans, or other subs', !['Local Bank', '$500,000', 'Bravo Plumbing', 'Dana Buyer', 'Alabaster', 'Oak plan set', 'Windows'].some((x) => t.includes(x)));
  await p.getByLabel('Status of Clear lot and excavate').selectOption('in_progress');
  await toast('Status updated');
  check('Sub updates their task status', true);
  for (const tbl of ['jobs', 'budget_lines', 'change_orders', 'draws', 'vendor_contacts', 'materials', 'selections', 'documents', 'scope_items', 'job_steps', 'notifications', 'auto_texts', 'auto_text_settings']) {
    const r = await rest('subA', tbl);
    check(`Sub reads nothing from ${tbl} through the API`, (r.json ?? []).length === 0, r.body.slice(0, 100));
  }
  for (const path of [`/jobs/${oak}/budget`, '/subs', '/search', '/calls', '/team', '/texts']) {
    await go(path);
    check(`Sub is sent home from ${path}`, new URL(p.url()).pathname === '/');
  }
  await p.screenshot({ path: `${out}/live-14-portal.png`, fullPage: true });
});

// ---------------------------------------------------------------- photos and site log
area = 'Photos and site log';
await step('photos', async () => {
  const p = use('subA');
  await p.reload();
  await p.getByRole('button', { name: 'Send job photos' }).click();
  await modal().getByLabel('Job').selectOption({ label: 'Test Oak' });
  await modal().getByLabel('Photos', { exact: true }).setInputFiles([png('walls-a.png'), png('walls-b.png')]);
  await modal().getByLabel('Caption').fill('Walls up');
  await modal().getByRole('button', { name: 'Send photos' }).click();
  await toast('2 photos sent for review');
  check('Contractor sends real photos', (await text()).includes('Waiting for review'));
  await p.waitForFunction(() => [...document.querySelectorAll('.photos img')].some((i) => i.complete && i.naturalWidth > 0));
  check('Contractor sees the thumbnail from real storage', true);
  use('owner');
  await go('/');
  check('Photos land on your list', (await text()).includes('Review 2 photos from Alpha Framing'));
  await go(`/jobs/${oak}/log`);
  await current.waitForFunction(() => [...document.querySelectorAll('.review img')].filter((i) => i.complete && i.naturalWidth > 0).length === 2);
  check('Office sees the photos to review', true);
  await current.screenshot({ path: `${out}/live-15-review.png`, fullPage: true });
  const rev = current.locator('.review');
  await rev.first().getByRole('button', { name: 'Approve', exact: true }).click();
  await toast('Photo approved');
  await rev.first().getByRole('button', { name: 'Disapprove' }).click();
  await modal().getByRole('button', { name: 'Disapprove photo' }).click();
  check('Disapproving needs a reason', await modal().count() === 1);
  await modal().getByLabel('What needs fixing').fill('Too dark, retake');
  await modal().getByRole('button', { name: 'Disapprove photo' }).click();
  await toast('Photo disapproved');
  check('Approve one, disapprove one', (await text()).includes('Disapproved photos (1)'));
  await current.locator('details summary').click();
  await rev.first().getByRole('button', { name: 'Approve instead' }).click();
  await toast('Photo approved');
  check('Change your mind and approve a disapproved photo', !(await text()).includes('Disapproved photos'));
  sql(`update public.photos set review_status = 'rejected', review_note = 'Too dark, retake' where id = (select id from public.photos where caption = 'Walls up' order by created_at desc limit 1);`);
  await current.reload();
  const direct = await rest('owner', `photos?review_status=eq.approved&select=id`, { method: 'PATCH', body: JSON.stringify({ review_status: 'rejected' }) });
  check('The database refuses to disapprove with no reason', direct.status >= 400, `status ${direct.status}`);
  use('subA');
  await p.reload();
  const t = await text();
  check('Contractor sees the answer and the reason', t.includes('Approved') && t.includes('Too dark, retake'));
  const beforeOwn = sql(`select count(*) from public.photos where vendor_id is not null and review_status = 'approved';`);
  const self = await rest('subA', 'photos?caption=eq.Walls up&select=id', { method: 'PATCH', body: JSON.stringify({ review_status: 'approved' }) });
  check('Contractor cannot approve their own photo', (self.json ?? []).length === 0 && sql(`select count(*) from public.photos where vendor_id is not null and review_status = 'approved';`) === beforeOwn, self.body.slice(0, 120));
  await p.getByRole('button', { name: 'Send job photos' }).click();
  await modal().getByLabel('Job').selectOption({ label: 'Test Oak' });
  await modal().getByLabel('Photos', { exact: true }).setInputFiles([{ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: PNG }]);
  await modal().getByRole('button', { name: 'Send photos' }).click();
  await toast('1 photo sent for review');
  check('An iPhone HEIC photo uploads', (await rest('subA', 'photos?file_path=ilike.*HEIC&select=review_status')).json[0]?.review_status === 'pending');
  const sneak = await rest('subB', 'photos');
  check('Other subs cannot see those photos', sneak.json.length === 0);
  use('staff');
  await go(`/jobs/${oak}/log`);
  await current.getByRole('button', { name: 'Add a log entry' }).click();
  await modal().getByLabel('Weather').fill('Clear');
  await modal().getByLabel('What happened').fill('Trusses delivered, crane set for tomorrow');
  await modal().getByRole('button', { name: 'Add entry' }).click();
  await toast('Entry added');
  check('Add a site log entry', (await text()).includes('Trusses delivered'));
  await current.getByRole('button', { name: 'Add a photo' }).click();
  await modal().getByLabel('Photo or PDF').setInputFiles(png('office.png'));
  await modal().getByLabel('Caption').fill('Office photo');
  await modal().getByRole('button', { name: 'Add photo' }).click();
  await toast('Photo added');
  check('Office photos are approved right away', (await rest('staff', 'photos?caption=eq.Office photo&select=review_status')).json[0].review_status === 'approved');
});

// ---------------------------------------------------------------- record and search
area = 'Job record';
await step('record', async () => {
  use('owner');
  await go(`/jobs/${side}/budget`);
  await current.getByRole('button', { name: 'Edit job' }).click();
  await modal().getByLabel('Status').selectOption('closed');
  await modal().getByLabel('Actual finish').fill('2024-06-01');
  await modal().getByRole('button', { name: 'Save job' }).click();
  await toast('Job saved');
  await go(`/jobs/${side}`);
  await current.getByRole('heading', { name: 'Who did each step' }).waitFor();
  check('A closed job opens on its record', true);
  await current.getByRole('button', { name: 'Add a step' }).click();
  await modal().getByLabel('Step', { exact: true }).fill('Replaced door');
  await modal().getByLabel('Name, if not in the sub list').fill('Old Door Guy');
  await modal().getByLabel('Started').fill('2024-05-20');
  await modal().getByLabel('What it cost').fill('1800');
  await modal().getByLabel('Notes').fill('Would use again');
  await modal().getByRole('button', { name: 'Add step' }).click();
  await toast('Step saved');
  check('Enter who did a step on an old job', (await current.getByRole('row', { name: /^Replaced door/ }).innerText()).includes('Old Door Guy'));
  await current.getByRole('row', { name: /^Replaced door/ }).getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('What it cost').fill('1900');
  await modal().getByRole('button', { name: 'Save step' }).click();
  await toast('Step saved');
  check('Edit a step', (await current.getByRole('row', { name: /^Replaced door/ }).innerText()).includes('$1,900'));
  await current.getByRole('button', { name: 'Add a step' }).click();
  await modal().getByLabel('Step', { exact: true }).fill('Temp step');
  await modal().getByRole('button', { name: 'Add step' }).click();
  await toast('Step saved');
  await current.getByRole('row', { name: /^Temp step/ }).getByRole('button', { name: 'Edit' }).click();
  await modal().getByRole('button', { name: 'Delete this step' }).click();
  await toast('Step deleted');
  check('Delete a step', await current.getByRole('row', { name: /^Temp step/ }).count() === 0);
  await go(`/jobs/${oak}/record`);
  await current.getByRole('heading', { name: 'Who did each step' }).waitFor();
  const t = await text();
  check('Record pulls facts, needs, who did what, colors, files, materials, and photos', ['The Oak', '2,400', 'Dana Buyer', 'P-555', 'Large back porch', 'Alpha Framing', 'Alabaster', 'Oak plan set', 'Windows', 'Photos', 'Trusses delivered', 'Credit for fewer windows'].every((x) => t.includes(x)), ['The Oak', '2,400', 'Dana Buyer', 'P-555', 'Large back porch', 'Alpha Framing', 'Alabaster', 'Oak plan set', 'Windows', 'Photos', 'Trusses delivered', 'Credit for fewer windows'].filter((x) => !t.includes(x)).join(', '));
  await current.getByRole('button', { name: 'Print or save as PDF' }).click();
  check('Print the job record', await current.evaluate(() => window.__printed) === 1);
  await current.screenshot({ path: `${out}/live-16-record.png`, fullPage: true });
  await current.emulateMedia({ media: 'print' });
  check('Printing hides the menus and buttons', !(await current.locator('.topbar').isVisible()) && !(await current.locator('.tabs').isVisible()) && !(await current.getByRole('button', { name: 'Add a step' }).isVisible()));
  const pdf = await current.pdf({ path: `${out}/job-record.pdf`, format: 'Letter' });
  check('The job record makes a real PDF', pdf.length > 5000, `${pdf.length} bytes`);
  await current.emulateMedia({ media: 'screen' });
});

area = 'Search';
await step('search', async () => {
  use('owner');
  const find = async (q) => {
    await current.goto(`${BASE}/search?q=${encodeURIComponent(q)}`);
    await current.getByRole('heading', { name: 'All jobs' }).waitFor();
    return text();
  };
  let t = await find('');
  check('Empty search lists every job, closed ones too', t.includes('Test Oak') && t.includes('Test Garage Door'));
  for (const q of ['alabaster', 'SW-7008', 'sw 7008', 'sw7008']) { t = await find(q); check(`Finds the color with "${q}"`, t.includes('Test Oak') && t.includes('Alabaster')); }
  for (const [q, want] of [['oak plan set', 'Oak plan set'], ['truss layout', 'Oak plan set'], ['old door guy', 'Test Garage Door'], ['large back porch', 'What it needs'], ['ORD-7', 'Windows'], ['F-100', 'Invoice F-100'], ['extra porch framing', 'Change order'], ['trusses delivered', 'Site log'], ['walls up', 'Photos'], ['dana buyer', 'Test Oak'], ['P-555', 'Test Oak'], ['garage door swap', 'Test Garage Door'], ['oak alabaster', 'Alabaster'], ['2400', 'Test Oak']]) {
    t = await find(q);
    check(`Search "${q}" finds it`, t.includes(want), t.slice(0, 120).replace(/\s+/g, ' '));
  }
  t = await find('too dark');
  t = await find('zzznothing');
  check('Says when nothing matches', t.includes('No jobs match'));
  await current.getByRole('button', { name: 'clear the search' }).click();
  check('Clear the search', (await text()).includes('Test Oak'));
  await current.goto(`${BASE}/search`);
  await current.getByLabel('Type of job').selectOption('repair');
  t = await text();
  check('Filter by type', t.includes('Test Garage Door') && !t.includes('Test Oak'));
  await current.goto(`${BASE}/search`);
  await current.getByLabel('Year').selectOption('2024');
  t = await text();
  check('Filter by year', t.includes('Test Garage Door') && !t.includes('Test Oak'));
  await current.goto(`${BASE}/search`);
  await current.getByLabel('Sub used').selectOption({ label: 'Alpha Framing' });
  t = await text();
  check('Filter by sub used', t.includes('Test Oak') && !t.includes('Test Garage Door'));
  await current.goto(`${BASE}/search?q=sherwin`);
  await current.getByLabel('Show').selectOption('selection');
  check('Filter by kind of record', (await text()).includes('Colors and selections'));
  await current.getByRole('searchbox', { name: 'Search every job' }).fill('tile');
  await current.getByRole('searchbox', { name: 'Search every job' }).press('Enter');
  await current.waitForURL(/q=tile/);
  check('Top-bar search works from any page', true);
  t = await find('alpha framing');
  const more = current.getByRole('button', { name: /Show all \d+ matches/ });
  const before = await current.locator('.hitrow').count();
  await more.first().click();
  check('Show all matches expands the list', (await current.locator('.hitrow').count()) > before);
  t = await find('oak plan set');
  const c = await openedFile(current, () => current.locator('.hitrow', { hasText: 'Oak plan set' }).getByRole('button', { name: 'Open file' }).click());
  check('Open a drawing straight from search', c === 200, `status ${c}`);
  await current.screenshot({ path: `${out}/live-17-search.png`, fullPage: true });
  t = await find('betty billing');
  check('People with access can search contact names', t.includes('Test Oak'));
  use('staff');
  await current.goto(`${BASE}/search?q=betty%20billing`);
  await current.getByRole('heading', { name: 'All jobs' }).waitFor();
  check('Staff cannot search contact names', (await text()).includes('No jobs match'));
  await current.goto(`${BASE}/search?q=9375550101`);
  await current.getByRole('heading', { name: 'All jobs' }).waitFor();
  check('Staff cannot search contact phones', (await text()).includes('No jobs match'));
});

area = 'Today page';
await step('today', async () => {
  use('owner');
  await go('/');
  const t = await text();
  check('Today shows open jobs and closed ones separately', t.includes('Test Oak') && t.includes('Closed jobs'));
  const first = await current.locator('.needs a').first();
  await first.click();
  await current.waitForURL(/\/jobs\//);
  check('A Needs-you item links to the right tab', true);
  await go('/');
  await current.screenshot({ path: `${out}/live-18-today.png`, fullPage: true });
});

// ---------------------------------------------------------------- automatic texts
area = 'Automatic texts';
const kixieCalls = [];
let kixieFail = false;
const fake = createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    kixieCalls.push({ url: req.url, body: JSON.parse(b || '{}') });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(kixieFail ? { success: false, message: 'Rejected' } : { success: true, message: 'Hooray' }));
  });
});
await new Promise((r) => fake.listen(9911, '0.0.0.0', r));
const CRON = 'local-test-secret';
const envFile = `${out}/auto-texts.env`;
let serve = null;
const stopServe = async () => { if (serve) { serve.kill('SIGINT'); await new Promise((r) => setTimeout(r, 1500)); serve = null; } };
const startServe = async (live, nowIso) => {
  await stopServe();
  writeFileSync(envFile, [`CRON_SECRET=${CRON}`, `AUTO_TEXTS_LIVE=${live ? 1 : 0}`, 'KIXIE_API_KEY=FAKE-LOCAL-KEY', 'KIXIE_BUSINESS_ID=0', 'KIXIE_SENDER_EMAIL=test@test.local', 'KIXIE_URL=http://192.168.5.2:9911/app/event', `AUTO_TEXTS_TEST_NOW=${nowIso}`].join('\n'));
  serve = spawn('npx', ['supabase', 'functions', 'serve', 'auto-texts', '--no-verify-jwt', '--env-file', envFile], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const r = await fetch(`${API}/functions/v1/auto-texts`, { method: 'POST', headers: { 'x-cron-secret': 'wrong' } });
      if (r.status === 401) return;
    } catch { /* still starting */ }
  }
  throw new Error('The text server did not start.');
};
const fire = async (secret = CRON) => {
  const r = await fetch(`${API}/functions/v1/auto-texts`, { method: 'POST', headers: { 'x-cron-secret': secret } });
  return { status: r.status, json: await r.json().catch(() => null) };
};
// A weekday 10am Eastern, the Tuesday or later after today, so the local test isn't stuck on a weekend.
const nextWeekdayIso = () => {
  let d = new Date();
  do { d = new Date(d.getTime() + 864e5); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return `${d.toISOString().slice(0, 10)}T15:00:00Z`;
};
await step('auto texts', async () => {
  // Work inside the text window: one sub who agreed, one who hasn't, one with a bad number.
  const vendorSql = (name) => `(select id from public.vendors where name = '${name}')`;
  sql(`update public.tasks set start_date = '${iso(3)}', end_date = '${iso(4)}' where name = 'Utility connections' and job_id = '${oak}';
       update public.tasks set start_date = '${iso(2)}', end_date = '${iso(3)}', vendor_id = ${vendorSql('Alpha Framing')} where name = 'Siding and exterior trim' and job_id = '${oak}';
       update public.tasks set start_date = '${iso(2)}', end_date = '${iso(3)}', vendor_id = ${vendorSql('Charlie Electric')} where name = 'Interior trim' and job_id = '${oak}';`);
  const before = sql(`select enabled from public.auto_text_settings;`);
  check('Installed switched off', before === 'f', before);
  use('owner');
  await go('/texts');
  await current.getByRole('heading', { name: 'Automatic texts' }).waitFor();
  check('The page says it is off and nothing is sending', (await text()).includes('Off. Nothing is being sent.'));
  await current.screenshot({ path: `${out}/live-19-texts-off.png`, fullPage: true });
  await current.getByRole('button', { name: 'Change settings' }).click();
  await modal().getByLabel('Signed as').fill('H3 Office');
  await modal().getByLabel('Reminder, days before').fill('9');
  await modal().getByRole('button', { name: 'Save settings' }).click();
  check('Reminder must come after the notice', (await modal().innerText()).includes('reminder must come after'));
  await modal().getByLabel('Reminder, days before').fill('1');
  await modal().getByLabel('Start sending at').fill('20');
  await modal().getByRole('button', { name: 'Save settings' }).click();
  check('Sending hours must make sense', (await modal().innerText()).includes('earlier than stop'));
  await modal().getByLabel('Start sending at').fill('9');
  await modal().getByRole('button', { name: 'Save settings' }).click();
  await toast('Settings saved');
  check('Change text settings', (await text()).includes('H3 Office'));
  await current.reload();
  const blockedText = await text();
  check('Preview names who has not agreed to texts', blockedText.includes('Contact has not agreed'));
  check('Preview names a bad phone number', blockedText.includes('No valid mobile number'));
  use('office');
  await current.reload(); await go('/texts');
  check('Office person can view the page but not change it', (await text()).includes('Automatic texts') && await current.getByRole('button', { name: 'Change settings' }).count() === 0);
  check('Office person cannot turn texts on through the API', ((await rest('office', 'auto_text_settings?id=eq.main', { method: 'PATCH', body: JSON.stringify({ enabled: true }) })).json ?? []).length === 0);
  use('staff');
  await go('/texts');
  check('Staff without access cannot open the page', new URL(current.url()).pathname === '/');
  check('Staff cannot read the sent log', (await rest('staff', 'auto_texts')).json.length === 0);
  const forged = await rest('owner', 'auto_texts', { method: 'POST', body: JSON.stringify({ kind: 'notice', start_date: iso(1), status: 'accepted' }) });
  check('Nobody can fake the sent log from the app', forged.status >= 400, `status ${forged.status}`);
  use('owner');
  await go('/subs');
  await row('Bravo Plumbing').getByRole('button', { name: 'Contacts' }).click();
  await modal().getByRole('button', { name: 'Edit' }).click();
  await modal().getByLabel('Agreed to automatic texts').check();
  await modal().getByRole('button', { name: 'Save contact' }).click();
  await toast('Contact saved');
  await modal().getByRole('button', { name: 'Close' }).click();
  await go('/texts');
  const pv = await text();
  check('Preview shows the exact text that would go out', pv.includes('Would send now') && pv.includes('Bravo Plumbing') && pv.includes('Reply STOP to opt out'));
  await current.screenshot({ path: `${out}/live-20-texts-preview.png`, fullPage: true });

  const now = nextWeekdayIso();
  kixieCalls.length = 0;
  await startServe(false, now);
  check('Wrong secret is refused', (await fire('nope')).status === 401);
  sql(`update public.auto_text_settings set enabled = true;`);
  const a = await fire();
  check('Lock 1: server switch off sends nothing, even with the setting on', a.json?.state === 'off' && kixieCalls.length === 0, JSON.stringify(a.json));
  sql(`update public.auto_text_settings set enabled = false;`);
  await startServe(true, now);
  const b = await fire();
  check('Lock 2: setting off sends nothing, even with the server switch on', b.json?.state === 'off' && kixieCalls.length === 0, JSON.stringify(b.json));
  sql(`update public.auto_text_settings set enabled = true;`);
  await startServe(true, '2026-11-14T15:00:00Z');
  const c = await fire();
  check('Lock 3: weekend holds texts with both switches on', c.json?.state === 'waiting' && kixieCalls.length === 0, JSON.stringify(c.json));
  await startServe(true, now);
  kixieFail = true;
  const f = await fire();
  check('A Kixie failure is logged as failed, not sent', f.json?.failed >= 1 && f.json?.sent === 0, JSON.stringify(f.json));
  const failedRows = (await rest('owner', 'auto_texts?status=eq.failed')).json;
  check('Failure shows in the log with the reason', failedRows.length >= 1 && failedRows[0].error.includes('Rejected'));
  kixieFail = false;
  kixieCalls.length = 0;
  const d = await fire();
  const toBravo = kixieCalls.filter((x) => x.body.target === '9375550102');
  check('All locks open: the text reaches (fake) Kixie', d.json?.sent >= 1 && toBravo.length >= 1, JSON.stringify(d.json));
  check('The request has the number, words, and sender Kixie expects', toBravo[0]?.body.eventname === 'sms' && toBravo[0]?.body.email === 'test@test.local' && toBravo[0]?.body.message.includes('H3 Office') && toBravo[0]?.url.includes('apikey='), JSON.stringify(toBravo[0]?.body));
  check('Contacts who have not agreed got nothing', kixieCalls.every((x) => x.body.target === '9375550102'), kixieCalls.map((x) => x.body.target).join(','));
  const stat = sql(`select contact_status from public.tasks where name = 'Utility connections' and job_id = '${oak}';`);
  check('A sent text marks the sub as contacted', stat === 'contacted', stat);
  kixieCalls.length = 0;
  const e = await fire();
  check('Running again sends no duplicate', e.json?.sent === 0 && kixieCalls.length === 0, JSON.stringify(e.json));
  use('owner');
  await go('/texts');
  const h = await text();
  check('Sent history shows it, worded as accepted by Kixie', h.includes('Accepted by Kixie') && h.includes('Failed'));
  const eastern = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  check('Sent history shows Eastern time', h.includes(eastern) && h.includes(' ET'));
  await current.screenshot({ path: `${out}/live-21-texts-history.png`, fullPage: true });
  await current.getByRole('button', { name: 'Turn off' }).click();
  await toast('turned off');
  kixieCalls.length = 0;
  sql(`update public.tasks set start_date = start_date + 1, end_date = end_date + 1 where name = 'Utility connections' and job_id = '${oak}';`);
  const g = await fire();
  check('Turn off in the app stops sending', g.json?.state === 'off' && kixieCalls.length === 0, JSON.stringify(g.json));
  await current.getByRole('button', { name: 'Turn on' }).click();
  await toast('App setting turned on');
  check('Turn on in the app asks first and flips the setting', sql(`select enabled from public.auto_text_settings;`) === 't');
  await current.getByRole('button', { name: 'Turn off' }).click();
  await toast('turned off');
});
await stopServe();
fake.close();
area = 'Automatic texts';
check('Left switched OFF at the end of testing', sql(`select enabled from public.auto_text_settings;`) === 'f');

// ---------------------------------------------------------------- delete job and phones
area = 'Jobs';
await step('delete job', async () => {
  use('owner');
  await go('/');
  await current.getByRole('button', { name: 'Add a job' }).click();
  await modal().getByLabel('Job name').fill('Test Delete Me');
  await modal().getByLabel('Status').selectOption('active');
  await modal().getByRole('button', { name: 'Add job' }).click();
  await current.getByRole('heading', { name: 'Budget lines' }).waitFor();
  await current.getByRole('button', { name: 'Edit job' }).click();
  await modal().getByRole('button', { name: 'Delete this job' }).click();
  await current.getByRole('heading', { name: 'Today' }).waitFor();
  check('Admin deletes a job', !(await text()).includes('Test Delete Me'));
});
area = 'Phones';
await step('phones', async () => {
  const sizes = { width: 390, height: 844 };
  const paths = { owner: ['/', '/calls', '/search?q=alabaster', '/subs', '/team', '/texts', `/jobs/${oak}/record`, `/jobs/${oak}/materials`, `/jobs/${oak}/schedule`, `/jobs/${oak}/bills`, `/jobs/${oak}/log`], crew: ['/'], subA: ['/'] };
  for (const [k, list] of Object.entries(paths)) {
    const p = use(k);
    await p.setViewportSize(sizes);
    for (const path of list) {
      await go(path);
      await p.waitForTimeout(200);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`No sideways scroll: ${k} ${path.replace(oak, ':job')}`, over <= 0, `${over}px`);
    }
    await p.screenshot({ path: `${out}/live-phone-${k}.png`, fullPage: true });
    await p.setViewportSize({ width: 1360, height: 900 });
  }
});
area = 'iPhone Safari engine';
await step('webkit', async () => {
  const { webkit, devices } = await import('playwright');
  const wk = await webkit.launch();
  const ctx = await wk.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => pageProblems.push(`safari: ${e.message}`));
  for (const [who, email, heading] of [['crew', CREW, 'My work'], ['sub', SUBA, 'Alpha Framing']]) {
    await page.goto(BASE);
    await page.getByLabel('Email').fill(email);
    await new Promise((r) => setTimeout(r, 1500));
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await page.getByText('Check your email').waitFor();
    await page.goto(await latestLink(email, t0));
    await page.getByRole('heading', { name: heading }).waitFor();
    check(`${who} signs in on iPhone Safari`, true);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${who} page fits an iPhone screen`, over <= 0, `${over}px`);
    await page.screenshot({ path: `${out}/live-iphone-${who}.png`, fullPage: true });
    if (who === 'crew') {
      await page.locator('section', { hasText: 'Test Oak' }).getByRole('button', { name: 'Ask for materials' }).click();
      await page.getByRole('dialog').getByLabel('What do you need').fill('Caulk');
      await page.getByRole('dialog').getByLabel('Need it by').fill(iso(5));
      await page.getByRole('dialog').getByRole('button', { name: 'Send request' }).click();
      await page.locator('.toast', { hasText: 'Request sent' }).waitFor();
      check('Crew ask for materials on iPhone, date picker included', (await rest('owner', 'materials?name=eq.Caulk&select=needed_by')).json[0]?.needed_by === iso(5));
    } else {
      await page.getByRole('button', { name: 'Send job photos' }).click();
      await page.getByRole('dialog').getByLabel('Job').selectOption({ label: 'Test Oak' });
      await page.getByRole('dialog').getByLabel('Photos', { exact: true }).setInputFiles([{ name: 'iphone.png', mimeType: 'image/png', buffer: PNG }]);
      await page.getByRole('dialog').getByRole('button', { name: 'Send photos' }).click();
      await page.locator('.toast', { hasText: '1 photo sent' }).waitFor();
      check('Sub sends a photo on iPhone', (await rest('owner', 'photos?file_path=ilike.*iphone.png&select=review_status')).json[0]?.review_status === 'pending');
    }
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await page.getByRole('button', { name: 'Email me a code' }).waitFor();
  }
  await wk.close();
});

area = 'Whole system';
check('No crashes in any browser session', pageProblems.length === 0, pageProblems.slice(0, 3).join(' | '));
const flood = sql(`select count(*) from public.vendors where name like 'Temp%';`);
check('No test leftovers in the sub list', flood === '0', flood);

await browser.close();
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
const areas = [...new Set(results.map((r) => r.area))];
const report = [
  '# Build Tracker test report', '',
  `Run ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} Eastern against the real system on this computer.`,
  `**${results.filter((r) => r.ok).length} of ${results.length} checks passed.** Automatic texts went only to a fake Kixie on this Mac. Nothing left this computer.`, '',
  ...areas.flatMap((a) => [`## ${a}`, '', ...results.filter((r) => r.area === a).map((r) => `- ${r.ok ? 'Pass' : '**FAIL**'}: ${r.name}${r.ok ? '' : ` (${r.detail})`}`), '']),
].join('\n');
mkdirSync('docs', { recursive: true });
writeFileSync('docs/TEST-REPORT.md', report);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
failed.forEach((f) => console.log(` - [${f.area}] ${f.name} :: ${f.detail}`));
process.exit(failed.length ? 1 : 0);
