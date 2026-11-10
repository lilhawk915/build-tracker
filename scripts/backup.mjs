// Copies the whole Build Tracker (database and every uploaded file) into a dated folder.
// Usage: node scripts/backup.mjs <settings-file>
// The settings file holds BT_DB_URL, BT_SUPABASE_URL, BT_SERVICE_KEY, BT_BACKUP_DIR. Keep it private (chmod 600).
// Only reads from the app. It never changes anything there.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupName, backupsToKeep, encodePath } from './backup-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const settingsFile = process.argv[2];
if (!settingsFile) throw new Error('Usage: node scripts/backup.mjs <settings-file>');
const cfg = Object.fromEntries(readFileSync(settingsFile, 'utf8').split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
for (const k of ['BT_DB_URL', 'BT_SUPABASE_URL', 'BT_SERVICE_KEY', 'BT_BACKUP_DIR']) if (!cfg[k]) throw new Error(`${k} is missing from ${settingsFile}`);
const PG_BIN = cfg.BT_PG_BIN ?? '/opt/homebrew/opt/libpq/bin';
const root = cfg.BT_BACKUP_DIR;
const name = backupName();
const partial = join(root, `${name}.partial`);
const finalDir = join(root, name);
const statusFile = join(root, 'LAST-RUN.txt');
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

async function main() {
  mkdirSync(root, { recursive: true });
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(join(partial, 'files'), { recursive: true });

  // 1. Database: every app table plus logins. Data only; the table layout is in the migrations copied below.
  const tables = ['public.*', 'auth.users', 'auth.identities'];
  execFileSync(join(PG_BIN, 'pg_dump'), [
    '--data-only', '--format=custom', '--no-owner', '--no-privileges',
    ...tables.flatMap((t) => ['--table', t]),
    '--file', join(partial, 'database.dump'), cfg.BT_DB_URL,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const counts = execFileSync(join(PG_BIN, 'psql'), [cfg.BT_DB_URL, '-At', '-c',
    `select string_agg(format('%s=%s', relname, n_live_tup), ',' order by relname) from pg_stat_user_tables where schemaname = 'public'`]).toString().trim();
  log(`database saved`);

  // 2. The table layout, so a backup can rebuild an empty system on its own.
  cpSync(join(here, '..', 'supabase', 'migrations'), join(partial, 'migrations'), { recursive: true });

  // 3. Every uploaded file. Unchanged files are linked to the last backup instead of copied again.
  const headers = { apikey: cfg.BT_SERVICE_KEY, Authorization: `Bearer ${cfg.BT_SERVICE_KEY}` };
  const previous = readdirSync(root).filter((n) => /^\d{4}-\d{2}-\d{2}T\d{4}$/.test(n)).sort().pop();
  const prevManifest = previous && existsSync(join(root, previous, 'manifest.json'))
    ? JSON.parse(readFileSync(join(root, previous, 'manifest.json'), 'utf8')).files : {};
  const files = {};
  async function walk(prefix) {
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(`${cfg.BT_SUPABASE_URL}/storage/v1/object/list/job-files`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!res.ok) throw new Error(`Listing files failed: ${res.status} ${await res.text()}`);
      const items = await res.json();
      for (const it of items) {
        const path = prefix ? `${prefix}/${it.name}` : it.name;
        if (it.id === null) await walk(path);
        else files[path] = { etag: it.metadata?.eTag ?? '', size: it.metadata?.size ?? 0, type: it.metadata?.mimetype ?? '' };
      }
      if (items.length < 1000) return;
    }
  }
  await walk('');
  let copied = 0;
  let linked = 0;
  for (const [path, meta] of Object.entries(files)) {
    const dest = join(partial, 'files', path);
    mkdirSync(dirname(dest), { recursive: true });
    const old = prevManifest[path];
    const oldFile = previous && join(root, previous, 'files', path);
    if (old && old.etag && old.etag === meta.etag && existsSync(oldFile)) {
      linkSync(oldFile, dest);
      meta.sha256 = old.sha256;
      linked++;
      continue;
    }
    const res = await fetch(`${cfg.BT_SUPABASE_URL}/storage/v1/object/job-files/${encodePath(path)}`, { headers });
    if (!res.ok) throw new Error(`Downloading ${path} failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    meta.sha256 = createHash('sha256').update(buf).digest('hex');
    copied++;
  }
  log(`files saved: ${copied} downloaded, ${linked} unchanged`);

  writeFileSync(join(partial, 'manifest.json'), JSON.stringify({ created: new Date().toISOString(), tables: counts, files }, null, 2));
  renameSync(partial, finalDir);

  // 4. Only after a complete backup, clear out old ones.
  const keep = backupsToKeep(readdirSync(root));
  for (const n of readdirSync(root)) {
    if (/^\d{4}-\d{2}-\d{2}T\d{4}$/.test(n) && !keep.has(n)) rmSync(join(root, n), { recursive: true, force: true });
  }
  const size = execFileSync('du', ['-sh', root]).toString().split('\t')[0];
  writeFileSync(statusFile, `OK ${new Date().toISOString()} ${name} (${Object.keys(files).length} files, all backups ${size})\n`);
  log(`backup ${name} complete`);
}

main().catch((e) => {
  rmSync(partial, { recursive: true, force: true });
  try { writeFileSync(statusFile, `FAILED ${new Date().toISOString()} ${e.message}\n`); } catch { /* backup folder unreachable */ }
  console.error(`BACKUP FAILED: ${e.message}`);
  process.exit(1);
});
