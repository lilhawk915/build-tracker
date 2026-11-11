// Runs the real migration in Postgres (PGlite, in-process) with Supabase's auth and storage stubbed,
// then logs in as each role to prove the rules hold at the database.
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;

const ADMIN = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';
const SUB_A = '00000000-0000-0000-0000-00000000000c';
const SUB_B = '00000000-0000-0000-0000-00000000000d';
const NOBODY = '00000000-0000-0000-0000-00000000000e';
const VA = '10000000-0000-0000-0000-00000000000a';
const VB = '10000000-0000-0000-0000-00000000000b';
const JOB = '20000000-0000-0000-0000-000000000001';
const JOB2 = '20000000-0000-0000-0000-000000000002';
const LINE = '30000000-0000-0000-0000-000000000001';
const LINE2 = '30000000-0000-0000-0000-000000000002';
const PO_A = '40000000-0000-0000-0000-00000000000a';
const PO_B = '40000000-0000-0000-0000-00000000000b';

const STUBS = `
  create role anon nologin; create role authenticated nologin;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema auth, storage, public to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  grant all on storage.objects to authenticated;
  alter default privileges in schema public grant all on tables to authenticated, anon;
`;

async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.sub', $1, false)`, [uid ?? '']);
  await db.query(uid ? 'set role authenticated' : 'set role anon');
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.query('reset role');
  }
}
const root = (sql: string, params: unknown[] = []) => as(null, 'select 1').then(() => db.query(sql, params));

async function newBill(vendor = VA, po = PO_A, amount = 100000) {
  const r = await root(
    `insert into public.bills (job_id, vendor_id, po_id, budget_line_id, amount_cents, status)
     values ($1, $2, $3, $4, $5, 'submitted') returning id`, [JOB, vendor, po, LINE, amount]);
  return (r.rows[0] as { id: string }).id;
}
const setStatus = (uid: string, id: string, status: string, extra = '') =>
  as(uid, `update public.bills set status = '${status}' ${extra} where id = $1 returning *`, [id]);
const receiveWaivers = (id: string) =>
  root(`update public.lien_waivers set status = 'received' where bill_id = $1`, [id]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  for (const f of readdirSync('supabase/migrations').sort()) {
    await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  }
  await db.exec(`
    insert into public.vendors (id, name, coi_expires) values
      ('${VA}', 'Alpha Framing', current_date + 90), ('${VB}', 'Bravo Plumbing', current_date + 90);
    insert into public.team_invites (email, role) values ('owner@x.com', 'admin'), ('pm@x.com', 'staff');
    insert into public.team_invites (email, role, vendor_id) values ('a@sub.com', 'sub', '${VA}'), ('b@sub.com', 'sub', '${VB}');
    insert into auth.users (id, email) values
      ('${ADMIN}', 'Owner@x.com'), ('${STAFF}', 'pm@x.com'), ('${SUB_A}', 'a@sub.com'), ('${SUB_B}', 'b@sub.com'), ('${NOBODY}', 'stranger@x.com');
    insert into public.jobs (id, name, address, sale_price_cents, loan_amount_cents) values
      ('${JOB}', 'Oak St', '1 Oak', 45000000, 30000000), ('${JOB2}', 'Secret Job', '2 Elm', 1, 1);
    insert into public.budget_lines (id, job_id, name, budget_cents) values
      ('${LINE}', '${JOB}', 'Framing', 5000000), ('${LINE2}', '${JOB2}', 'Other', 100);
    insert into public.pos (id, job_id, vendor_id, budget_line_id, amount_cents, status) values
      ('${PO_A}', '${JOB}', '${VA}', '${LINE}', 3000000, 'accepted'),
      ('${PO_B}', '${JOB}', '${VB}', '${LINE}', 1000000, 'accepted');
    insert into public.pos (job_id, vendor_id, budget_line_id, amount_cents, status, description) values
      ('${JOB}', '${VA}', '${LINE}', 111, 'draft', 'hidden draft');
    insert into public.tasks (job_id, vendor_id, name, start_date, end_date) values
      ('${JOB}', '${VA}', 'Frame house', current_date, current_date + 5),
      ('${JOB}', '${VB}', 'Rough plumbing', current_date, current_date + 5);
  `);
}, 60000);

describe('signup and roles', () => {
  it('takes the role from the invite, matching email in any case', async () => {
    const [p] = await as<{ role: string }>(ADMIN, 'select role from public.profiles where id = auth.uid()');
    expect(p.role).toBe('admin');
  });
  it('gives no access to a login with no invite', async () => {
    const [p] = await as<{ role: string }>(NOBODY, 'select role from public.profiles where id = auth.uid()');
    expect(p.role).toBe('none');
    for (const t of ['jobs', 'vendors', 'bills', 'pos', 'tasks', 'budget_lines', 'draws', 'lien_waivers', 'team_invites']) {
      expect(await as(NOBODY, `select * from public.${t}`), t).toHaveLength(0);
    }
    expect(await as(NOBODY, 'select * from public.my_jobs()')).toHaveLength(0);
  });
  it('stops people promoting themselves', async () => {
    await as(STAFF, `update public.profiles set role = 'admin' where id = auth.uid()`);
    await as(SUB_A, `update public.profiles set role = 'admin' where id = auth.uid()`);
    await as(NOBODY, `update public.profiles set role = 'admin' where id = auth.uid()`);
    const r = await root(`select role from public.profiles where id = any($1) order by email`, [[STAFF, SUB_A, NOBODY]]);
    expect((r.rows as { role: string }[]).map((x) => x.role).sort()).toEqual(['none', 'staff', 'sub']);
  });
  it('stops non-admins creating invites', async () => {
    await expect(as(STAFF, `insert into public.team_invites (email, role) values ('x@x.com','admin')`)).rejects.toThrow();
    await expect(as(SUB_A, `insert into public.team_invites (email, role) values ('x@x.com','admin')`)).rejects.toThrow();
  });
  it('applies a late invite to someone already logged in', async () => {
    await as(ADMIN, `insert into public.team_invites (email, role) values ('stranger@x.com', 'staff')`);
    const [p] = await as<{ role: string }>(NOBODY, 'select role from public.profiles where id = auth.uid()');
    expect(p.role).toBe('staff');
    await root(`update public.profiles set role = 'none' where id = $1`, [NOBODY]);
    await root(`delete from public.team_invites where email = 'stranger@x.com'`);
  });
  it('gives logged-out visitors nothing', async () => {
    await expect(as(null, 'select * from public.jobs')).rejects.toThrow();
    await expect(as(null, 'select * from public.my_jobs()')).rejects.toThrow();
  });
});

describe('sub isolation', () => {
  it('hides the jobs table, including price and loan', async () => {
    expect(await as(SUB_A, 'select * from public.jobs')).toHaveLength(0);
    expect(await as(SUB_A, 'select * from public.budget_lines')).toHaveLength(0);
    expect(await as(SUB_A, 'select * from public.change_orders')).toHaveLength(0);
    expect(await as(SUB_A, 'select * from public.draws')).toHaveLength(0);
  });
  it('lists only assigned jobs, with no money columns', async () => {
    const rows = await as<Record<string, unknown>>(SUB_A, 'select * from public.my_jobs()');
    expect(rows).toEqual([{ id: JOB, name: 'Oak St', address: '1 Oak' }]);
  });
  it('shows only their own vendor, POs and tasks', async () => {
    const v = await as<{ id: string }>(SUB_A, 'select id from public.vendors');
    expect(v.map((x) => x.id)).toEqual([VA]);
    const p = await as<{ id: string }>(SUB_A, 'select id from public.pos');
    expect(p.map((x) => x.id)).toEqual([PO_A]);
    const t = await as<{ name: string }>(SUB_A, 'select name from public.tasks');
    expect(t.map((x) => x.name)).toEqual(['Frame house']);
  });
  it('hides draft POs even when they are their own', async () => {
    const p = await as(SUB_A, `select id from public.pos where description = 'hidden draft'`);
    expect(p).toHaveLength(0);
  });
  it("hides another sub's bills and waivers", async () => {
    const billB = await newBill(VB, PO_B);
    expect(await as(SUB_A, 'select id from public.bills where id = $1', [billB])).toHaveLength(0);
    await setStatus(STAFF, billB, 'approved');
    expect(await as(SUB_B, 'select id from public.lien_waivers where bill_id = $1', [billB])).toHaveLength(1);
    expect(await as(SUB_A, 'select id from public.lien_waivers where bill_id = $1', [billB])).toHaveLength(0);
  });
  it('blocks direct edits to their own PO, task or vendor record', async () => {
    const po = await as(SUB_A, `update public.pos set amount_cents = 99999999 where id = $1 returning id`, [PO_A]);
    expect(po).toHaveLength(0);
    expect(await as(SUB_A, `update public.tasks set name = 'x' returning id`)).toHaveLength(0);
    const far = new Date(Date.now() + 3e11).toISOString().slice(0, 10);
    expect(await as(SUB_A, `update public.vendors set coi_expires = '${far}' returning id`)).toHaveLength(0);
  });
  it('blocks sub self-approval and deleting bills', async () => {
    const [b] = await as<{ id: string }>(SUB_A,
      `insert into public.bills (job_id, vendor_id, po_id, budget_line_id, amount_cents) values ($1,$2,$3,$4,500) returning id`,
      [JOB, VA, PO_A, LINE]);
    expect(await setStatus(SUB_A, b.id, 'approved')).toHaveLength(0);
    expect(await as(SUB_A, 'delete from public.bills where id = $1 returning id', [b.id])).toHaveLength(0);
  });
});

describe('sub billing', () => {
  it("overrides whatever job, line, or status a sub tries to send", async () => {
    const [b] = await as<{ job_id: string; budget_line_id: string; status: string }>(SUB_A,
      `insert into public.bills (job_id, vendor_id, po_id, budget_line_id, amount_cents, status)
       values ($1,$2,$3,$4,500,'submitted') returning job_id, budget_line_id, status`,
      [JOB2, VA, PO_A, LINE2]);
    expect(b).toEqual({ job_id: JOB, budget_line_id: LINE, status: 'submitted' });
  });
  it('rejects bills claiming to be approved or paid', async () => {
    await expect(as(SUB_A,
      `insert into public.bills (job_id, vendor_id, po_id, budget_line_id, amount_cents, status)
       values ($1,$2,$3,$4,500,'paid')`, [JOB, VA, PO_A, LINE])).resolves.toBeDefined();
    const bad = await root(`select count(*)::int n from public.bills where status = 'paid' and amount_cents = 500`);
    expect((bad.rows[0] as { n: number }).n).toBe(0);
  });
  it("rejects billing another sub's PO", async () => {
    await expect(as(SUB_A,
      `insert into public.bills (job_id, vendor_id, po_id, budget_line_id, amount_cents) values ($1,$2,$3,$4,500)`,
      [JOB, VA, PO_B, LINE])).rejects.toThrow(/not yours/);
  });
  it('rejects billing with no PO', async () => {
    await expect(as(SUB_A,
      `insert into public.bills (job_id, vendor_id, budget_line_id, amount_cents) values ($1,$2,$3,500)`,
      [JOB, VA, LINE])).rejects.toThrow(/work order/);
  });
  it('rejects billing a PO not yet accepted', async () => {
    const r = await root(`insert into public.pos (job_id, vendor_id, budget_line_id, amount_cents, status)
      values ($1,$2,$3,100,'sent') returning id`, [JOB, VA, LINE]);
    const id = (r.rows[0] as { id: string }).id;
    await expect(as(SUB_A,
      `insert into public.bills (job_id, vendor_id, po_id, budget_line_id, amount_cents) values ($1,$2,$3,$4,50)`,
      [JOB, VA, id, LINE])).rejects.toThrow(/Accept/);
    await as(SUB_A, 'select public.respond_po($1, true)', [id]);
    await expect(as(SUB_B, 'select public.respond_po($1, false)', [id])).rejects.toThrow(/not waiting/);
    await expect(as(SUB_A, 'select public.respond_po($1, false)', [id])).rejects.toThrow(/not waiting/);
    const s = await root('select status from public.pos where id = $1', [id]);
    expect((s.rows[0] as { status: string }).status).toBe('accepted');
  });
  it("won't let a sub change another sub's task", async () => {
    const [t] = await as<{ id: string }>(SUB_B, `select id from public.tasks`);
    await expect(as(SUB_A, `select public.set_task_status($1, 'done')`, [t.id])).rejects.toThrow(/not assigned/);
    await as(SUB_B, `select public.set_task_status($1, 'in_progress')`, [t.id]);
    const [row] = await as<{ status: string }>(SUB_B, 'select status from public.tasks');
    expect(row.status).toBe('in_progress');
  });
});

describe('payment gate', () => {
  it('asks for a waiver as soon as a bill is approved', async () => {
    const id = await newBill();
    await setStatus(STAFF, id, 'approved');
    const r = await root('select kind, status, amount_cents from public.lien_waivers where bill_id = $1', [id]);
    expect(r.rows).toEqual([{ kind: 'conditional_progress', status: 'requested', amount_cents: '100000' }].map((x) => ({ ...x, amount_cents: 100000 })));
  });
  it('blocks skipping approval', async () => {
    const id = await newBill();
    await expect(setStatus(ADMIN, id, 'paid')).rejects.toThrow(/cannot go from submitted to paid/);
  });
  it('blocks payment with no waiver', async () => {
    const id = await newBill();
    await setStatus(STAFF, id, 'approved');
    await expect(setStatus(STAFF, id, 'paid')).rejects.toThrow(/no lien waiver/);
  });
  it('pays once the waiver is in, then asks for the unconditional', async () => {
    const id = await newBill();
    await setStatus(STAFF, id, 'approved');
    await receiveWaivers(id);
    const [b] = await setStatus(STAFF, id, 'paid') as { status: string; paid_date: unknown }[];
    expect(b.status).toBe('paid');
    expect(b.paid_date).toBeTruthy();
    const r = await root(`select kind, status from public.lien_waivers where bill_id = $1 order by created_at, kind`, [id]);
    expect(r.rows).toContainEqual({ kind: 'unconditional_progress', status: 'requested' });
  });
  it('blocks payment on expired insurance', async () => {
    const id = await newBill();
    await setStatus(STAFF, id, 'approved');
    await receiveWaivers(id);
    await root(`update public.vendors set coi_expires = current_date - 1 where id = $1`, [VA]);
    await expect(setStatus(STAFF, id, 'paid')).rejects.toThrow(/insurance expired/);
    await root(`update public.vendors set coi_expires = current_date + 90 where id = $1`, [VA]);
  });
  it('checks insurance against the paid date, not today', async () => {
    const id = await newBill();
    await setStatus(STAFF, id, 'approved');
    await receiveWaivers(id);
    await expect(setStatus(STAFF, id, 'paid', `, paid_date = current_date + 400`)).rejects.toThrow(/insurance expired/);
  });
  it('blocks staff overrides but lets an admin override with a reason', async () => {
    const id = await newBill();
    await setStatus(STAFF, id, 'approved');
    await expect(setStatus(STAFF, id, 'paid', `, override_reason = 'trust me'`)).rejects.toThrow(/Cannot pay/);
    await expect(setStatus(ADMIN, id, 'paid', `, override_reason = '   '`)).rejects.toThrow(/Cannot pay/);
    const [b] = await setStatus(ADMIN, id, 'paid', `, override_reason = 'Emergency roof'`) as { status: string; override_by: string }[];
    expect(b.status).toBe('paid');
    expect(b.override_by).toBe(ADMIN);
  });
  it('locks paid bills', async () => {
    const id = await newBill();
    await setStatus(STAFF, id, 'approved');
    await receiveWaivers(id);
    await setStatus(STAFF, id, 'paid');
    await expect(as(ADMIN, 'update public.bills set amount_cents = 1 where id = $1', [id])).rejects.toThrow(/already paid/);
    await expect(as(ADMIN, `update public.bills set override_reason = 'x' where id = $1`, [id])).rejects.toThrow(/cannot be edited/);
    await expect(as(STAFF, 'delete from public.bills where id = $1', [id])).rejects.toThrow(/admin/);
    await expect(setStatus(STAFF, id, 'approved')).rejects.toThrow(/admin/);
    const [undone] = await setStatus(ADMIN, id, 'approved') as { status: string; paid_date: unknown }[];
    expect(undone.status).toBe('approved');
    expect(undone.paid_date).toBeNull();
  });
  it('locks the amount once approved', async () => {
    const id = await newBill();
    await setStatus(STAFF, id, 'approved');
    await expect(as(STAFF, 'update public.bills set amount_cents = 5 where id = $1', [id])).rejects.toThrow(/already approved/);
  });
});

describe('waivers from subs', () => {
  it('accepts only their own file path on their own waiver', async () => {
    const id = await newBill();
    await setStatus(STAFF, id, 'approved');
    const r = await root('select id from public.lien_waivers where bill_id = $1', [id]);
    const w = (r.rows[0] as { id: string }).id;
    await expect(as(SUB_B, 'select public.submit_waiver($1, $2)', [w, `vendor/${VB}/w.pdf`])).rejects.toThrow(/not waiting/);
    await expect(as(SUB_A, 'select public.submit_waiver($1, $2)', [w, `vendor/${VB}/w.pdf`])).rejects.toThrow(/Upload/);
    await expect(as(SUB_A, 'select public.submit_waiver($1, $2)', [w, `${JOB}/w.pdf`])).rejects.toThrow(/Upload/);
    await as(SUB_A, 'select public.submit_waiver($1, $2)', [w, `vendor/${VA}/w.pdf`]);
    await as(STAFF, `update public.bills set status = 'paid' where id = $1`, [id]);
    const b = await root('select status from public.bills where id = $1', [id]);
    expect((b.rows[0] as { status: string }).status).toBe('paid');
  });
});

describe('files', () => {
  const put = (uid: string, name: string) =>
    as(uid, `insert into storage.objects (bucket_id, name) values ('job-files', $1)`, [name]);
  it("keeps subs inside their own folder", async () => {
    await put(SUB_A, `vendor/${VA}/a.pdf`);
    await expect(put(SUB_A, `vendor/${VB}/evil.pdf`)).rejects.toThrow();
    await expect(put(SUB_A, `${JOB}/evil.pdf`)).rejects.toThrow();
    await put(STAFF, `${JOB}/plans.pdf`);
    await put(SUB_B, `vendor/${VB}/b.pdf`);
    const a = await as<{ name: string }>(SUB_A, 'select name from storage.objects');
    expect(a.map((x) => x.name)).toEqual([`vendor/${VA}/a.pdf`]);
    expect((await as(STAFF, 'select name from storage.objects')).length).toBe(3);
  });
  it('keeps no-access logins out of files', async () => {
    expect(await as(NOBODY, 'select name from storage.objects')).toHaveLength(0);
    await expect(put(NOBODY, 'vendor/null/x.pdf')).rejects.toThrow();
  });
});

describe('change orders', () => {
  it('flows approved cost into the PO and backs it out when reversed', async () => {
    const [c] = await as<{ id: string }>(STAFF,
      `insert into public.change_orders (job_id, budget_line_id, po_id, description, cost_delta_cents, price_delta_cents)
       values ($1,$2,$3,'Extra',25000,40000) returning id`, [JOB, LINE, PO_B]);
    const co = async () => ((await root('select approved_co_cents n from public.pos where id = $1', [PO_B])).rows[0] as { n: number }).n;
    expect(Number(await co())).toBe(0);
    await as(STAFF, `update public.change_orders set status = 'approved' where id = $1`, [c.id]);
    expect(Number(await co())).toBe(25000);
    await as(STAFF, `update public.change_orders set status = 'rejected' where id = $1`, [c.id]);
    expect(Number(await co())).toBe(0);
    await as(STAFF, `update public.change_orders set status = 'approved' where id = $1`, [c.id]);
    await as(STAFF, 'delete from public.change_orders where id = $1', [c.id]);
    expect(Number(await co())).toBe(0);
  });
  it("rejects a change order on another job's budget line", async () => {
    await expect(as(STAFF,
      `insert into public.change_orders (job_id, budget_line_id) values ($1,$2)`, [JOB, LINE2])).rejects.toThrow(/different job/);
  });
  it('numbers records separately per job', async () => {
    const r = await as<{ number: number }>(STAFF,
      `insert into public.draws (job_id) values ($1), ($1), ($2) returning number`, [JOB, JOB2]);
    expect(r.map((x) => x.number)).toEqual([1, 2, 1]);
  });
});

describe('crew', () => {
  const CREW = '00000000-0000-0000-0000-00000000000f';
  const CREW2 = '00000000-0000-0000-0000-000000000010';
  const JOB3 = '20000000-0000-0000-0000-000000000003';
  const JOB4 = '20000000-0000-0000-0000-000000000004';
  let myTask: string;
  let otherTask: string;
  let matHere: string;
  let matThere: string;
  beforeAll(async () => {
    await db.exec(`
      insert into public.team_invites (email, role) values ('c1@x.com','crew'), ('c2@x.com','crew');
      insert into auth.users (id, email) values ('${CREW}','c1@x.com'), ('${CREW2}','c2@x.com');
      insert into public.jobs (id, name, address, sale_price_cents, loan_amount_cents, client_name) values
        ('${JOB3}','Crew Job','3 Crew St',99900000,88800000,'Secret Client'), ('${JOB4}','Other Job','4 Other St',1,1,'');
      insert into public.scope_items (job_id, title) values ('${JOB3}','Back porch'), ('${JOB4}','Hidden porch');
      insert into public.selections (job_id, color_name) values ('${JOB3}','Crew Color'), ('${JOB4}','Hidden Color');
      insert into public.documents (job_id, category, title, file_path) values
        ('${JOB3}','Drawings','Plans','${JOB3}/plans.pdf'),
        ('${JOB3}','Contracts','Contract','${JOB3}/contract.pdf'),
        ('${JOB4}','Drawings','Hidden Plans','${JOB4}/plans.pdf');
      insert into storage.objects (bucket_id, name) values
        ('job-files','${JOB3}/plans.pdf'), ('job-files','${JOB3}/contract.pdf'), ('job-files','${JOB4}/plans.pdf');
    `);
    const t = await root(`insert into public.tasks (job_id, name, start_date, end_date, assigned_to) values
      ($1,'Set posts',current_date,current_date,$2),($1,'Someone else',current_date,current_date,$3) returning id`, [JOB3, CREW, CREW2]);
    [myTask, otherTask] = (t.rows as { id: string }[]).map((r) => r.id);
    await root(`insert into public.tasks (job_id, name, start_date, end_date, assigned_to) values ($1,'Elsewhere',current_date,current_date,$2)`, [JOB4, CREW2]);
    const m = await root(`insert into public.materials (job_id, name, status, cost_cents) values
      ($1,'Posts','ordered',123456),($2,'Hidden stuff','ordered',1) returning id`, [JOB3, JOB4]);
    [matHere, matThere] = (m.rows as { id: string }[]).map((r) => r.id);
  });
  it('gets the crew role from the invite', async () => {
    const [p] = await as<{ role: string }>(CREW, 'select role from public.profiles where id = auth.uid()');
    expect(p.role).toBe('crew');
  });
  it('sees assigned jobs with no money columns', async () => {
    expect(await as(CREW, 'select * from public.my_jobs()')).toEqual([{ id: JOB3, name: 'Crew Job', address: '3 Crew St' }]);
    expect(await as(CREW, 'select * from public.jobs')).toHaveLength(0);
  });
  it('has no way to read budgets, bills, POs, draws, subs, or waivers', async () => {
    for (const t of ['budget_lines', 'pos', 'bills', 'change_orders', 'draws', 'draw_lines', 'lien_waivers', 'vendors', 'materials', 'notifications', 'job_steps', 'team_invites', 'daily_logs', 'photos']) {
      expect(await as(CREW, `select * from public.${t}`), t).toHaveLength(0);
    }
  });
  it('sees needs, colors, and the schedule only on their own jobs', async () => {
    expect((await as<{ title: string }>(CREW, 'select title from public.scope_items')).map((r) => r.title)).toEqual(['Back porch']);
    expect((await as<{ color_name: string }>(CREW, 'select color_name from public.selections')).map((r) => r.color_name)).toEqual(['Crew Color']);
    expect((await as<{ name: string }>(CREW, 'select name from public.tasks order by name')).map((r) => r.name)).toEqual(['Set posts', 'Someone else']);
  });
  it('sees plans but not contracts', async () => {
    expect((await as<{ title: string }>(CREW, 'select title from public.documents')).map((r) => r.title)).toEqual(['Plans']);
    expect((await as<{ name: string }>(CREW, 'select name from storage.objects')).map((r) => r.name)).toEqual([`${JOB3}/plans.pdf`]);
  });
  it('reads materials on their job with no cost', async () => {
    const rows = await as<Record<string, unknown>>(CREW, 'select * from public.crew_materials()');
    expect(rows.map((r) => r.name)).toEqual(['Posts']);
    expect(Object.keys(rows[0])).not.toContain('cost_cents');
  });
  it('can mark materials arrived only on their own job, and only once', async () => {
    await expect(as(CREW, 'select public.mark_material_arrived($1)', [matThere])).rejects.toThrow(/not on one of your jobs/);
    await as(CREW, 'select public.mark_material_arrived($1)', [matHere]);
    const r = await root('select status, arrived_date from public.materials where id = $1', [matHere]);
    expect((r.rows[0] as { status: string }).status).toBe('arrived');
    await expect(as(CREW, 'select public.mark_material_arrived($1)', [matHere])).rejects.toThrow();
  });
  it('can update only their own tasks', async () => {
    await as(CREW, `select public.set_task_status($1, 'done')`, [myTask]);
    await expect(as(CREW, `select public.set_task_status($1, 'done')`, [otherTask])).rejects.toThrow(/not assigned/);
  });
  it('cannot edit anything directly', async () => {
    expect(await as(CREW, `update public.tasks set name = 'x' returning id`)).toHaveLength(0);
    expect(await as(CREW, `update public.scope_items set title = 'x' returning id`)).toHaveLength(0);
    await expect(as(CREW, `insert into public.scope_items (job_id, title) values ($1,'x')`, [JOB3])).rejects.toThrow();
    await expect(as(CREW, `insert into public.materials (job_id, name) values ($1,'x')`, [JOB3])).rejects.toThrow();
  });
  it('cannot confirm a contractor', async () => {
    await expect(as(CREW, 'select public.confirm_task($1)', [otherTask])).rejects.toThrow(/not assigned/);
  });
  it('loses access when the job closes', async () => {
    await root(`update public.jobs set status = 'closed' where id = $1`, [JOB3]);
    expect(await as(CREW, 'select * from public.my_jobs()')).toHaveLength(0);
    expect(await as(CREW, 'select * from public.scope_items')).toHaveLength(0);
    await root(`update public.jobs set status = 'active' where id = $1`, [JOB3]);
  });
  it('keeps subs and visitors away from needs, materials, and the contact log', async () => {
    for (const t of ['scope_items', 'materials', 'notifications']) {
      expect(await as(SUB_A, `select * from public.${t}`), t).toHaveLength(0);
      await expect(as(null, `select * from public.${t}`), t).rejects.toThrow();
    }
    expect(await as(SUB_A, 'select * from public.crew_materials()')).toHaveLength(0);
    await expect(as(null, 'select * from public.crew_materials()')).rejects.toThrow();
    await expect(as(null, `select public.mark_material_arrived($1)`, [matThere])).rejects.toThrow();
  });
});

describe('contractor confirmation', () => {
  const taskFor = async () => {
    const r = await root(`insert into public.tasks (job_id, vendor_id, name, start_date, end_date)
      values ($1,$2,'Confirm me',current_date + 3,current_date + 5) returning id`, [JOB, VA]);
    return (r.rows[0] as { id: string }).id;
  };
  const status = async (id: string) =>
    ((await root('select contact_status s, confirmed_at c from public.tasks where id = $1', [id])).rows[0] as { s: string; c: unknown });
  it('lets the sub confirm their own task, but not another sub', async () => {
    const id = await taskFor();
    await expect(as(SUB_B, 'select public.confirm_task($1)', [id])).rejects.toThrow(/not assigned/);
    await as(SUB_A, 'select public.confirm_task($1)', [id]);
    expect((await status(id)).s).toBe('confirmed');
  });
  it('resets when the dates move, so they get called again', async () => {
    const id = await taskFor();
    await as(SUB_A, 'select public.confirm_task($1)', [id]);
    await as(STAFF, `update public.tasks set start_date = current_date + 10, end_date = current_date + 12 where id = $1`, [id]);
    const s = await status(id);
    expect(s.s).toBe('not_contacted');
    expect(s.c).toBeNull();
  });
  it('resets when the sub changes', async () => {
    const id = await taskFor();
    await as(STAFF, `update public.tasks set contact_status = 'confirmed' where id = $1`, [id]);
    await as(STAFF, `update public.tasks set vendor_id = $2 where id = $1`, [id, VB]);
    expect((await status(id)).s).toBe('not_contacted');
  });
  it('keeps the confirmation for other edits', async () => {
    const id = await taskFor();
    await as(STAFF, `update public.tasks set contact_status = 'confirmed' where id = $1`, [id]);
    await as(STAFF, `update public.tasks set notes = 'gate code 1234' where id = $1`, [id]);
    expect((await status(id)).s).toBe('confirmed');
  });
});

describe('private contractor contacts', () => {
  let cid: string;
  beforeAll(async () => {
    const r = await root(`insert into public.vendor_contacts (vendor_id, name, mobile, email, is_primary) values ($1,'Sam Secret','937-555-0199','sam@secret.com',true) returning id`, [VA]);
    cid = (r.rows[0] as { id: string }).id;
  });
  const others = () => [STAFF, SUB_A, SUB_B, NOBODY];
  it('lets admins read and edit', async () => {
    expect(await as(ADMIN, 'select * from public.vendor_contacts')).toHaveLength(1);
    expect(await as(ADMIN, `update public.vendor_contacts set title = 'Owner' where id = $1 returning id`, [cid])).toHaveLength(1);
  });
  it('hides them from staff, subs, including their own company, and no-access logins', async () => {
    for (const who of others()) {
      expect(await as(who, 'select * from public.vendor_contacts'), who).toHaveLength(0);
      expect(await as(who, `update public.vendor_contacts set name = 'x' returning id`), who).toHaveLength(0);
      expect(await as(who, 'delete from public.vendor_contacts returning id'), who).toHaveLength(0);
      await expect(as(who, `insert into public.vendor_contacts (vendor_id, name) values ($1,'x')`, [VA]), who).rejects.toThrow();
    }
    await expect(as(null, 'select * from public.vendor_contacts')).rejects.toThrow();
  });
  it('has no contact details left on the sub table anyone can read', async () => {
    const [v] = await as<Record<string, unknown>>(STAFF, 'select * from public.vendors limit 1');
    for (const col of ['contact_name', 'phone', 'email']) expect(Object.keys(v)).not.toContain(col);
  });
  it("keeps sub logins' emails from staff, but not from admins", async () => {
    expect(await as(STAFF, `select email from public.profiles where role = 'sub'`)).toHaveLength(0);
    expect((await as(STAFF, `select email from public.profiles where role = 'staff'`)).length).toBeGreaterThan(0);
    expect((await as(ADMIN, `select email from public.profiles where role = 'sub'`)).length).toBeGreaterThan(0);
  });
  it('still lets people read their own profile', async () => {
    expect(await as(SUB_A, 'select id from public.profiles')).toEqual([{ id: SUB_A }]);
  });
  it('moves existing contact details over and removes the contacts with the sub', async () => {
    const r = await root(`insert into public.vendors (name) values ('Temp Sub') returning id`);
    const id = (r.rows[0] as { id: string }).id;
    await root(`insert into public.vendor_contacts (vendor_id, name) values ($1,'Temp')`, [id]);
    await root('delete from public.vendors where id = $1', [id]);
    const left = await root('select id from public.vendor_contacts where vendor_id = $1', [id]);
    expect(left.rows).toHaveLength(0);
  });
});

describe('material requests from crew', () => {
  const WORKER = '00000000-0000-0000-0000-000000000011';
  const JOB5 = '20000000-0000-0000-0000-000000000005';
  const JOB6 = '20000000-0000-0000-0000-000000000006';
  const ask = (who: string | null, job: string, name = 'Baseboard trim') =>
    as(who, `select public.request_material($1, $2, '40 ft', null, 'Short on back bedroom')`, [job, name]);
  beforeAll(async () => {
    await db.exec(`
      insert into public.team_invites (email, role) values ('worker@x.com','crew');
      insert into auth.users (id, email) values ('${WORKER}','worker@x.com');
      update public.profiles set name = 'Jordan' where id = '${WORKER}';
      insert into public.jobs (id, name) values ('${JOB5}','Worker Job'), ('${JOB6}','Not Mine');
      insert into public.tasks (job_id, name, start_date, end_date, assigned_to) values ('${JOB5}','Trim',current_date,current_date,'${WORKER}');
    `);
  });
  it('adds a request stamped with who asked, as still to order', async () => {
    await ask(WORKER, JOB5);
    const r = await root('select name, quantity, status, requested_by, requested_by_name, cost_cents from public.materials where job_id = $1', [JOB5]);
    expect(r.rows[0]).toEqual({ name: 'Baseboard trim', quantity: '40 ft', status: 'needed', requested_by: WORKER, requested_by_name: 'Jordan', cost_cents: null });
  });
  it('shows the request back to crew, without cost', async () => {
    const rows = await as<Record<string, unknown>>(WORKER, 'select * from public.crew_materials()');
    expect(rows[0].requested_by_name).toBe('Jordan');
    expect(Object.keys(rows[0])).not.toContain('cost_cents');
  });
  it('refuses a job they are not on, and a blank request', async () => {
    await expect(ask(WORKER, JOB6)).rejects.toThrow(/not one of yours/);
    await expect(ask(WORKER, JOB5, '   ')).rejects.toThrow(/Say what you need/);
  });
  it('refuses subs, no-access logins, and visitors', async () => {
    await expect(ask(SUB_A, JOB5)).rejects.toThrow(/not one of yours/);
    await expect(ask(NOBODY, JOB5)).rejects.toThrow(/not one of yours/);
    await expect(ask(null, JOB5)).rejects.toThrow();
  });
  it('still blocks crew from writing materials directly', async () => {
    await expect(as(WORKER, `insert into public.materials (job_id, name, status) values ($1,'x','arrived')`, [JOB5])).rejects.toThrow();
  });
});

describe('contractor photos', () => {
  const send = (who: string, vendor: string, extra = '', extraVal = '') =>
    as<{ id: string; review_status: string }>(who,
      `insert into public.photos (job_id, vendor_id, file_path, caption${extra}) values ($1,$2,$3,'Walls'${extraVal}) returning id, review_status`,
      [JOB, vendor, `vendor/${vendor}/p.jpg`]);
  it('starts every contractor photo as waiting for review', async () => {
    const [p] = await send(SUB_A, VA);
    expect(p.review_status).toBe('pending');
  });
  it("won't let a contractor approve their own photo, on the way in or after", async () => {
    const [p] = await send(SUB_A, VA, ', review_status', ", 'approved'");
    expect(p.review_status).toBe('pending');
    expect(await as(SUB_A, `update public.photos set review_status = 'approved' where id = $1 returning id`, [p.id])).toHaveLength(0);
    expect(await as(SUB_A, 'delete from public.photos where id = $1 returning id', [p.id])).toHaveLength(0);
  });
  it('stops a contractor posting for another sub, another folder, or a job they are not on', async () => {
    await expect(send(SUB_A, VB)).rejects.toThrow();
    await expect(as(SUB_A, `insert into public.photos (job_id, vendor_id, file_path) values ($1,$2,$3)`, [JOB, VA, `vendor/${VB}/p.jpg`])).rejects.toThrow();
    const other = await root(`insert into public.jobs (name) values ('Photo Other') returning id`);
    await expect(as(SUB_A, `insert into public.photos (job_id, vendor_id, file_path) values ($1,$2,$3)`, [(other.rows[0] as { id: string }).id, VA, `vendor/${VA}/p.jpg`])).rejects.toThrow();
  });
  it("won't attach a photo to another sub's task", async () => {
    const t = await root(`select id from public.tasks where vendor_id = $1 limit 1`, [VB]);
    const tid = (t.rows[0] as { id: string }).id;
    await expect(as(SUB_A, `insert into public.photos (job_id, vendor_id, file_path, task_id) values ($1,$2,$3,$4)`, [JOB, VA, `vendor/${VA}/p.jpg`, tid])).rejects.toThrow(/not yours/);
  });
  it('lets the office approve, stamped with who did it', async () => {
    const [p] = await send(SUB_A, VA);
    const [row] = await as<{ review_status: string; reviewed_by: string; reviewed_at: unknown }>(STAFF, `update public.photos set review_status = 'approved' where id = $1 returning *`, [p.id]);
    expect(row.review_status).toBe('approved');
    expect(row.reviewed_by).toBe(STAFF);
    expect(row.reviewed_at).toBeTruthy();
  });
  it('needs a reason to disapprove, and the contractor sees it', async () => {
    const [p] = await send(SUB_A, VA);
    await expect(as(STAFF, `update public.photos set review_status = 'rejected' where id = $1`, [p.id])).rejects.toThrow(/Say why/);
    await expect(as(STAFF, `update public.photos set review_status = 'rejected', review_note = '   ' where id = $1`, [p.id])).rejects.toThrow(/Say why/);
    await as(STAFF, `update public.photos set review_status = 'rejected', review_note = 'Too dark, retake' where id = $1`, [p.id]);
    const [mine] = await as<{ review_status: string; review_note: string }>(SUB_A, 'select review_status, review_note from public.photos where id = $1', [p.id]);
    expect(mine).toEqual({ review_status: 'rejected', review_note: 'Too dark, retake' });
  });
  it("hides a contractor's photos from other subs", async () => {
    const [p] = await send(SUB_A, VA);
    expect(await as(SUB_B, 'select id from public.photos where id = $1', [p.id])).toHaveLength(0);
  });
  it('counts office photos as approved', async () => {
    const [p] = await as<{ review_status: string }>(STAFF, `insert into public.photos (job_id, file_path) values ($1,$2) returning review_status`, [JOB, `${JOB}/x.jpg`]);
    expect(p.review_status).toBe('approved');
  });
});

describe('contact access permission', () => {
  const OFFICE = '00000000-0000-0000-0000-000000000012';
  const CREWP = '00000000-0000-0000-0000-000000000013';
  beforeAll(async () => {
    await db.exec(`
      insert into public.team_invites (email, role) values ('office@x.com','staff'), ('crewp@x.com','crew');
      insert into auth.users (id, email) values ('${OFFICE}','office@x.com'), ('${CREWP}','crewp@x.com');
    `);
    await root(`insert into public.vendor_contacts (vendor_id, name, mobile) values ($1,'Flag Test','9375550000')`, [VB]);
  });
  const count = async (who: string) => (await as(who, 'select id from public.vendor_contacts')).length;
  it('starts off, and an admin can turn it on', async () => {
    expect(await count(OFFICE)).toBe(0);
    await as(ADMIN, 'update public.profiles set can_view_contacts = true where id = $1', [OFFICE]);
    expect(await count(OFFICE)).toBeGreaterThan(0);
  });
  it('lets that person add contacts and read sub logins, but not act as an admin', async () => {
    await as(OFFICE, `insert into public.vendor_contacts (vendor_id, name) values ($1,'By Office')`, [VB]);
    expect((await as(OFFICE, `select id from public.profiles where role = 'sub'`)).length).toBeGreaterThan(0);
    await expect(as(OFFICE, `insert into public.team_invites (email, role) values ('z@x.com','admin')`)).rejects.toThrow();
    expect(await as(OFFICE, `update public.profiles set role = 'admin' where id = auth.uid() returning id`)).toHaveLength(0);
    expect(await as(OFFICE, `update public.auto_text_settings set enabled = true returning id`)).toHaveLength(0);
    expect(await as(OFFICE, 'delete from public.jobs returning id')).toHaveLength(0);
  });
  it('lets that person read text settings, but not the staff without the flag', async () => {
    expect(await as(OFFICE, 'select * from public.auto_text_settings')).toHaveLength(1);
    expect(await as(STAFF, 'select * from public.auto_text_settings')).toHaveLength(0);
    expect(await as(STAFF, 'select * from public.auto_texts')).toHaveLength(0);
  });
  it('cannot be granted to oneself', async () => {
    expect(await as(STAFF, 'update public.profiles set can_view_contacts = true where id = auth.uid() returning id')).toHaveLength(0);
    expect(await count(STAFF)).toBe(0);
  });
  it('does nothing for crew or subs, even if the flag gets set', async () => {
    await root('update public.profiles set can_view_contacts = true where id = any($1)', [[CREWP, SUB_A]]);
    expect(await count(CREWP)).toBe(0);
    expect(await count(SUB_A)).toBe(0);
    await root('update public.profiles set can_view_contacts = false where id = $1', [SUB_A]);
  });
  it('stops as soon as it is turned off', async () => {
    await as(ADMIN, 'update public.profiles set can_view_contacts = false where id = $1', [OFFICE]);
    expect(await count(OFFICE)).toBe(0);
  });
});

describe('subs asking for materials', () => {
  const ask = (who: string, job: string, name = 'Joist hangers') => as(who, `select public.request_material($1,$2,'50',null,'')`, [job, name]);
  it('adds a request under the company name on a job they work on', async () => {
    await ask(SUB_A, JOB);
    const r = await root(`select requested_by_name, status, cost_cents from public.materials where name = 'Joist hangers'`);
    expect(r.rows[0]).toEqual({ requested_by_name: 'Alpha Framing', status: 'needed', cost_cents: null });
  });
  it('refuses a job they do not work on', async () => {
    const o = await root(`insert into public.jobs (name) values ('Not Theirs') returning id`);
    await expect(ask(SUB_A, (o.rows[0] as { id: string }).id)).rejects.toThrow(/not one of yours/);
  });
  it('shows them their own requests only, with no cost', async () => {
    const rows = await as<Record<string, unknown>>(SUB_A, 'select * from public.my_material_requests()');
    expect(rows.map((r) => r.name)).toEqual(['Joist hangers']);
    expect(Object.keys(rows[0])).not.toContain('cost_cents');
    expect(await as(SUB_B, 'select * from public.my_material_requests()')).toHaveLength(0);
    await expect(as(null, 'select * from public.my_material_requests()')).rejects.toThrow();
  });
  it('still hides the job material list from them', async () => {
    expect(await as(SUB_A, 'select * from public.materials')).toHaveLength(0);
    expect(await as(SUB_A, 'select * from public.crew_materials()')).toHaveLength(0);
  });
});

describe('automatic text controls', () => {
  it('installs switched off', async () => {
    const r = await root('select enabled from public.auto_text_settings');
    expect(r.rows).toEqual([{ enabled: false }]);
  });
  it('only an admin can change settings', async () => {
    for (const who of [STAFF, SUB_A, NOBODY]) {
      expect(await as(who, 'update public.auto_text_settings set enabled = true returning id'), who).toHaveLength(0);
    }
    const r = await root('select enabled from public.auto_text_settings');
    expect(r.rows).toEqual([{ enabled: false }]);
  });
  it('nobody can write the sent log from the app, not even an admin', async () => {
    await expect(as(ADMIN, `insert into public.auto_texts (kind, start_date, status) values ('notice', current_date, 'accepted')`)).rejects.toThrow();
  });
  it('refuses a second accepted copy of the same text', async () => {
    const t = await root(`select id, job_id, vendor_id, start_date from public.tasks where vendor_id is not null limit 1`);
    const x = t.rows[0] as { id: string; job_id: string; vendor_id: string; start_date: string };
    const ins = () => root(`insert into public.auto_texts (task_id, job_id, vendor_id, kind, start_date, status) values ($1,$2,$3,'notice',$4,'accepted')`, [x.id, x.job_id, x.vendor_id, x.start_date]);
    await ins();
    await expect(ins()).rejects.toThrow();
    await root(`insert into public.auto_texts (task_id, job_id, vendor_id, kind, start_date, status) values ($1,$2,$3,'notice',$4,'failed')`, [x.id, x.job_id, x.vendor_id, x.start_date]);
    await root('delete from public.auto_texts');
  });
});

describe('estimates and expenses', () => {
  const OFFICE2 = '00000000-0000-0000-0000-000000000014';
  const CREW3 = '00000000-0000-0000-0000-000000000015';
  let est: string;
  beforeAll(async () => {
    await db.exec(`
      insert into public.team_invites (email, role) values ('office2@x.com','staff'), ('crew3@x.com','crew');
      insert into auth.users (id, email) values ('${OFFICE2}','office2@x.com'), ('${CREW3}','crew3@x.com');
      update public.profiles set can_view_contacts = true where id = '${OFFICE2}';
      update public.markup_defaults set profit_pct = 12, overhead_pct = 8;
    `);
    const [e] = await as<{ id: string }>(STAFF, `insert into public.estimates (client_name, address, custom_lines, line_edits)
      values ('100 Sample Rd - Concrete', '100 Sample Rd', '[{"key":"c.concrete","division":"Foundation","name":"Concrete","unit":"lump sum","qty":1,"catalogItemId":null}]', '{"c.concrete":{"materialUnit":3000,"laborUnit":0}}') returning id`);
    est = e.id;
  });
  it('lets staff create and edit estimates and line items', async () => {
    expect(await as(STAFF, `update public.estimates set notes = 'pour Friday' where id = $1 returning id`, [est])).toHaveLength(1);
    const [row] = await as<{ custom_lines: unknown[]; line_edits: Record<string, unknown> }>(STAFF, 'select custom_lines, line_edits from public.estimates where id = $1', [est]);
    expect(row.custom_lines).toHaveLength(1);
    expect(row.line_edits).toEqual({ 'c.concrete': { materialUnit: 3000, laborUnit: 0 } });
  });
  it('gives every new estimate the default markups, visible to admins only', async () => {
    const [m] = await as<{ profit_pct: string; overhead_pct: string }>(ADMIN, 'select profit_pct, overhead_pct from public.estimate_markups where estimate_id = $1', [est]);
    expect(Number(m.profit_pct)).toBe(12);
    expect(Number(m.overhead_pct)).toBe(8);
  });
  it('hides markups, profit, defaults, and saved versions from staff, even with contact access', async () => {
    await as(ADMIN, `insert into public.estimate_versions (estimate_id, label, data) values ($1, 'Sent to client', '{"markups":{"profitAmount":4900}}')`, [est]);
    for (const who of [STAFF, OFFICE2]) {
      for (const t of ['estimate_markups', 'markup_defaults', 'estimate_versions']) {
        expect(await as(who, `select * from public.${t}`), `${who} ${t}`).toHaveLength(0);
      }
      expect(await as(who, `update public.estimate_markups set profit_amount = 1 returning estimate_id`)).toHaveLength(0);
      await expect(as(who, `insert into public.estimate_versions (estimate_id, data) values ($1, '{}')`, [est])).rejects.toThrow();
    }
  });
  it('lets admins set a flat dollar profit and save versions', async () => {
    const [m] = await as<{ profit_amount: string }>(ADMIN, `update public.estimate_markups set profit_amount = 4900 where estimate_id = $1 returning profit_amount`, [est]);
    expect(Number(m.profit_amount)).toBe(4900);
    expect((await as(ADMIN, 'select * from public.estimate_versions')).length).toBeGreaterThan(0);
  });
  it('keeps crew, subs, no-access logins, and visitors out of all of it', async () => {
    for (const t of ['estimates', 'estimate_markups', 'estimate_versions', 'markup_defaults', 'catalog_items', 'company_settings', 'expenses']) {
      for (const who of [CREW3, SUB_A, NOBODY]) expect(await as(who, `select * from public.${t}`), `${who} ${t}`).toHaveLength(0);
      await expect(as(null, `select * from public.${t}`), t).rejects.toThrow();
    }
    await expect(as(CREW3, `insert into public.estimates (client_name) values ('x')`)).rejects.toThrow();
    await expect(as(SUB_A, `insert into public.expenses (job_id, amount_cents) values ($1, 100)`, [JOB])).rejects.toThrow();
  });
  it('lets only admins delete an estimate, and its markups and versions go with it', async () => {
    expect(await as(STAFF, 'delete from public.estimates where id = $1 returning id', [est])).toHaveLength(0);
    const [tmp] = await as<{ id: string }>(STAFF, `insert into public.estimates (client_name) values ('Temp') returning id`);
    await as(ADMIN, 'delete from public.estimates where id = $1', [tmp.id]);
    const left = await root('select count(*)::int n from public.estimate_markups where estimate_id = $1', [tmp.id]);
    expect((left.rows[0] as { n: number }).n).toBe(0);
  });
  it('lets staff read company details for quotes, but only admins change them', async () => {
    expect(await as(STAFF, 'select name from public.company_settings')).toHaveLength(1);
    expect(await as(STAFF, `update public.company_settings set name = 'x' returning id`)).toHaveLength(0);
    expect(await as(ADMIN, `update public.company_settings set name = 'H3' returning id`)).toHaveLength(1);
  });
  it('keeps catalog prices exactly as typed, with no rounding', async () => {
    const [c] = await as<{ unit_cost: string }>(STAFF, `insert into public.catalog_items (id, division, name, unit, unit_cost) values ('site.driveway','Site','Driveway','sqft', 2.875) returning unit_cost`);
    expect(c.unit_cost).toBe('2.875');
  });
  it('records expenses in cents and keeps them on their own job', async () => {
    const [x] = await as<{ amount_cents: string }>(STAFF, `insert into public.expenses (job_id, vendor_name, description, amount_cents) values ($1,'Home Depot','Rebar',12345) returning amount_cents`, [JOB]);
    expect(Number(x.amount_cents)).toBe(12345);
    await expect(as(STAFF, `insert into public.expenses (job_id, budget_line_id, amount_cents) values ($1,$2,100)`, [JOB, LINE2])).rejects.toThrow(/different job/);
    await expect(as(STAFF, `insert into public.expenses (job_id, amount_cents) values ($1, 0)`, [JOB])).rejects.toThrow();
  });
  it('refuses to import the same Estimator record twice', async () => {
    await as(STAFF, `insert into public.estimates (legacy_id, client_name) values ('stone-rd','A')`);
    await expect(as(STAFF, `insert into public.estimates (legacy_id, client_name) values ('stone-rd','B')`)).rejects.toThrow();
  });
  it('links a won estimate to its job, and keeps the estimate if the job is deleted', async () => {
    const j = await root(`insert into public.jobs (name) values ('From estimate') returning id`);
    const jobId = (j.rows[0] as { id: string }).id;
    await as(STAFF, `update public.estimates set status = 'won', job_id = $2 where id = $1`, [est, jobId]);
    await as(ADMIN, 'delete from public.jobs where id = $1', [jobId]);
    const [row] = await as<{ job_id: string | null; status: string }>(STAFF, 'select job_id, status from public.estimates where id = $1', [est]);
    expect(row).toEqual({ job_id: null, status: 'won' });
  });
});

describe('job types', () => {
  it('accepts every type and a note, and refuses unknown ones', async () => {
    for (const t of ['spec', 'client', 'flip', 'remodel', 'addition', 'repair', 'other']) {
      await as(STAFF, `insert into public.jobs (name, job_type, type_note) values ($1, $2, 'Deck')`, [`T ${t}`, t]);
    }
    await expect(as(STAFF, `insert into public.jobs (name, job_type) values ('Bad', 'nonsense')`)).rejects.toThrow();
    await root(`delete from public.jobs where name like 'T %'`);
  });
});

describe('job record', () => {
  const seedRecord = async () => {
    await as(STAFF, `insert into public.selections (job_id, category, color_name, color_code) values ($1,'Paint','Alabaster','SW-7008')`, [JOB]);
    await as(STAFF, `insert into public.documents (job_id, category, title, file_path) values ($1,'Drawings','Plans',$2)`, [JOB, `${JOB}/plans.pdf`]);
    await as(STAFF, `insert into public.job_steps (job_id, step, other_name) values ($1,'Painting','Old Crew')`, [JOB]);
  };
  it('lets staff read and write it', async () => {
    await seedRecord();
    for (const t of ['selections', 'documents', 'job_steps']) {
      expect((await as(STAFF, `select * from public.${t}`)).length, t).toBeGreaterThan(0);
    }
  });
  it('hides it from subs, no-access logins, and visitors', async () => {
    for (const t of ['selections', 'documents', 'job_steps']) {
      expect(await as(SUB_A, `select * from public.${t}`), t).toHaveLength(0);
      expect(await as(NOBODY, `select * from public.${t}`), t).toHaveLength(0);
      await expect(as(null, `select * from public.${t}`), t).rejects.toThrow();
    }
  });
  it('stops subs writing to it', async () => {
    await expect(as(SUB_A, `insert into public.selections (job_id, item) values ($1,'x')`, [JOB])).rejects.toThrow();
    await expect(as(SUB_A, `insert into public.documents (job_id, title, file_path) values ($1,'x','y')`, [JOB])).rejects.toThrow();
    await expect(as(SUB_A, `insert into public.job_steps (job_id, step) values ($1,'x')`, [JOB])).rejects.toThrow();
    expect(await as(SUB_A, `update public.selections set item = 'x' returning id`)).toHaveLength(0);
    expect(await as(SUB_A, `delete from public.documents returning id`)).toHaveLength(0);
  });
  it('keeps client details and job facts away from subs', async () => {
    await root(`update public.jobs set client_name = 'Secret Client', client_phone = '555', square_feet = 2000 where id = $1`, [JOB]);
    expect(await as(SUB_A, 'select client_name from public.jobs')).toHaveLength(0);
    const [row] = await as<Record<string, unknown>>(SUB_A, 'select * from public.my_jobs()');
    expect(Object.keys(row).sort()).toEqual(['address', 'id', 'name']);
  });
  it('blocks subs from drawing files in the job folder', async () => {
    await as(STAFF, `insert into storage.objects (bucket_id, name) values ('job-files', $1)`, [`${JOB}/drawing-a.pdf`]);
    const rows = await as<{ name: string }>(SUB_A, 'select name from storage.objects');
    expect(rows.every((r) => r.name.startsWith(`vendor/${VA}/`))).toBe(true);
  });
  it('removes the record with the job and keeps it when a sub is deleted', async () => {
    const r = await root(`insert into public.vendors (name) values ('Gone Sub') returning id`);
    const gone = (r.rows[0] as { id: string }).id;
    const [s] = await as<{ id: string }>(STAFF, `insert into public.job_steps (job_id, step, vendor_id) values ($1,'Trim',$2) returning id`, [JOB, gone]);
    await as(ADMIN, 'delete from public.vendors where id = $1', [gone]);
    const [row] = await as<{ step: string; vendor_id: string | null }>(STAFF, 'select step, vendor_id from public.job_steps where id = $1', [s.id]);
    expect(row).toEqual({ step: 'Trim', vendor_id: null });
  });
  it('opens the file types drawings come in', async () => {
    const r = await root(`select file_size_limit, allowed_mime_types from storage.buckets where id = 'job-files'`);
    const b = r.rows[0] as { file_size_limit: number; allowed_mime_types: string[] };
    expect(Number(b.file_size_limit)).toBe(52428800);
    expect(b.allowed_mime_types).toEqual(expect.arrayContaining(['application/pdf', 'image/vnd.dwg', 'application/octet-stream']));
    expect(b.allowed_mime_types).not.toContain('text/html');
  });
});

describe('deleting', () => {
  it('lets only an admin delete a job', async () => {
    expect(await as(STAFF, 'delete from public.jobs where id = $1 returning id', [JOB2])).toHaveLength(0);
    expect(await as(ADMIN, 'delete from public.jobs where id = $1 returning id', [JOB2])).toHaveLength(1);
  });
});
