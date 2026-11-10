// Admin-only. Creates a ready-to-use login for an email already allowed in team_invites, and emails a sign-in link.
// The login is confirmed up front, so a late or lost invite never locks anyone out: they can ask for a new link any time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return reply(401, { error: 'Sign in first.' });
  const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).single();
  if (me?.role !== 'admin') return reply(403, { error: 'Only an admin can invite people.' });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const { data: allowed } = await admin.from('team_invites').select('email').eq('email', email).maybeSingle();
  if (!allowed) return reply(400, { error: 'Allow this email first.' });

  const { error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (createError) {
    const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
    if (!existing) return reply(500, { error: createError.message });
    const { error: confirmError } = await admin.auth.admin.updateUserById(existing.id, { email_confirm: true });
    if (confirmError) return reply(500, { error: confirmError.message });
  }

  const publicClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { error: mailError } = await publicClient.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: typeof body.redirect === 'string' ? body.redirect : undefined },
  });
  if (mailError) return reply(502, { error: `Their login is ready, but the email failed: ${mailError.message}` });
  return reply(200, { ok: true });
});
