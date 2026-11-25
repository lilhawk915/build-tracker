// Puts files into a job's Files on the live site.
//   node scripts/attach-file.mjs --job "Lewis Lane 1" --category "Estimates and bids" [--title "..."] [--date 2026-11-15] [--notes "..."] file.pdf [more files]
// --job matches a job name (exact, or the only one containing the words). Needs the secret in
// ~/.config/build-tracker/attach-token (never commit it). Reads the live site's public URL and anon key from .env.pages.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const env = Object.fromEntries(readFileSync(new URL('../.env.pages', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const url = env.VITE_SUPABASE_URL;
const anon = env.VITE_SUPABASE_ANON_KEY;
const token = readFileSync(join(homedir(), '.config/build-tracker/attach-token'), 'utf8').trim();

const args = process.argv.slice(2);
const opt = {};
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else files.push(args[i]);
}
if (!opt.job || !files.length) {
  console.error('Usage: node scripts/attach-file.mjs --job "<job name>" --category "<category>" file.pdf ...');
  process.exit(1);
}

// Job names need a login to read, so the locked function lists them.
const res = await fetch(`${url}/functions/v1/attach-file/jobs`, { headers: { Authorization: `Bearer ${anon}`, 'x-attach-token': token } });
const jobs = res.ok ? await res.json() : null;
if (!jobs) { console.error('Could not list jobs:', res.status, await res.text()); process.exit(1); }
const want = opt.job.toLowerCase();
const exact = jobs.filter((j) => j.name.toLowerCase() === want);
const loose = jobs.filter((j) => want.split(/\s+/).every((w) => j.name.toLowerCase().includes(w)));
const match = exact.length === 1 ? exact : loose;
if (match.length !== 1) {
  console.error(match.length ? `"${opt.job}" matches more than one job: ${match.map((j) => j.name).join('; ')}` : `No job matches "${opt.job}".`);
  process.exit(1);
}
const job = match[0];

for (const path of files) {
  const form = new FormData();
  form.set('job_id', job.id);
  form.set('category', opt.category ?? 'Other');
  if (opt.title && files.length === 1) form.set('title', opt.title);
  if (opt.date) form.set('doc_date', opt.date);
  if (opt.notes) form.set('notes', opt.notes);
  form.set('file', new Blob([readFileSync(path)]), basename(path));
  const r = await fetch(`${url}/functions/v1/attach-file`, { method: 'POST', headers: { Authorization: `Bearer ${anon}`, 'x-attach-token': token }, body: form });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`${basename(path)}: ${out.error ?? r.status}`); process.exitCode = 1; continue; }
  console.log(`${basename(path)} -> ${out.job}: "${out.document.title}"`);
}
