// Drives the demo build in real Chrome as the owner and as a sub. Usage: node scripts/e2e.mjs <screenshot-dir>
import { chromium } from 'playwright';
const out = process.argv[2];
const BASE = 'http://localhost:4173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.location().url)) problems.push(`console: ${m.text()}`); });
let passed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`ok   ${name}`); } else { problems.push(`FAILED: ${name}`); console.log(`FAIL ${name}`); } };
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const text = () => page.locator('main').innerText();
const row = (t) => page.locator('tr', { hasText: t });
const modal = () => page.getByRole('dialog');

await page.goto(BASE);
await page.getByRole('heading', { name: 'Today' }).waitFor();
let t = await text();
check('today lists all three builds', ['Oak Ridge spec', 'Maple Ct custom', 'Cedar Lot 4'].every((x) => t.includes(x)));
check('flags framing over budget', t.includes('Framing is $5,500 over budget'));
check('flags expired insurance', /Sample Electric: insurance expired/.test(t));
await shot('01-today');

// Budget math shown on screen: framing budget 62,000, PO 67,500, paid 30,000, billed 52,000
await page.locator('.jobcard', { hasText: 'Oak Ridge spec' }).click();
await page.getByRole('heading', { name: 'Budget lines' }).waitFor();
const fr = await row('Framing').innerText();
check('framing row figures', ['$62,000', '$67,500', '$52,000', '$30,000', '$5,500 over'].every((x) => fr.includes(x)));
await shot('02-budget');

// Payment gate: framing bill F-218 is approved but its waiver is missing.
await page.locator('.tabs').getByRole('link', { name: 'Bills', exact: true }).click();
const f218 = row('F-218');
check('blocked bill says why', (await f218.innerText()).includes('no lien waiver received'));
await f218.getByRole('button', { name: 'Pay' }).click();
check('pay dialog shows block', (await modal().innerText()).includes('Payment is blocked'));
await shot('03-pay-blocked');
await modal().getByRole('button', { name: 'Cancel' }).click();

// Approve plumbing: a waiver request appears.
await row('P-77').getByRole('button', { name: 'Approve' }).click();
await page.getByText('Bill approved').waitFor();
await page.locator('.tabs').getByRole('link', { name: 'Lien waivers', exact: true }).click();
check('approval requested a waiver', (await row('Sample Plumbing').innerText()).includes('Requested'));
// Receive framing waiver, then pay it.
await row('F-218').filter({ hasText: 'Requested' }).getByRole('button', { name: 'Mark received' }).click();
await modal().getByRole('button', { name: 'Mark received' }).click();
await page.getByText('Waiver marked received').waitFor();
await page.locator('.tabs').getByRole('link', { name: 'Bills', exact: true }).click();
await row('F-218').getByRole('button', { name: 'Pay' }).click();
check('pay dialog clear once waiver is in', (await modal().innerText()).includes('This only records the payment'));
await modal().getByRole('button', { name: 'Record payment' }).click();
await page.getByText('Payment recorded').waitFor();
check('bill shows paid', (await row('F-218').innerText()).includes('Paid'));
await page.locator('.tabs').getByRole('link', { name: 'Lien waivers', exact: true }).click();
check('payment requested the unconditional waiver', await row('F-218').filter({ hasText: 'Unconditional progress' }).filter({ hasText: 'Requested' }).count() === 1);

// Expired insurance: override needs a reason, and it is saved.
await page.locator('.tabs').getByRole('link', { name: 'POs', exact: true }).click();
await row('Rough and finish electrical').getByRole('button', { name: 'Mark accepted' }).click();
await page.locator('.tabs').getByRole('link', { name: 'Bills', exact: true }).click();
await page.getByRole('button', { name: 'Add a bill' }).click();
await modal().getByLabel('Sub').selectOption({ label: 'Sample Electric' });
await modal().getByLabel('PO', { exact: true }).selectOption({ label: 'PO 4: Sample Electric, $17,500' });
await modal().getByLabel('Invoice number').fill('E-1');
await modal().getByLabel('Amount').fill('1,250.50');
await modal().getByRole('button', { name: 'Add bill' }).click();
await page.getByText('Bill added').waitFor();
await row('E-1').getByRole('button', { name: 'Approve' }).click();
await page.getByText('Bill approved').waitFor();
check('amount parsed with cents', (await row('E-1').innerText()).includes('$1,250.50'));
await row('E-1').getByRole('button', { name: 'Pay' }).click();
const pay = await modal().innerText();
check('names both blockers', pay.includes('insurance expired') && pay.includes('no lien waiver'));
await modal().getByLabel('Reason for override').fill('Emergency repair, COI renewal on the way');
await modal().getByRole('button', { name: 'Pay with override' }).click();
await page.getByText('Payment recorded').waitFor();
check('override reason is on the bill', (await row('E-1').innerText()).includes('Emergency repair'));

// Schedule delay pushes later work.
await page.locator('.tabs').getByRole('link', { name: 'Schedule', exact: true }).click();
await page.getByRole('heading', { name: 'Schedule' }).waitFor();
await shot('04-schedule');
const beforeRoof = await page.getByRole('row', { name: /^Dry-in and roof/ }).innerText();
await page.getByRole('row', { name: /^Frame house/ }).getByRole('button', { name: 'Edit' }).click();
const end = await modal().getByLabel('Finish').inputValue();
const later = new Date(Date.parse(end) + 20 * 864e5).toISOString().slice(0, 10);
await modal().getByLabel('Finish').fill(later);
await modal().getByRole('button', { name: 'Save task' }).click();
await page.getByRole('heading', { name: 'This moves later work' }).waitFor();
await shot('05-cascade');
await modal().getByRole('button', { name: 'Move these tasks' }).click();
await page.getByText(/later tasks? moved/).waitFor();
check('roof task moved', (await page.getByRole('row', { name: /^Dry-in and roof/ }).innerText()) !== beforeRoof);

// Draw: new draft, amounts, sheet.
await page.locator('.tabs').getByRole('link', { name: 'Draws', exact: true }).click();
await page.getByRole('button', { name: 'Start a draw' }).click();
await page.getByText('Draft draw added').waitFor();
await row('Draft').getByRole('button', { name: 'Enter amounts' }).click();
await modal().getByLabel('Framing this draw').fill('30000');
check('warns when a draw passes budget', (await modal().innerText()).includes('Over budget'));
await shot('06-draw');
await modal().getByRole('button', { name: 'Save draw' }).click();
await page.getByText('Draw 3 saved').waitFor();
await row('Draft').getByRole('link', { name: 'Open sheet' }).click();
await page.getByRole('heading', { name: /Draw request 3/ }).waitFor();
const sheet = await row('Framing').first().innerText();
check('sheet shows prior 46,000 + this 30,000', ['$46,000', '$30,000', '$76,000'].every((x) => sheet.includes(x)));
await shot('07-draw-sheet');

// Change order flows to the budget and profit.
await page.goto(`${BASE}/`);
await page.locator('.jobcard', { hasText: 'Maple Ct custom' }).click();
await page.getByRole('heading', { name: 'Budget lines' }).waitFor();
const before = await page.locator('dl.strip').innerText();
await page.locator('.tabs').getByRole('link', { name: 'Change orders', exact: true }).click();
await row('Quartz').getByRole('button', { name: 'Approve' }).click();
await page.getByText('Budget updated').waitFor();
await page.locator('.tabs').getByRole('link', { name: 'Budget', exact: true }).click();
const after = await page.locator('dl.strip').innerText();
check('client change order adds to the price', before.includes('$540,000') && after.includes('$547,500'));

// New build from the template.
await page.goto(`${BASE}/`);
await page.getByRole('button', { name: 'Add a job' }).click();
await modal().getByLabel('Job name').fill('Test Build');
await modal().getByRole('button', { name: 'Add job' }).click();
await page.getByRole('heading', { name: 'Budget lines' }).waitFor();
check('template loaded budget lines', await page.locator('tbody tr').count() === 25);

// A small job skips the house template and is ready for bills.
await page.goto(`${BASE}/`);
await page.getByRole('button', { name: 'Add a job' }).click();
const typeOptions = await modal().getByLabel('Type', { exact: true }).locator('option').allInnerTexts();
check('type offers more than new houses', ['Flip', 'Remodel', 'Addition', 'Repair or small job', 'Other'].every((x) => typeOptions.includes(x)));
await modal().getByLabel('Job name').fill('Oddball Garage Door');
await modal().getByLabel('Type', { exact: true }).selectOption('other');
await modal().getByLabel('What kind of job').fill('Garage door swap');
await modal().getByRole('button', { name: 'Add job' }).click();
await page.getByRole('heading', { name: 'Budget lines' }).waitFor();
check('small job gets one General line, no house schedule', await page.locator('tbody tr').count() === 1 && (await row('General').count()) === 1);
check('job header shows the type and note', (await text()).includes('Other: Garage door swap'));
await page.locator('.tabs').getByRole('link', { name: 'Schedule', exact: true }).click();
check('small job has no starter tasks', (await text()).includes('Add tasks and link'));
await page.locator('.tabs').getByRole('link', { name: 'Bills', exact: true }).click();
check('small job can take a bill right away', await page.getByRole('button', { name: 'Add a bill' }).isEnabled());

// Search every job.
const find = async (q) => {
  await page.goto(`${BASE}/search?q=${encodeURIComponent(q)}`);
  await page.getByRole('heading', { name: 'All jobs' }).waitFor();
  return text();
};
t = await find('');
check('all jobs lists finished work too', ['Birch Ln ranch', 'Sample St deck repair', 'Oak Ridge spec'].every((x) => t.includes(x)));
await shot('10-all-jobs');
for (const q of ['alabaster', 'SW-7008', 'sw 7008', 'sw7008']) {
  t = await find(q);
  check(`finds the color with "${q}"`, t.includes('Birch Ln ranch') && t.includes('Alabaster') && !t.includes('Oak Ridge spec'));
}
await shot('11-search-color');
t = await find('sample paint crew');
check('finds a sub who is not in the sub list', t.includes('Birch Ln ranch') && t.includes('Painting'));
t = await find('foundation plan');
check('finds a drawing by title', t.includes('Foundation plan'));
const [tabPromise] = [ctx.waitForEvent('page')];
await page.locator('.hitrow', { hasText: 'Foundation plan' }).getByRole('button', { name: 'Open file' }).click();
const opened = await tabPromise;
await opened.waitForURL(/^blob:/, { timeout: 5000 }).catch(() => {});
check('opens the drawing in a new tab', opened.url().startsWith('blob:'));
await opened.close();
t = await find('garage door swap');
check('finds a one-off job by its note', t.includes('Oddball Garage Door'));
t = await find('zzzznothing');
check('says when nothing matches', t.includes('No jobs match'));
await page.goto(`${BASE}/search`);
await page.getByLabel('Sub used').selectOption({ label: 'Sample Concrete' });
t = await text();
check('filter by sub', t.includes('Birch Ln ranch') && !t.includes('Sample St deck repair'));
await page.goto(`${BASE}/search`);
await page.getByLabel('Type of job').selectOption('repair');
t = await text();
check('filter by type', t.includes('Sample St deck repair') && !t.includes('Birch Ln ranch'));
await page.getByRole('searchbox', { name: 'Search every job' }).fill('tricorn');
await page.getByRole('searchbox', { name: 'Search every job' }).press('Enter');
await page.getByText('Tricorn Black').waitFor();
check('top bar search works from any page', page.url().includes('q=tricorn'));

// Job record: a finished job opens on it, and shows everything together.
await page.goto(`${BASE}/search`);
await page.getByRole('link', { name: 'Birch Ln ranch' }).click();
await page.getByRole('heading', { name: 'Who did each step' }).waitFor();
t = await text();
check('record shows facts, crew, colors, and drawings', ['The Sample Ranch', '1,850', 'Sample Framing Co', 'Sample Paint Crew', 'SW-6258', 'Architectural plan set', '$51,000'].every((x) => t.includes(x)));
await shot('12-job-record');

// Enter history by hand, add a color, and upload drawings. Each should be findable.
await page.getByRole('button', { name: 'Add a step' }).click();
await modal().getByLabel('Step', { exact: true }).fill('Gutters');
await modal().getByLabel('Name, if not in the sub list').fill('Quigley Gutter Guy');
await modal().getByRole('button', { name: 'Add step' }).click();
await page.getByText('Step saved').waitFor();
check('step with no cost shows blank, not $0', !(await page.getByRole('row', { name: /^Gutters/ }).innerText()).includes('$0'));
t = await find('quigley');
check('new step is searchable', t.includes('Birch Ln ranch'));
await page.goto(`${BASE}/jobs/birch/selections`);
await page.getByRole('button', { name: 'Add a selection' }).click();
await modal().getByLabel('Color or style').fill('Naval');
await modal().getByLabel('Color or model code').fill('SW-6244');
await modal().getByRole('button', { name: 'Add selection' }).click();
await page.getByText('Selection saved').waitFor();
await shot('13-selections');
t = await find('sw6244');
check('new color is searchable', t.includes('Naval'));
await page.goto(`${BASE}/jobs/birch/files`);
await page.getByRole('button', { name: 'Add files' }).click();
await modal().getByLabel('Files', { exact: true }).setInputFiles([
  { name: 'electrical-plan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') },
  { name: 'site-survey.dwg', mimeType: '', buffer: Buffer.from('dwg') },
]);
await modal().getByRole('button', { name: 'Add files' }).click();
await page.getByText('2 files added').waitFor();
await shot('14-files');
t = await find('site survey');
check('uploaded DWG is searchable', t.includes('site-survey'));
t = await find('electrical plan');
check('uploaded PDF is searchable', t.includes('electrical-plan'));

// Running a job: needs, materials, schedule status, call list, messages.
await page.goto(`${BASE}/`);
t = await text();
check('today shows off-schedule jobs', (await page.locator('.jobcard', { hasText: 'Oak Ridge spec' }).innerText()).includes('behind'));
check('late delivery is flagged', t.includes("Exterior doors was due"));
check('order-soon item is flagged', t.includes('Order Kitchen cabinets'));
check('unconfirmed contractor is flagged', t.includes('Call Sample Framing Co: Frame house'));
await shot('20-today-ops');
await page.goto(`${BASE}/jobs/oak/scope`);
await page.getByRole('button', { name: 'Add an item' }).click();
await modal().getByLabel('What it needs').fill('Screened gazebo');
await modal().getByRole('button', { name: 'Add item' }).click();
await page.getByText('Item saved').waitFor();
t = await text();
check('job needs list holds the new item and sample ones', ['Screened gazebo', 'Large back porch', 'Kitchen cabinets'].every((x) => t.includes(x)));
await shot('21-scope');
await page.goto(`${BASE}/jobs/oak/materials`);
await page.getByRole('heading', { name: 'Materials' }).waitFor();
t = await text();
check('materials show ordered total', t.includes('$23,850'));
await shot('22-materials');
await page.getByRole('button', { name: 'Add a list' }).click();
await modal().getByLabel('One item per line').fill('120 2x4x8 studs\nJoist hangers');
await modal().getByRole('button', { name: 'Add list' }).click();
await page.getByText('2 items added').waitFor();
check('pasted list split quantity', (await row('2x4x8 studs').innerText()).includes('120'));
await row('2x4x8 studs').getByRole('button', { name: 'Mark ordered' }).click();
await modal().getByLabel('Arriving').fill('2030-01-15');
await modal().getByLabel('Order number').fill('ORD-99');
await modal().getByLabel('Cost').fill('1000');
await modal().getByRole('button', { name: 'Mark ordered' }).click();
await page.getByText('marked ordered').waitFor();
check('order details show arrival date', (await row('2x4x8 studs').innerText()).includes('2030-01-15'));
check('ordered total went up', (await text()).includes('$24,850'));
await row('2x4x8 studs').getByRole('button', { name: 'Mark arrived' }).click();
await page.getByText('marked arrived').waitFor();
check('arrived item shows arrived', (await row('2x4x8 studs').innerText()).includes('Arrived'));
await page.getByLabel('Show').selectOption('ordered');
check('filter shows only on-order items', !(await text()).includes('2x4x8 studs') && (await text()).includes('Windows'));
await page.goto(`${BASE}/jobs/oak/schedule`);
await page.getByRole('heading', { name: 'Schedule' }).waitFor();
check('schedule says behind and names the task', /days? behind/.test(await page.locator('.alert').innerText()));
await shot('23-schedule-status');
await page.goto(`${BASE}/calls`);
await page.getByRole('heading', { name: 'Call list' }).waitFor();
await shot('24-call-list');
const plumbRow = page.getByRole('row', { name: /Frame house/ }).filter({ hasText: 'Sample Framing Co' });
check('call button dials the sub', (await plumbRow.getByRole('link', { name: 'Call' }).getAttribute('href')) === 'tel:+19375550100');
await plumbRow.getByRole('button', { name: 'Message' }).click();
const smsHref = await modal().getByRole('link', { name: 'Open text' }).getAttribute('href');
check('text is pre-filled with phone and job', smsHref.startsWith('sms:+19375550100') && decodeURIComponent(smsHref).includes('Frame house') && decodeURIComponent(smsHref).includes('22 Sample Ct'));
check('email is pre-filled', (await modal().getByRole('link', { name: 'Open email' }).getAttribute('href')).startsWith('mailto:framing@example.com'));
await shot('25-message');
await modal().getByRole('button', { name: 'Close' }).click();
await plumbRow.getByRole('button', { name: 'Mark confirmed' }).click();
await page.getByText(/confirmed for/).waitFor();
check('confirmed sub leaves the call list', await page.getByRole('row', { name: /Frame house/ }).filter({ hasText: 'Sample Framing Co' }).count() === 0);
// Moving a confirmed task puts the sub back on the list.
await page.goto(`${BASE}/jobs/maple/schedule`);
await page.getByRole('row', { name: /^Frame house/ }).getByRole('button', { name: 'Edit' }).click();
const pEnd = await modal().getByLabel('Finish').inputValue();
await modal().getByLabel('Finish').fill(new Date(Date.parse(pEnd) + 2 * 864e5).toISOString().slice(0, 10));
await modal().getByRole('button', { name: 'Save task' }).click();
await page.getByRole('button', { name: 'Move these tasks' }).or(page.getByText('Task saved')).first().waitFor();
if (await page.getByRole('button', { name: 'Move these tasks' }).count()) await page.getByRole('button', { name: 'Move these tasks' }).click();
await page.goto(`${BASE}/calls`);
await page.getByRole('heading', { name: 'Call list' }).waitFor();
check('new dates put the sub back on the call list', await page.getByRole('row', { name: /Frame house/ }).filter({ hasText: 'Sample Framing Co' }).count() === 1);
// Assign a task to crew from the schedule.
await page.goto(`${BASE}/jobs/oak/schedule`);
await page.getByRole('row', { name: /^Paint/ }).getByRole('button', { name: 'Edit' }).click();
await modal().getByLabel('Team member').selectOption({ label: 'Jordan' });
await modal().getByRole('button', { name: 'Save task' }).click();
await page.getByText('Task saved').waitFor();
check('assignment shows on the schedule', (await page.getByRole('row', { name: /^Paint/ }).innerText()).includes('Jordan'));
t = await find('large back porch');
check('search finds job needs', t.includes('Oak Ridge spec') && t.includes('What it needs'));
t = await find('ORD-99');
check('search finds a material by order number', t.includes('2x4x8 studs'));

// Crew login.
await page.goto(`${BASE}/`);
await page.getByLabel('Viewing as').selectOption('demo-crew');
await page.getByRole('heading', { name: 'My work' }).waitFor();
t = await text();
check('crew sees their tasks and what the job needs', ['Dry-in and roof', 'Paint', 'Large back porch', 'Oak Ridge spec'].every((x) => t.includes(x)));
check('crew sees what is coming and colors and plans', ['Windows', 'Agreeable Gray', 'Architectural plan set'].every((x) => t.includes(x)));
check('crew sees no money, subs, contacts, or other jobs', !['$', 'Sample Lender', 'Expected profit', 'Maple', 'Birch', 'ORD-99', 'Sample Plumbing', '937-555', '@example.com'].some((x) => t.includes(x)));
check('crew has no search box', await page.getByRole('searchbox').count() === 0);
await page.locator('section', { hasText: 'Oak Ridge spec' }).getByRole('button', { name: 'Ask for materials' }).click();
await modal().getByLabel('What do you need').fill('Quarter round');
await modal().getByLabel('How much').fill('60 ft');
await shot('27-crew-ask');
await modal().getByRole('button', { name: 'Send request' }).click();
await page.getByText('Request sent').waitFor();
check('crew sees their request', (await text()).includes('Quarter round'));
await shot('26-crew');
await page.getByLabel('Status of Dry-in and roof').selectOption('in_progress');
await page.getByText('Status updated').waitFor();
await page.locator('.row', { hasText: 'Windows' }).getByRole('button', { name: 'It arrived' }).click();
await page.getByText('Windows marked arrived').waitFor();
for (const path of ['/jobs/oak/budget', '/search?q=alabaster', '/subs', '/calls']) {
  await page.goto(`${BASE}${path}`);
  await page.getByRole('heading', { name: 'My work' }).waitFor();
  check(`crew is sent home from ${path}`, !(await text()).includes('Budget lines'));
}
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/`);
await page.getByRole('heading', { name: 'My work' }).waitFor();
const crewOver = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(`no sideways scroll on phone: crew (${crewOver}px)`, crewOver <= 0);
await shot('phone-crew');
await page.setViewportSize({ width: 1360, height: 900 });
await page.getByLabel('Viewing as').selectOption('demo-admin');
await page.getByRole('heading', { name: 'Today' }).waitFor();
await page.goto(`${BASE}/`);
await page.getByRole('heading', { name: 'Today' }).waitFor();
check('owner is told about the crew request', (await text()).includes('Jordan asked for 60 ft Quarter round'));
await page.goto(`${BASE}/jobs/oak/materials`);
check('owner sees the crew mark windows arrived', (await row('Windows').innerText()).includes('Arrived'));
check('request is flagged on the materials list', (await row('Quarter round').innerText()).includes('Asked for by Jordan'));
await shot('28-materials-request');
await row('Quarter round').getByRole('button', { name: 'Mark ordered' }).click();
await modal().getByLabel('Arriving').fill('2030-02-01');
await modal().getByRole('button', { name: 'Mark ordered' }).click();
await page.getByText('marked ordered').waitFor();
await page.goto(`${BASE}/`);
await page.getByRole('heading', { name: 'Today' }).waitFor();
check('ordering it clears the request flag', !(await text()).includes('Quarter round'));

// Contact details: admins only.
await page.goto(`${BASE}/subs`);
await page.getByRole('heading', { name: 'Subs' }).waitFor();
t = await text();
check('admin sees contact details', t.includes('937-555-0100') && t.includes('framing@example.com'));
await row('Sample Framing Co').getByRole('button', { name: 'Contacts' }).click();
await modal().getByRole('button', { name: 'Add a contact' }).click();
await modal().getByLabel('Name').fill('Billing Betty');
await modal().getByLabel('Role').fill('Billing');
await modal().getByLabel('Office phone').fill('937-555-0155');
await modal().getByRole('button', { name: 'Add contact' }).click();
await page.getByText('Contact saved').waitFor();
await shot('29-contacts');
check('a sub can hold several contacts', (await modal().innerText()).includes('Billing Betty'));
await modal().getByRole('button', { name: 'Close' }).click();
t = await find('billing betty');
check('admin can search by contact', t.includes('Sample Framing') || t.includes('Birch Ln ranch'));
await page.goto(`${BASE}/`);
await page.getByLabel('Viewing as').selectOption('demo-staff');
await page.getByRole('heading', { name: 'Today' }).waitFor();
await page.goto(`${BASE}/subs`);
await page.getByRole('heading', { name: 'Subs' }).waitFor();
t = await text();
check('staff see subs with no contact details', t.includes('Sample Framing Co') && !t.includes('937-555') && !t.includes('@example.com') && !t.includes('Billing Betty'));
check('staff have no Contacts button', await page.getByRole('button', { name: 'Contacts' }).count() === 0);
await shot('30-staff-subs');
await page.goto(`${BASE}/calls`);
await page.getByRole('heading', { name: 'Call list' }).waitFor();
t = await text();
check('staff call list hides numbers and message buttons', !t.includes('937-555') && t.includes('phone numbers and emails are private') && await page.getByRole('link', { name: 'Call', exact: true }).count() === 0 && await page.getByRole('button', { name: 'Message' }).count() === 0);
t = await find('9375550100');
check('staff cannot find a job by a contact phone', t.includes('No jobs match'));
t = await find('billing betty');
check('staff cannot search contact names', t.includes('No jobs match'));
await page.goto(`${BASE}/jobs/birch/record`);
await page.getByRole('heading', { name: 'Who did each step' }).waitFor();
check('staff job record has no sub phones', !(await text()).includes('937-555-0100'));
await page.goto(`${BASE}/team`);
await page.getByRole('heading', { name: 'Today' }).waitFor();
check('staff are sent away from the Team page', !(await text()).includes('Invite someone'));
await page.getByLabel('Viewing as').selectOption('demo-admin');
await page.getByRole('heading', { name: 'Today' }).waitFor();

// Sub portal.
await page.goto(`${BASE}/`);
await page.getByLabel('Viewing as').selectOption('demo-sub');
await page.getByRole('heading', { name: 'Sample Framing Co' }).waitFor();
t = await text();
check('sub has no money or other-sub data', !['$485,000', '$540,000', 'Sample Lender', 'Sample Plumbing', 'Sample Electric', 'Expected profit', 'Cedar', 'Birch', 'Alabaster', 'Agreeable Gray', 'plan set'].some((x) => t.includes(x)));
check('sub has no search box', await page.getByRole('searchbox').count() === 0);
await shot('08-portal');
await page.getByRole('button', { name: 'Accept' }).click();
await page.getByText('Work order accepted').waitFor();
await page.getByRole('button', { name: "I'll be there" }).first().click();
await page.getByText("you're confirmed").waitFor();
check('sub can confirm from the portal', (await text()).includes('You confirmed these dates'));
await page.locator('.portalcard', { hasText: 'Frame house, labor' }).getByRole('button', { name: 'Submit a bill' }).click();
await modal().getByLabel('Invoice number').fill('F-300');
await modal().getByLabel('Amount').fill('5000');
await modal().getByRole('button', { name: 'Submit bill' }).click();
await page.getByText('Bill submitted').waitFor();
check('sub sees the new bill', (await row('F-300').innerText()).includes('Submitted'));
await page.goto(`${BASE}/search?q=alabaster`);
check('sub cannot open search', !(await text()).includes('Alabaster') && !(await text()).includes('All jobs'));
await page.goto(`${BASE}/jobs/birch/record`);
check('sub cannot open a job record', !(await text()).includes('Who did each step'));
await page.goto(`${BASE}/subs`);
check('sub cannot open the Subs page', !(await text()).includes('Paid all time'));
await page.goto(`${BASE}/jobs/oak/budget`);
check('sub cannot open a job budget', !(await text()).includes('Budget lines'));

// Owner sees that bill come in.
await page.getByLabel('Viewing as').selectOption('demo-admin');
await page.getByRole('heading', { name: 'Today' }).waitFor();
check('owner is asked to approve it', (await text()).includes("Approve or reject Sample Framing Co's $5,000 bill"));
await page.goto(`${BASE}/subs`);
await page.getByRole('heading', { name: 'Subs' }).waitFor();
await shot('09-subs');

// Contractor photos: send, review, see the answer.
await page.goto(`${BASE}/`);
await page.getByLabel('Viewing as').selectOption('demo-sub');
await page.getByRole('heading', { name: 'Sample Framing Co' }).waitFor();
check('contractor sees only their own photo so far', (await text()).includes('Waiting for review') && !(await text()).includes('Foundation poured'));
await page.getByRole('button', { name: 'Send job photos' }).click();
await modal().getByLabel('Photos', { exact: true }).setInputFiles([
  { name: 'porch-a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('a') },
  { name: 'porch-b.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('b') },
]);
await modal().getByLabel('Caption').fill('Porch framing');
await shot('31-send-photos');
await modal().getByRole('button', { name: 'Send photos' }).click();
await page.getByText('2 photos sent for review').waitFor();
await page.getByLabel('Viewing as').selectOption('demo-admin');
await page.getByRole('heading', { name: 'Today' }).waitFor();
check('owner is asked to review', (await text()).includes('Review 3 photos from Sample Framing Co'));
await page.goto(`${BASE}/jobs/oak/log`);
await page.getByRole('heading', { name: /Photos to review \(3\)/ }).waitFor();
await shot('32-review-photos');
const rev = page.locator('.review');
await rev.filter({ hasText: 'Second-floor walls up' }).getByRole('button', { name: 'Approve', exact: true }).click();
await page.getByText('Photo approved').waitFor();
await rev.filter({ hasText: 'Porch framing' }).first().getByRole('button', { name: 'Disapprove' }).click();
await modal().getByRole('button', { name: 'Disapprove photo' }).click();
check('disapproving asks for a reason', await modal().count() === 1);
await modal().getByLabel('What needs fixing').fill('Too dark, retake with lights on');
await modal().getByRole('button', { name: 'Disapprove photo' }).click();
await page.getByText('Photo disapproved').waitFor();
await page.goto(`${BASE}/jobs/oak/record`);
await page.getByRole('heading', { name: 'Who did each step' }).waitFor();
t = await text();
check('job record has approved photos, not disapproved or waiting', t.includes('Second-floor walls up') && !t.includes('Porch framing'));
await page.goto(`${BASE}/`);
await page.getByLabel('Viewing as').selectOption('demo-sub');
await page.getByRole('heading', { name: 'Sample Framing Co' }).waitFor();
t = await text();
check('contractor sees the answer and the reason', t.includes('Approved') && t.includes('Disapproved') && t.includes('Too dark, retake with lights on') && t.includes('Waiting for review'));
await shot('33-portal-photos');
await page.getByLabel('Viewing as').selectOption('demo-admin');
await page.getByRole('heading', { name: 'Today' }).waitFor();

// Reload keeps data. Phone width has no sideways page scroll.
await page.reload();
await page.goto(`${BASE}/jobs/oak/bills`);
check('data survives a reload', (await row('E-1').count()) === 1);
await page.setViewportSize({ width: 390, height: 844 });
for (const [path, name] of [['/', 'today'], ['/jobs/oak/budget', 'budget'], ['/jobs/oak/bills', 'bills'], ['/jobs/oak/schedule', 'schedule'], ['/subs', 'subs'], ['/search?q=alabaster', 'search'], ['/jobs/birch/record', 'record'], ['/jobs/birch/files', 'files'], ['/jobs/oak/materials', 'materials'], ['/calls', 'calls']]) {
  await page.goto(`${BASE}${path}`);
  await page.locator('main h1').first().waitFor();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`no sideways scroll on phone: ${name} (${over}px)`, over <= 0);
  await shot(`phone-${name}`);
}
await page.goto(`${BASE}/`);
await page.getByLabel('Viewing as').selectOption('demo-sub');
await page.getByRole('heading', { name: 'Sample Framing Co' }).waitFor();
const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(`no sideways scroll on phone: portal (${over}px)`, over <= 0);
await shot('phone-portal');

await browser.close();
console.log(`\n${passed} passed, ${problems.length} problems`);
problems.forEach((p) => console.log(' -', p));
process.exit(problems.length ? 1 : 0);
