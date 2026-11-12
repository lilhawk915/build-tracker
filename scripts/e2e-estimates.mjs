// Stage 3 check: the Estimates screens on the real local system, as an admin and as staff.
// Needs: npm run local:start and npm run dev. Usage: node scripts/e2e-estimates.mjs <screenshot-dir>
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.argv[2] ?? '/tmp/est-shots';
mkdirSync(out, { recursive: true });
const BASE = 'http://127.0.0.1:5183';
const API = 'http://127.0.0.1:54321';
const MAIL = 'http://127.0.0.1:54324';
const status = JSON.parse(execSync('npx supabase status -o json 2>/dev/null').toString());
const SERVICE = status.SERVICE_ROLE_KEY;
const ANON = status.ANON_KEY;
const sql = (q) => execSync('docker exec -i supabase_db_build-tracker psql -U postgres -d postgres -At', { input: q }).toString().trim();

const results = [];
const problems = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` :: ${detail}` : ''}`); };
async function step(name, page, fn) {
  try { await fn(); } catch (e) {
    check(`${name} (stopped early)`, false, String(e.message).split('\n')[0].slice(0, 200));
    await page.screenshot({ path: `${out}/FAILED-${name.replace(/\W+/g, '-')}.png`, fullPage: true }).catch(() => {});
  }
}

async function makeUser(email, role) {
  sql(`insert into public.team_invites (email, role) values ('${email}', '${role}') on conflict (email) do update set role = '${role}';`);
  await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, email_confirm: true }) });
}
async function signIn(page, email) {
  await page.goto(BASE);
  await page.getByLabel('Email').fill(email);
  await new Promise((r) => setTimeout(r, 1500));
  const t = Date.now();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByText('Check your email').waitFor();
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/messages?limit=30`)).json();
    const m = list.messages.find((x) => x.To.some((y) => y.Address === email) && Date.parse(x.Created) >= t - 2000);
    if (m) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
      const link = (full.Text + full.HTML).match(/https?:\/\/[^\s"'<>]+verify[^\s"'<>]+/)[0].replace(/&amp;/g, '&');
      await page.goto(link);
      await page.locator('.topbar').waitFor();
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email for ${email}`);
}
const tokenOf = (page) => page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes('auth-token')) return JSON.parse(localStorage.getItem(k)).access_token; return null; });
const rest = async (page, path, init = {}) => {
  const res = await fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${await tokenOf(page)}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers ?? {}) } });
  return { status: res.status, json: await res.json().catch(() => null) };
};
// Commits a number box the way a person does: type, then Enter.
const typeIn = async (loc, value) => { await loc.click(); await loc.fill(String(value)); await loc.press('Enter'); };
const settle = (page) => page.waitForTimeout(400);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => problems.push(e.message));
  return page;
};

await makeUser('estadmin@test.local', 'admin');
await makeUser('eststaff@test.local', 'staff');
const admin = await mk();
const staff = await mk();
await signIn(admin, 'estadmin@test.local');
await signIn(staff, 'eststaff@test.local');
let estId = '';

await step('settings', admin, async () => {
  await admin.goto(`${BASE}/estimates/settings`);
  await admin.getByRole('heading', { name: 'Quote settings' }).waitFor();
  await admin.getByLabel('Company name').fill('Test Builders LLC');
  await admin.getByLabel('Company name').press('Enter');
  await admin.locator('.toast', { hasText: 'Saved' }).first().waitFor();
  await typeIn(admin.getByLabel('Default Profit'), 10);
  await admin.waitForTimeout(800);
  check('Admin sets company name and default profit', sql(`select name from public.company_settings;`) === 'Test Builders LLC' && sql(`select profit_pct from public.markup_defaults;`) === '10');
});

await step('custom estimate', admin, async () => {
  await admin.goto(`${BASE}/estimates`);
  await admin.getByRole('button', { name: 'New estimate' }).click();
  await admin.getByRole('dialog').getByLabel('Client or job name').fill('Sample Rd - Concrete');
  await admin.getByRole('dialog').getByLabel('Property address').fill('100 Sample Rd');
  await admin.getByRole('dialog').getByRole('button', { name: 'Start estimate' }).click();
  await admin.getByRole('heading', { name: 'Profit and markups' }).waitFor();
  estId = new URL(admin.url()).pathname.split('/').pop();
  check('Start a custom quote', estId.length > 20);
  check('New quote starts with the default 10% profit', sql(`select profit_pct from public.estimate_markups where estimate_id = '${estId}';`) === '10');
  for (const [name, total] of [['Concrete, all pads and step', 3000], ['Gravel and rebar', 500], ['Labor: forming, placing and finishing', 1400]]) {
    await admin.getByLabel('Add a line').selectOption('Foundation');
    await settle(admin);
    const nameBox = admin.getByLabel('Name of Custom line').last();
    await nameBox.fill(name);
    await nameBox.press('Enter');
    await settle(admin);
    const totalBox = admin.getByLabel(`Total of ${name}`, { exact: true });
    await typeIn(totalBox, total);
    await settle(admin);
  }
  // The labor line: move its whole amount into labor.
  await typeIn(admin.getByLabel('Labor total of Labor: forming, placing and finishing', { exact: true }), 1400);
  await typeIn(admin.getByLabel('Material total of Labor: forming, placing and finishing', { exact: true }), 0);
  await settle(admin);
  await typeIn(admin.getByLabel('Profit dollars'), 4900);
  await admin.waitForTimeout(1200);
  const grand = await admin.locator('.mkrow.strong').innerText();
  check('Typed amounts and a flat $4,900 profit total $9,800', grand.includes('$9,800.00'), grand.replace(/\s+/g, ' '));
  await admin.screenshot({ path: `${out}/est-01-custom.png`, fullPage: true });
  await admin.reload();
  await admin.getByRole('heading', { name: 'Profit and markups' }).waitFor();
  check('Everything is saved: still $9,800 after a reload', (await admin.locator('.mkrow.strong').innerText()).includes('$9,800.00'));
  const row = JSON.parse(sql(`select json_build_object('lines', jsonb_array_length(custom_lines), 'profit', m.profit_amount) from public.estimates e join public.estimate_markups m on m.estimate_id = e.id where e.id = '${estId}';`));
  check('Saved in the database: 3 lines and the $4,900 profit', row.lines === 3 && Number(row.profit) === 4900, JSON.stringify(row));
});

await step('pdfs', admin, async () => {
  for (const [button, kind] of [['Client quote PDF', 'quote'], ['Internal PDF', 'INTERNAL']]) {
    const [dl] = await Promise.all([admin.waitForEvent('download', { timeout: 30000 }), admin.getByRole('button', { name: button }).click()]);
    await dl.saveAs(`${out}/${kind}.pdf`);
    const path = `${out}/${kind}.pdf`;
    const bytes = readFileSync(path);
    check(`${button} downloads a real PDF`, bytes.subarray(0, 4).toString() === '%PDF' && bytes.length > 2000 && dl.suggestedFilename().includes(kind), `${dl.suggestedFilename()} ${bytes.length} bytes`);
  }
  const [csv] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('button', { name: 'Download lines (CSV)' }).click()]);
  check('Lines download as a spreadsheet', readFileSync(await csv.path(), 'utf8').includes('Gravel and rebar'));
});

await step('versions', admin, async () => {
  await admin.getByRole('link', { name: /Saved versions/ }).click();
  await admin.getByRole('button', { name: 'Save a version' }).click();
  await admin.getByRole('dialog').getByLabel('Label').fill('Sent to client');
  await admin.getByRole('dialog').getByRole('button', { name: 'Save version' }).click();
  await admin.locator('.toast', { hasText: 'Version saved' }).waitFor();
  check('Save a version', (await admin.locator('main').innerText()).includes('Sent to client'));
  await admin.getByRole('link', { name: 'Line items' }).click();
  await typeIn(admin.getByLabel('Profit dollars'), 6000);
  await admin.waitForTimeout(1000);
  check('Change the profit after saving', (await admin.locator('.mkrow.strong').innerText()).includes('$10,900.00'));
  await admin.getByRole('link', { name: /Saved versions/ }).click();
  check('The version still shows its own total', (await admin.locator('tr', { hasText: 'Sent to client' }).innerText()).includes('$9,800.00'));
  await admin.locator('tr', { hasText: 'Sent to client' }).getByRole('button', { name: 'Restore' }).click();
  await admin.locator('.toast', { hasText: 'Restored' }).waitFor();
  await admin.getByRole('heading', { name: 'Profit and markups' }).waitFor();
  check('Restore puts the $9,800 quote back', (await admin.locator('.mkrow.strong').innerText()).includes('$9,800.00'));
  check('Restoring saved the changed quote as a version first', Number(sql(`select count(*) from public.estimate_versions where estimate_id = '${estId}';`)) === 2);
  check('Restore is saved in the database', Number(sql(`select profit_amount from public.estimate_markups where estimate_id = '${estId}';`)) === 4900);
});

await step('staff view', staff, async () => {
  await staff.goto(`${BASE}/estimates`);
  await staff.getByRole('heading', { name: 'Estimates' }).waitFor();
  let t = await staff.locator('main').innerText();
  check('Staff see the estimate at cost: $4,900, not $9,800', t.includes('Sample Rd - Concrete') && t.includes('$4,900.00') && !t.includes('$9,800'));
  await staff.getByRole('link', { name: 'Sample Rd - Concrete' }).click();
  await staff.getByText('You see costs only').waitFor();
  t = await staff.locator('main').innerText();
  check('Staff see no profit, markups, PDFs, or versions', !t.includes('Profit and markups') && !t.includes('$9,800') && await staff.getByRole('button', { name: 'Client quote PDF' }).count() === 0 && await staff.getByRole('link', { name: /Saved versions/ }).count() === 0);
  await typeIn(staff.getByLabel('Total of Gravel and rebar', { exact: true }), 650);
  await staff.waitForTimeout(1000);
  check('Staff can edit a line', (await rest(staff, `estimates?id=eq.${estId}&select=line_edits`)).json[0].line_edits && sql(`select count(*) from public.estimates where id = '${estId}' and line_edits::text like '%650%';`) === '1');
  for (const t2 of ['estimate_markups', 'estimate_versions', 'markup_defaults']) {
    check(`Staff read nothing from ${t2} through the API`, ((await rest(staff, t2)).json ?? []).length === 0);
  }
  const forced = await rest(staff, `estimate_markups?estimate_id=eq.${estId}`, { method: 'PATCH', body: JSON.stringify({ profit_amount: 1 }) });
  check('Staff cannot change profit through the API', (forced.json ?? []).length === 0);
  await staff.goto(`${BASE}/estimates/settings`);
  await staff.waitForTimeout(500);
  check('Staff are kept off Quote settings', (await staff.locator('main').innerText()).includes('Quote settings are for admins'));
  await staff.screenshot({ path: `${out}/est-02-staff.png`, fullPage: true });
});

await step('starter catalog', admin, async () => {
  await admin.goto(`${BASE}/estimates/catalog`);
  await admin.getByRole('heading', { name: 'Price catalog' }).waitFor();
  check('An empty catalog says so and offers the starter list', (await admin.locator('main').innerText()).includes('The catalog is empty'));
  await admin.getByRole('button', { name: 'Load starter catalog' }).click();
  await admin.locator('.toast', { hasText: 'Starter catalog loaded' }).waitFor();
  check('Load the starter catalog: 133 placeholder prices', sql('select count(*) from public.catalog_items where not verified;') === '133');
});

await step('house estimate', admin, async () => {
  await admin.goto(`${BASE}/estimates`);
  await admin.getByRole('button', { name: 'New estimate' }).click();
  await admin.getByRole('dialog').getByLabel('Client or job name').fill('Sample house');
  await admin.getByRole('dialog').getByLabel('Type').selectOption('house');
  await admin.getByRole('dialog').getByRole('button', { name: 'Start estimate' }).click();
  await admin.getByRole('heading', { name: 'Profit and markups' }).waitFor();
  const before = await admin.locator('table.lines tbody tr:not(.division)').count();
  check('A house estimate fills in lines from the house details', before > 30, `${before} lines`);
  const total1 = await admin.locator('.mkrow.strong').innerText();
  await admin.getByRole('link', { name: 'House details' }).click();
  await typeIn(admin.getByLabel('Heated sq ft'), 3200);
  await admin.waitForTimeout(800);
  await admin.screenshot({ path: `${out}/est-03-house-details.png`, fullPage: true });
  await admin.getByRole('link', { name: 'Line items' }).click();
  const total2 = await admin.locator('.mkrow.strong').innerText();
  check('Changing the size reprices the house', total1 !== total2, `${total1} -> ${total2}`);
  check('Placeholder prices are flagged', (await admin.locator('main').innerText()).includes('placeholder prices'));
  await admin.getByLabel('Delete Excavation & site prep').first().click().catch(async () => { await admin.locator('button[aria-label^="Delete "]').first().click(); });
  await settle(admin);
  check('Deleting a calculated line puts it in Removed lines', (await admin.locator('main').innerText()).includes('Removed lines (1)'));
  await admin.getByRole('button', { name: 'Restore' }).first().click();
  await settle(admin);
  check('Restore a removed line', !(await admin.locator('main').innerText()).includes('Removed lines'));
  await admin.screenshot({ path: `${out}/est-04-house.png`, fullPage: true });
});

await step('catalog', admin, async () => {
  await admin.goto(`${BASE}/estimates/catalog`);
  await admin.getByRole('heading', { name: 'Price catalog' }).waitFor();
  const first = admin.locator('table.lines tbody tr').first();
  const label = await first.locator('input[aria-label^="Material price of"]').getAttribute('aria-label');
  const name = label.replace('Material price of ', '');
  await typeIn(first.locator('input[aria-label^="Material price of"]'), 2.875);
  await admin.waitForTimeout(800);
  const row = JSON.parse(sql(`select json_build_object('cost', unit_cost::text, 'verified', verified) from public.catalog_items where name = '${name.replace(/'/g, "''")}' limit 1;`));
  check('Typing a catalog price keeps it exact and marks it verified', row.cost === '2.875' && row.verified === true, JSON.stringify(row));
  const [dl] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('button', { name: 'Export CSV' }).click()]);
  check('Export the catalog as CSV', readFileSync(await dl.path(), 'utf8').includes('2.875'));
  await admin.screenshot({ path: `${out}/est-05-catalog.png`, fullPage: true });
});

await step('delete', admin, async () => {
  await admin.goto(`${BASE}/estimates`);
  await admin.getByRole('link', { name: 'Sample house' }).click();
  await admin.getByRole('heading', { name: 'Profit and markups' }).waitFor();
  await admin.getByRole('button', { name: 'Delete this estimate' }).click();
  await admin.getByRole('heading', { name: 'Estimates' }).waitFor();
  check('Admin deletes an estimate', !(await admin.locator('main').innerText()).includes('Sample house'));
});

await step('code sign-in', staff, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await ctx.newPage();
  phone.setDefaultTimeout(12000);
  await phone.goto(BASE);
  await phone.getByLabel('Email').fill('eststaff@test.local');
  await new Promise((r) => setTimeout(r, 1500));
  const t = Date.now();
  await phone.getByRole('button', { name: 'Email me a code' }).click();
  await phone.getByLabel('Code or link from the email').waitFor();
  let code = null;
  for (let i = 0; i < 40 && !code; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/messages?limit=30`)).json();
    const m = list.messages.find((x) => x.To.some((y) => y.Address === 'eststaff@test.local') && Date.parse(x.Created) >= t - 2000);
    if (m) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
      check('The email says it is a sign-in code', m.Subject.includes('sign-in code'), m.Subject);
      code = (full.Text + full.HTML).match(/\b\d{6}\b/)?.[0] ?? null;
    }
    if (!code) await new Promise((r) => setTimeout(r, 250));
  }
  check('The email carries a 6-digit code', Boolean(code));
  await phone.getByLabel('Code or link from the email').fill('000000');
  await phone.getByRole('button', { name: 'Sign in' }).click();
  await phone.locator('.alert', { hasText: 'wrong or has expired' }).waitFor();
  check('A wrong code is refused in plain words', true);
  await phone.getByLabel('Code or link from the email').fill(code);
  await phone.getByRole('button', { name: 'Sign in' }).click();
  await phone.locator('.topbar').waitFor();
  await phone.locator('main', { hasText: 'Today' }).waitFor().catch(() => {});
  check('Typing the code signs in on the phone, no link needed', (await phone.locator('main').innerText()).includes('Today'));
  await ctx.close();
});

// The live (free) project can't put a code in the email, so the pasted link must sign in too.
await step('pasted-link sign-in', staff, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await ctx.newPage();
  phone.setDefaultTimeout(12000);
  await phone.goto(BASE);
  await phone.getByLabel('Email').fill('eststaff@test.local');
  await new Promise((r) => setTimeout(r, 1500));
  const t = Date.now();
  await phone.getByRole('button', { name: 'Email me a code' }).click();
  await phone.getByLabel('Code or link from the email').waitFor();
  let link = null;
  for (let i = 0; i < 40 && !link; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/messages?limit=30`)).json();
    const m = list.messages.find((x) => x.To.some((y) => y.Address === 'eststaff@test.local') && Date.parse(x.Created) >= t - 2000);
    if (m) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
      link = (full.Text + full.HTML).match(/https?:\/\/[^\s"'<>]+verify[^\s"'<>]+/)?.[0]?.replace(/&amp;/g, '&') ?? null;
    }
    if (!link) await new Promise((r) => setTimeout(r, 250));
  }
  check('The email carries a sign-in link', Boolean(link));
  await phone.getByLabel('Code or link from the email').fill(link.replace(/token=[^&]+/, 'token=nope'));
  await phone.getByRole('button', { name: 'Sign in' }).click();
  await phone.locator('.alert').waitFor();
  check('A broken pasted link is refused', !(await phone.locator('.topbar').count()));
  await phone.getByLabel('Code or link from the email').fill(link);
  await phone.getByRole('button', { name: 'Sign in' }).click();
  await phone.locator('.topbar').waitFor();
  await phone.locator('main', { hasText: 'Today' }).waitFor().catch(() => {});
  { const txt = await phone.locator('main').innerText(); check('Pasting the emailed link signs in on the phone', txt.includes('Today'), txt.slice(0, 200)); }
  await ctx.close();
});

await step('import', admin, async () => {
  await admin.goto(`${BASE}/estimates/import`);
  await admin.getByRole('heading', { name: 'Import from Estimator' }).waitFor();
  await admin.getByLabel('Estimator file').setInputFiles('tests/fixtures/sample-concrete.estimator.json');
  const preview = await admin.locator('section[aria-label="What will be imported"]').innerText();
  check('Import shows what will come in before saving', preview.includes('100 Sample Rd - Concrete') && preview.includes('$9,800.00') && preview.includes('Import'));
  await admin.getByRole('button', { name: 'Import', exact: true }).click();
  await admin.locator('section[aria-label="Import check"]').waitFor();
  const after = await admin.locator('section[aria-label="Import check"]').innerText();
  check('After import it re-prices from what was saved: $9,800 matches', after.includes('$9,800.00') && after.includes('Matches'), after.replace(/\s+/g, ' '));
  check('Imported with the flat $4,900 profit', sql(`select m.profit_amount from public.estimate_markups m join public.estimates e on e.id = m.estimate_id where e.legacy_id = 'sample-concrete';`) === '4900');
  await admin.goto(`${BASE}/estimates/import`);
  await admin.getByLabel('Estimator file').setInputFiles('tests/fixtures/sample-concrete.estimator.json');
  check('Importing the same file again is skipped', (await admin.locator('section[aria-label="What will be imported"]').innerText()).includes('Already imported, skip'));
  await admin.screenshot({ path: `${out}/est-07-import.png`, fullPage: true });
  const res = await fetch(`${BASE}/manifest.webmanifest`);
  const man = await res.json().catch(() => ({}));
  check('Phone install file is served with the app name and icons', man.name === 'Build Tracker' && man.display === 'standalone' && man.icons?.length === 3);
  check('App icon is served', (await fetch(`${BASE}/icon-192.png`)).headers.get('content-type')?.includes('image/png'));
});

await step('quote to invoice', admin, async () => {
  const est = sql(`select id from public.estimates where legacy_id = 'sample-concrete';`);
  const undoBtn = admin.locator('.topbar .undo');
  await admin.goto(`${BASE}/estimates/${est}`);
  await admin.locator('section[aria-label="Quote to invoice"]').waitFor();
  await admin.getByRole('button', { name: 'Mark as sent' }).click();
  await settle(admin);
  check('Mark as sent sets the quote to Sent', sql(`select status from public.estimates where id = '${est}';`) === 'sent');
  await admin.getByLabel('Status').selectOption('won');
  await admin.getByRole('heading', { name: 'Job accepted' }).waitFor();
  check('Choosing Won opens the Job accepted dialog', true);
  await admin.getByLabel('New job name').fill('100 Sample Rd');
  await admin.getByRole('button', { name: 'Accept and set up the job' }).click();
  await admin.getByText('Accepted. Job:').waitFor();
  const job = sql(`select id from public.jobs where name = '100 Sample Rd';`);
  check('Accepting makes a job priced at the quote total', sql(`select sale_price_cents from public.jobs where id = '${job}';`) === '980000');
  check('The quote is marked won and tied to the job', sql(`select status || ' ' || (job_id = '${job}') from public.estimates where id = '${est}';`) === 'won true');
  await undoBtn.click();
  await admin.getByText('Undone: Job accepted').waitFor();
  check('Undo takes back the whole accept: job gone, quote back to Sent', sql(`select count(*) from public.jobs where name = '100 Sample Rd';`) === '0' && sql(`select status || ' ' || coalesce(job_id::text, 'none') from public.estimates where id = '${est}';`) === 'sent none');
  await admin.getByRole('button', { name: 'Job accepted' }).click();
  await admin.getByLabel('New job name').fill('100 Sample Rd');
  await admin.getByRole('button', { name: 'Accept and set up the job' }).click();
  await admin.getByText('Accepted. Job:').waitFor();
  const job2 = sql(`select id from public.jobs where name = '100 Sample Rd';`);
  await admin.getByRole('button', { name: 'Make invoice' }).click();
  await admin.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
  const invId = admin.url().split('/').pop();
  await admin.getByRole('heading', { name: /invoice 1001/i }).waitFor();
  const lines = await admin.locator('section[aria-label="Invoice lines"]').innerText();
  check('Invoice 1001 starts from the quote at $9,800', lines.includes('$9,800') , lines.replace(/\s+/g, ' ').slice(0, 200));
  await typeIn(admin.getByLabel('Line 1 amount'), 9000);
  await settle(admin);
  check('Editing a line changes the invoice total', sql(`select (lines->0->>'amount_cents') from public.invoices where id = '${invId}';`) === '900000');
  await undoBtn.click();
  await admin.getByText(/Undone/).waitFor();
  await settle(admin);
  check('Undo puts the line amount back', sql(`select (lines->0->>'amount_cents') from public.invoices where id = '${invId}';`) === '980000' && (await admin.getByLabel('Line 1 amount').inputValue()).replace(/,/g, '').startsWith('9800'));
  await admin.getByRole('button', { name: 'Mark paid in full' }).click();
  await admin.getByText('marked paid in full').waitFor();
  check('Mark paid in full records the payment', sql(`select paid_cents from public.invoices where id = '${invId}';`) === '980000' && (await admin.locator('h1').innerText()).includes('Paid'));
  const [dl] = await Promise.all([admin.waitForEvent('download', { timeout: 30000 }), admin.getByRole('button', { name: 'Invoice PDF' }).click()]);
  await dl.saveAs(`${out}/invoice.pdf`);
  const bytes = readFileSync(`${out}/invoice.pdf`);
  check('Invoice PDF downloads', bytes.subarray(0, 4).toString() === '%PDF' && bytes.length > 2000 && dl.suggestedFilename().startsWith('Invoice_1001'), dl.suggestedFilename());
  for (let n = 0; n < 2; n++) {
    await admin.getByRole('button', { name: 'Save PDF to job files' }).click();
    await admin.getByText(/saved to 100 Sample Rd's files/).waitFor();
    await settle(admin);
  }
  check('Saving the PDF to the job keeps one copy under Invoices', sql(`select count(*) from public.documents where job_id = '${job2}' and category = 'Invoices' and title = 'Invoice 1001';`) === '1');
  await admin.screenshot({ path: `${out}/est-08-invoice.png`, fullPage: true });
  await admin.goto(`${BASE}/jobs/${job2}/invoices`);
  await admin.getByText('Contract price').waitFor();
  const tab = await admin.locator('main').innerText();
  check('The job shows contract, invoiced, paid and owed', tab.includes('Contract price') && tab.includes('$9,800') && tab.includes('Still owed') && tab.includes('1001'), tab.replace(/\s+/g, ' ').slice(0, 300));
  await admin.goto(`${BASE}/invoices`);
  await admin.getByRole('heading', { name: 'Invoices' }).waitFor();
  check('Paid invoices drop off the "Not paid yet" list', (await admin.locator('main').innerText()).includes('Nothing is waiting to be paid'));
  // Undo on the estimate page itself.
  await admin.goto(`${BASE}/estimates/${est}`);
  const name = admin.getByLabel('Client name');
  await name.fill('Wrong name'); await name.press('Tab');
  await settle(admin);
  check('Typing a new client name saves it', sql(`select client_name from public.estimates where id = '${est}';`) === 'Wrong name');
  await undoBtn.click();
  await admin.getByText(/Undone/).waitFor();
  await settle(admin);
  check('Undo puts the client name back, in the database and on screen', sql(`select client_name from public.estimates where id = '${est}';`) === '100 Sample Rd - Concrete' && (await name.inputValue()) === '100 Sample Rd - Concrete');
});

await step('deposit, change order and final invoice', admin, async () => {
  // A $17,760 drywall quote: $6,000 material + $8,800 labor + $2,960 flat profit, 50% up front.
  const lines = JSON.stringify([
    { key: 'd.mat', division: 'Insulation/Drywall', name: 'Drywall board, 220 sheets, with mud, tape and corner bead', unit: 'lump sum', qty: 1, catalogItemId: null },
    { key: 'd.lab', division: 'Insulation/Drywall', name: 'Hang, tape and finish, Level 4', unit: 'lump sum', qty: 1, catalogItemId: null },
  ]);
  const edits = JSON.stringify({ 'd.mat': { materialUnit: 6000, laborUnit: 0 }, 'd.lab': { materialUnit: 0, laborUnit: 8800 } });
  const est = sql(`insert into public.estimates (kind, client_name, address, custom_lines, line_edits, deposit_pct, validity_days) values ('custom', 'Drywall test', '100 Sample Rd', '${lines}', '${edits}', 50, 30) returning id;`).split('\n')[0];
  sql(`update public.estimate_markups set sales_tax_pct = 0, contingency_pct = 0, overhead_pct = 0, profit_pct = 0, profit_amount = 2960 where estimate_id = '${est}';`);
  const qn = sql(`select number from public.estimates where id = '${est}';`);
  await admin.goto(`${BASE}/estimates/${est}`);
  await admin.locator('section[aria-label="Quote to invoice"]').waitFor();
  const head = await admin.locator('main').innerText();
  check('The quote shows its number and the deposit due at signing', head.includes(`Quote #${qn}`) && head.includes('$8,880.00 due at signing') && head.includes('$17,760'), head.replace(/\s+/g, ' ').slice(0, 300));
  const [q] = await Promise.all([admin.waitForEvent('download', { timeout: 30000 }), admin.getByRole('button', { name: 'Client quote PDF' }).click()]);
  await q.saveAs(`${out}/drywall-quote.pdf`);
  check('The client quote PDF downloads', readFileSync(`${out}/drywall-quote.pdf`).subarray(0, 4).toString() === '%PDF');
  await admin.getByRole('button', { name: 'Job accepted' }).click();
  await admin.getByLabel('New job name').fill('100 Sample Rd - Drywall');
  await admin.getByRole('button', { name: 'Accept and set up the job' }).click();
  await admin.getByText('Accepted. Job:').waitFor();
  const job = sql(`select id from public.jobs where name = '100 Sample Rd - Drywall';`);
  check('Accepting sets up the job budget from the quote costs', sql(`select string_agg(name || '=' || budget_cents, ',' order by sort) from public.budget_lines where job_id = '${job}';`) === 'Insulation/Drywall - material=600000,Insulation/Drywall - labor=880000');
  check('The panel says to send the deposit invoice before ordering', (await admin.locator('section[aria-label="Quote to invoice"]').innerText()).includes("Don't order material"));
  await admin.getByRole('button', { name: /Make deposit invoice \(50%: \$8,880\)/ }).click();
  await admin.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
  const dep = admin.url().split('/').pop();
  await admin.getByRole('heading', { name: /Deposit invoice/ }).waitFor();
  check('The deposit invoice is $8,880 and points at the quote', sql(`select kind || ' ' || (lines->0->>'amount_cents') || ' ' || (lines->0->>'description') from public.invoices where id = '${dep}';`) === `deposit 888000 Deposit (50%) - Quote #${qn}`);
  const [dd] = await Promise.all([admin.waitForEvent('download', { timeout: 30000 }), admin.getByRole('button', { name: 'Invoice PDF' }).click()]);
  check('The deposit invoice PDF downloads', dd.suggestedFilename().endsWith('.pdf'));
  await admin.goto(`${BASE}/estimates/${est}`);
  await admin.getByText('The deposit is not paid yet').waitFor();
  check('An unpaid deposit warns not to order or schedule', true);
  await admin.goto(`${BASE}/invoices/${dep}`);
  await admin.getByRole('button', { name: 'Mark paid in full' }).click();
  await admin.getByText('marked paid in full').waitFor();
  // A change order, signed mid-job.
  await admin.goto(`${BASE}/jobs/${job}/changes`);
  await admin.getByRole('button', { name: 'Add a change order' }).click();
  await admin.getByLabel('What changed').fill('Extra 10 sheets in the garage');
  await admin.getByLabel('Budget line').selectOption({ label: 'Insulation/Drywall - labor' });
  await admin.getByLabel('Change to your cost').fill('400');
  await admin.getByLabel('Change to client price').fill('800');
  await admin.getByRole('button', { name: 'Add change order' }).click();
  await admin.getByText('Change order saved').waitFor();
  const coRow = admin.locator('tr', { hasText: 'Extra 10 sheets' });
  const [cp] = await Promise.all([admin.waitForEvent('download', { timeout: 30000 }), coRow.getByRole('button', { name: 'PDF' }).click()]);
  await cp.saveAs(`${out}/change-order.pdf`);
  check('The change order PDF downloads', readFileSync(`${out}/change-order.pdf`).subarray(0, 4).toString() === '%PDF' && cp.suggestedFilename().startsWith('Change_order_1'), cp.suggestedFilename());
  await coRow.getByRole('button', { name: 'Approve' }).click();
  await admin.getByText(/approved/).first().waitFor();
  await settle(admin);
  // Final invoice: quote + change order - deposit.
  await admin.goto(`${BASE}/estimates/${est}`);
  await admin.getByText('Deposit received').waitFor();
  await admin.getByRole('button', { name: 'Make final invoice' }).click();
  await admin.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
  const fin = admin.url().split('/').pop();
  await admin.getByRole('heading', { name: /Final invoice/ }).waitFor();
  check('The final invoice is quote + change order - deposit = $9,680', sql(`select kind || ' ' || (select sum((l->>'amount_cents')::bigint) from jsonb_array_elements(lines) l) from public.invoices where id = '${fin}';`) === 'final 968000');
  const finText = await admin.locator('section[aria-label="Invoice lines"]').innerText();
  const descs = sql(`select string_agg(l->>'description', ' | ') from public.invoices, jsonb_array_elements(lines) l where id = '${fin}';`);
  check('The final invoice lists the quote, the change order and the deposit credit', descs === `Drywall test - Quote #${qn} | Change order #1 | Less deposit received (Invoice #${sql(`select number from public.invoices where id = '${dep}';`)})` && finText.includes('$9,680'), descs);
  await admin.goto(`${BASE}/estimates/${est}`);
  await admin.locator('section[aria-label="Quote to invoice"]').waitFor();
  check('A billed change order is not offered again', !(await admin.locator('section[aria-label="Quote to invoice"]').innerText()).includes('Bill 1 new change order'));
  await admin.screenshot({ path: `${out}/est-09-deposit-final.png`, fullPage: true });
  // All jobs: amount and projected profit.
  await admin.goto(`${BASE}/search?q=Drywall`);
  const card = admin.locator('dl[aria-label="100 Sample Rd - Drywall amount and profit"]');
  await card.waitFor();
  const cash = await card.innerText();
  check('All jobs shows the amount with the change order and the projected profit', cash.includes('$18,560') && cash.includes('$3,360'), cash.replace(/\s+/g, ' '));
  await admin.goto(`${BASE}/search`);
  await admin.locator('dl[aria-label="100 Sample Rd amount and profit"]').waitFor();
  const quoteOnly = await admin.locator('dl[aria-label="100 Sample Rd amount and profit"]').innerText();
  check('Every job on All jobs shows a projected profit', /Projected profit\s*\$[\d,]+/.test(quoteOnly), quoteOnly.replace(/\s+/g, ' '));
  await admin.screenshot({ path: `${out}/est-10-all-jobs.png`, fullPage: true });
});

await step('invoices are admin only', staff, async () => {
  await staff.goto(`${BASE}/estimates`);
  await staff.locator('.topbar').waitFor();
  check('Staff have no Invoices link', !(await staff.locator('.topbar nav').innerText()).includes('Invoices'));
  await staff.goto(`${BASE}/invoices`);
  await staff.getByText('Invoices are for admins').waitFor().catch(() => {});
  check('Staff are turned away from the invoices page', (await staff.locator('main').innerText()).includes('Invoices are for admins'));
  const r = await rest(staff, 'invoices?select=*');
  check('Staff read no invoices from the database directly', Array.isArray(r.json) && r.json.length === 0, JSON.stringify(r.json).slice(0, 100));
  await staff.goto(`${BASE}/search`);
  await staff.getByRole('heading', { name: 'All jobs' }).waitFor();
  await staff.waitForTimeout(500);
  check('Staff do not see job amounts or projected profit on All jobs', !(await staff.locator('main').innerText()).includes('Projected profit'));
});

await step('leads', admin, async () => {
  sql(`delete from public.leads;`);
  await admin.goto(`${BASE}/leads`);
  await admin.getByRole('heading', { name: 'Leads' }).waitFor();
  check('Admins have a Leads link', (await admin.locator('.topbar nav').innerText()).includes('Leads'));
  await admin.getByLabel('New lead').fill('Sam Sample 5 lots 555-532-2471 wants to split profit or $30k a build');
  await admin.getByRole('button', { name: 'Add lead' }).click();
  await admin.getByRole('button', { name: 'Add an appointment' }).waitFor();
  const leadId = admin.url().split('/leads/')[1];
  const row = () => JSON.parse(sql(`select row_to_json(l) from public.leads l where id = '${leadId}';`));
  let l = row();
  check('Quick add pulls out the name, phone and 5 houses, and keeps the whole line', l.name === 'Sam Sample' && l.phone === '555-532-2471' && l.houses === 5 && l.notes.includes('split profit') && l.stage === 'new', JSON.stringify(l).slice(0, 200));
  await typeIn(admin.getByLabel('Profit per house'), 30000);
  await admin.getByLabel('Type').selectOption('investor');
  await typeIn(admin.getByLabel('Deal terms'), 'Split profit, or $30K a build');
  await admin.waitForTimeout(800);
  check('Lead page shows 5 houses x $30,000 = $150,000 projected profit', (await admin.locator('main').innerText()).includes('$150,000'));
  await admin.getByRole('button', { name: 'Add an appointment' }).click();
  await admin.getByLabel('Date', { exact: true }).fill('2026-11-15');
  await admin.getByLabel('Time', { exact: true }).fill('13:30');
  await admin.getByLabel('Where').fill('100 Sample Rd');
  await admin.getByRole('button', { name: 'Add appointment' }).click();
  await admin.getByText('Sun, Nov 15, 1:30 PM').waitFor();
  l = row();
  check('An appointment moves a new lead to Appointment set', l.stage === 'appointment' && l.kind === 'investor' && Number(l.profit_per_house_cents) === 3000000);
  const [dl] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('button', { name: 'Add to calendar' }).click()]);
  const ics = readFileSync(await dl.path(), 'utf8');
  check('Add to calendar gives a 1:30 PM calendar file with the place', ics.includes('DTSTART:20261115T133000') && ics.includes('LOCATION:100 Sample Rd') && dl.suggestedFilename().endsWith('.ics'), dl.suggestedFilename());
  await admin.getByLabel('Log entry').fill('Called, he wants plans first');
  await admin.getByRole('button', { name: 'Add to log' }).click();
  await admin.getByText('Called, he wants plans first').waitFor();
  check('Log entries save', row().log[0].text === 'Called, he wants plans first');

  await admin.goto(`${BASE}/leads`);
  const col = admin.getByRole('region', { name: /^Appointment set/ });
  await col.getByRole('link', { name: 'Sam Sample' }).waitFor();
  const board = await admin.locator('main').innerText();
  check('Board shows the lead under Appointment set with its meeting and value', (await col.innerText()).includes('Meet Sun, Nov 15, 1:30 PM') && (await col.innerText()).includes('$150,000'));
  check('Board totals open leads, houses and projected profit', /1 open lead · 5 houses · \$150,000 projected profit/.test(board), board.slice(0, 300));
  await admin.screenshot({ path: `${out}/est-07-leads.png`, fullPage: true });
  await admin.getByLabel('Stage for Sam Sample').selectOption('waiting');
  await admin.getByRole('region', { name: /^Waiting on prices/ }).getByRole('link', { name: 'Sam Sample' }).waitFor();
  check('Moving a card changes its stage', row().stage === 'waiting');

  await admin.getByRole('link', { name: 'Sam Sample' }).click();
  await admin.getByRole('button', { name: 'Make it a job' }).click();
  await admin.getByLabel('Job name').fill('Sample Lot 1 - Sam Sample');
  await admin.getByRole('button', { name: 'Make the job' }).click();
  await admin.waitForURL(/\/jobs\//);
  l = row();
  const job = JSON.parse(sql(`select row_to_json(j) from public.jobs j where id = '${l.job_id}';`));
  check('Make it a job marks the lead won and sets up the job with the client', l.stage === 'won' && job.name === 'Sample Lot 1 - Sam Sample' && job.client_phone === '555-532-2471' && sql(`select count(*) > 0 from public.budget_lines where job_id = '${job.id}';`) === 't');
  await admin.goto(`${BASE}/leads`);
  await admin.getByRole('heading', { name: 'Leads' }).waitFor();
  await admin.waitForTimeout(400);
  check('Won leads drop out of the open total', (await admin.locator('main').innerText()).includes('0 open leads'));
});

await step('leads are admin only', staff, async () => {
  await staff.goto(`${BASE}/`);
  await staff.locator('.topbar').waitFor();
  check('Staff have no Leads link', !(await staff.locator('.topbar nav').innerText()).includes('Leads'));
  await staff.goto(`${BASE}/leads`);
  await staff.getByText('Leads are for admins').waitFor().catch(() => {});
  check('Staff are turned away from the leads page', (await staff.locator('main').innerText()).includes('Leads are for admins'));
  check('Staff read no leads or appointments through the API', ((await rest(staff, 'leads?select=*')).json ?? []).length === 0 && ((await rest(staff, 'lead_appointments?select=*')).json ?? []).length === 0);
  const forced = await rest(staff, 'leads', { method: 'POST', body: JSON.stringify({ name: 'sneaky' }) });
  check('Staff cannot add a lead through the API', forced.status >= 400, String(forced.status));
});

await step('phone', admin, async () => {
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.goto(`${BASE}/estimates/${estId}`);
  await admin.getByRole('heading', { name: 'Profit and markups' }).waitFor();
  const over = await admin.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('Estimate page fits a phone screen (line table scrolls inside its box)', over <= 0, `${over}px`);
  await admin.screenshot({ path: `${out}/est-06-phone.png`, fullPage: true });
  await admin.goto(`${BASE}/leads`);
  await admin.getByRole('heading', { name: 'Leads' }).waitFor();
  const over2 = await admin.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('Leads board fits a phone screen (columns scroll inside the board)', over2 <= 0, `${over2}px`);
  await admin.screenshot({ path: `${out}/est-08-leads-phone.png`, fullPage: true });
});

check('No crashes in the browser', problems.length === 0, problems.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
