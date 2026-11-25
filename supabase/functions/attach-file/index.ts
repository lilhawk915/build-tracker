// Puts a file (a quote, estimate PDF, plan, contract...) into a job's Files, from Ryan's Mac.
// Locked: only a request carrying the secret token is accepted. The token itself lives only in
// ~/.config/build-tracker/attach-token on Ryan's Mac. This file holds just its SHA-256 fingerprint,
// which can't be turned back into the token. To change the token, make a new one and update TOKEN_SHA256.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const CATEGORIES = ['Drawings', 'Engineering', 'Permits and inspections', 'Contracts', 'Estimates and bids', 'Invoices',
  'Warranties and manuals', 'Closing documents', 'Other'];
const TYPES: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', webp: 'image/webp',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip', dwg: 'image/vnd.dwg', dxf: 'image/vnd.dxf',
  doc: 'application/msword', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const MAX_BYTES = 50 * 1024 * 1024;
const TOKEN_SHA256 = 'ecbf86dae3bf9b2909615215722f1ca2d591bd9c1a651610fd4ea7a75b140993';

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares without leaking how much of the token matched. */
function same(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const safeName = (n: string) => n.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-120);

Deno.serve(async (req) => {
  const given = req.headers.get('x-attach-token') ?? '';
  if (given.length < 32 || !same(await sha256(given), TOKEN_SHA256)) return reply(401, { error: 'Not allowed.' });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // GET .../attach-file/jobs: job ids and names, so the Mac script can find a job by name.
  if (req.method === 'GET' && new URL(req.url).pathname.endsWith('/jobs')) {
    const { data, error } = await admin.from('jobs').select('id, name, status').order('name');
    return error ? reply(500, { error: error.message }) : reply(200, data);
  }
  if (req.method !== 'POST') return reply(405, { error: 'POST only.' });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) return reply(400, { error: 'Send the file as "file".' });
  const jobId = String(form.get('job_id') ?? '');
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = TYPES[ext];
  if (!type) return reply(400, { error: `.${ext} files aren't allowed.` });
  if (file.size === 0 || file.size > MAX_BYTES) return reply(400, { error: 'File is empty or over 50 MB.' });
  const category = String(form.get('category') ?? 'Other');
  if (!CATEGORIES.includes(category)) return reply(400, { error: `Category must be one of: ${CATEGORIES.join(', ')}.` });
  const docDate = String(form.get('doc_date') ?? '');
  if (docDate && !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) return reply(400, { error: 'doc_date must look like 2026-11-15.' });

  const { data: job } = await admin.from('jobs').select('id, name').eq('id', jobId).maybeSingle();
  if (!job) return reply(404, { error: 'No job with that id.' });

  const path = `${job.id}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const up = await admin.storage.from('job-files').upload(path, file, { contentType: type });
  if (up.error) return reply(500, { error: up.error.message });
  const { data: doc, error } = await admin.from('documents').insert({
    job_id: job.id, category, file_path: path, file_name: file.name,
    title: String(form.get('title') ?? '') || file.name.replace(/\.[^.]+$/, ''),
    revision: String(form.get('revision') ?? ''), doc_date: docDate || null, notes: String(form.get('notes') ?? ''),
  }).select('id, title').single();
  if (error) {
    await admin.storage.from('job-files').remove([path]);
    return reply(500, { error: error.message });
  }
  return reply(200, { job: job.name, document: doc });
});
