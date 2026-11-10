// Puts a backup back into a Build Tracker system. REPLACES all data and files there.
// Usage: node scripts/restore.mjs <backup-folder> <settings-file> --yes-replace=<host of BT_SUPABASE_URL>
// The target must already have the tables (run the migrations in the backup's migrations folder first).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePath } from './backup-lib.mjs';

const [dir, settingsFile, confirm] = process.argv.slice(2);
if (!dir || !settingsFile) throw new Error('Usage: node scripts/restore.mjs <backup-folder> <settings-file> --yes-replace=<host>');
const cfg = Object.fromEntries(readFileSync(settingsFile, 'utf8').split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const host = new URL(cfg.BT_SUPABASE_URL).host;
if (confirm !== `--yes-replace=${host}`) throw new Error(`This replaces everything on ${host}. Add --yes-replace=${host} to go ahead.`);
const PG_BIN = cfg.BT_PG_BIN ?? '/opt/homebrew/opt/libpq/bin';
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const psql = (sql) => execFileSync(join(PG_BIN, 'psql'), [cfg.BT_DB_URL, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql]).toString().trim();

// 1. Empty the app tables and logins, then load the backup with triggers paused, so nothing is created twice.
const tables = psql(`select string_agg(format('public.%I', tablename), ', ') from pg_tables where schemaname = 'public'`);
psql(`set client_min_messages = warning; truncate ${tables}, auth.identities, auth.users cascade`);
// Triggers are paused inside the session, since hosted databases refuse it as a connection option.
const data = execFileSync(join(PG_BIN, 'pg_restore'), ['--data-only', '--no-owner', '--no-privileges', '--file', '-', join(dir, 'database.dump')], { maxBuffer: 1 << 30 });
execFileSync(join(PG_BIN, 'psql'), [cfg.BT_DB_URL, '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction'], {
  input: Buffer.concat([Buffer.from('set session_replication_role = replica;\n'), data]),
  stdio: ['pipe', 'ignore', 'inherit'], maxBuffer: 1 << 30,
});
console.log('database restored');

// 2. Put every file back and check it matches what was saved.
const headers = { apikey: cfg.BT_SERVICE_KEY, Authorization: `Bearer ${cfg.BT_SERVICE_KEY}` };
let bad = 0;
for (const [path, meta] of Object.entries(manifest.files)) {
  const buf = readFileSync(join(dir, 'files', path));
  if (createHash('sha256').update(buf).digest('hex') !== meta.sha256) { console.error(`Damaged in backup: ${path}`); bad++; continue; }
  const res = await fetch(`${cfg.BT_SUPABASE_URL}/storage/v1/object/job-files/${encodePath(path)}`, {
    method: 'POST', headers: { ...headers, 'x-upsert': 'true', 'Content-Type': meta.type || 'application/octet-stream' }, body: buf,
  });
  if (!res.ok) { console.error(`Upload failed: ${path} ${res.status} ${await res.text()}`); bad++; }
}
console.log(`files restored: ${Object.keys(manifest.files).length - bad} of ${Object.keys(manifest.files).length}`);
if (bad) process.exit(1);
