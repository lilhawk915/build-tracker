// Runs on a schedule once someone sets one up. Does nothing until AUTO_TEXTS_LIVE=1 AND the app setting is on.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { kixieRequest, runAutoTexts, type PlannedText } from '../_shared/autotext.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(async (req) => {
  if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET')) {
    return new Response(JSON.stringify({ error: 'Not allowed.' }), { status: 401 });
  }
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const rows = async (table: string) => {
    const { data, error } = await db.from(table).select('*');
    if (error) throw new Error(`${table}: ${error.message}`);
    return data ?? [];
  };
  const cfg = {
    url: env('KIXIE_URL') || 'https://apig.kixie.com/app/event',
    apiKey: env('KIXIE_API_KEY'), businessId: env('KIXIE_BUSINESS_ID'), senderEmail: env('KIXIE_SENDER_EMAIL'),
  };
  const result = await runAutoTexts({
    live: env('AUTO_TEXTS_LIVE') === '1' && Boolean(cfg.apiKey),
    // Lets a local test pick the clock. Never set this on a real server.
    now: env('AUTO_TEXTS_TEST_NOW') ? new Date(env('AUTO_TEXTS_TEST_NOW')) : new Date(),
    load: async () => {
      const [settings, tasks, jobs, vendors, contacts, log] = await Promise.all([
        rows('auto_text_settings'), rows('tasks'), rows('jobs'), rows('vendors'), rows('vendor_contacts'), rows('auto_texts'),
      ]);
      return { settings: settings[0], tasks, jobs, vendors, contacts, log };
    },
    send: async (phone, body) => {
      const { url, init } = kixieRequest(cfg, phone, body);
      const res = await fetch(url, init);
      const text = await res.text();
      if (!res.ok || !/"success"\s*:\s*true/.test(text)) throw new Error(`Kixie said ${res.status}: ${text.slice(0, 200)}`);
    },
    record: async (p: PlannedText, status, error) => {
      const { error: e } = await db.from('auto_texts').insert({
        task_id: p.taskId, job_id: p.jobId, vendor_id: p.vendorId, kind: p.kind, start_date: p.startDate,
        recipient: p.recipient, phone: p.phone, body: p.body, status, error,
      });
      if (e) throw new Error(e.message);
      if (status === 'accepted') {
        await db.from('tasks').update({ contact_status: 'contacted' }).eq('id', p.taskId).eq('contact_status', 'not_contacted');
        await db.from('notifications').insert({ job_id: p.jobId, task_id: p.taskId, recipient: p.recipient, channel: 'text', body: p.body });
      }
    },
  });
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
});
