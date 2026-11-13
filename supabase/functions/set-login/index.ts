// Admin-only. Gives someone a username and password, making their login if they don't have one yet.
// Their email must already be allowed on the Team page. Nothing is emailed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return reply(401, { error: 'Sign in first.' });
  const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).single();
  if (me?.role !== 'admin') return reply(403, { error: 'Only an admin can set logins.' });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const username = String(body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!/^[a-z0-9._-]{2,30}$/.test(username)) return reply(400, { error: 'Usernames are 2 to 30 letters or numbers, no spaces.' });
  if (password.length < 8) return reply(400, { error: 'Passwords need at least 8 characters.' });
  const { data: allowed } = await admin.from('team_invites').select('email').eq('email', email).maybeSingle();
  const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (!allowed && !existing) return reply(400, { error: 'Allow this email on the Team page first.' });
  const { data: taken } = await admin.from('profiles').select('id, email').eq('username', username).maybeSingle();
  if (taken && taken.email !== email) return reply(400, { error: `The username "${username}" is taken. Pick another.` });

  let id = existing?.id as string | undefined;
  if (id) {
    const { error } = await admin.auth.admin.updateUserById(id, { password, email_confirm: true });
    if (error) return reply(500, { error: error.message });
  } else {
    const { data: made, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !made.user) return reply(500, { error: error?.message ?? 'Could not make the login.' });
    id = made.user.id;
  }
  const { error: nameError } = await admin.from('profiles').update({ username }).eq('id', id);
  if (nameError) return reply(500, { error: nameError.message });
  return reply(200, { ok: true });
});
