import { createClient } from '@supabase/supabase-js';
import type { Material, MaterialRequest, Profile, SubJob, TableName } from '../domain/types';
import { rowKey, type Store } from './store';

const PAGE = 1000;

export function makeSupabaseStore(url: string, key: string): Store {
  const sb = createClient(url, key);
  const check = <T>(r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  const keyOf = rowKey;

  return {
    mode: 'supabase',
    async me() {
      const { data } = await sb.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return null;
      return check(await sb.from('profiles').select('*').eq('id', uid).single()) as Profile;
    },
    onAuthChange(cb) {
      sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(cb, 0);
      });
    },
    async signIn(email) {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
      });
      if (error) {
        if (/signups? not allowed|otp_disabled/i.test(error.message)) throw new Error("This email hasn't been invited yet. Ask the owner to invite you.");
        throw new Error(error.message);
      }
      return 'Check your email for the sign-in code.';
    },
    async verifyCode(email, code) {
      const { error } = await sb.auth.verifyOtp({ email, token: code.replace(/\D/g, ''), type: 'email' });
      if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Ask for a new one.' : error.message);
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async list(table) {
      // The API caps each response at 1,000 rows, so keep reading until a short page.
      const all: unknown[] = [];
      for (let from = 0; ; from += PAGE) {
        const rows = check(
          await sb.from(table).select('*').order(keyOf(table)).range(from, from + PAGE - 1),
        ) as unknown[];
        all.push(...rows);
        if (rows.length < PAGE) return all as never;
      }
    },
    async insert(table, rows) {
      check(await sb.from(table).insert(rows as never));
    },
    async update(table, id, patch) {
      const rows = check(await sb.from(table).update(patch as never).eq(keyOf(table), id).select(keyOf(table))) as unknown[];
      if (!rows.length) throw new Error('You do not have permission to change this record.');
    },
    async remove(table, id) {
      const rows = check(await sb.from(table).delete().eq(keyOf(table), id).select(keyOf(table))) as unknown[];
      if (!rows.length) throw new Error('You do not have permission to delete this record.');
    },
    async myJobs() {
      return check(await sb.rpc('my_jobs')) as SubJob[];
    },
    async respondPo(id, accept) {
      check(await sb.rpc('respond_po', { p_po: id, p_accept: accept }));
    },
    async submitWaiver(id, path) {
      check(await sb.rpc('submit_waiver', { p_waiver: id, p_path: path }));
    },
    async setTaskStatus(id, status) {
      check(await sb.rpc('set_task_status', { p_task: id, p_status: status }));
    },
    async crewMaterials() {
      return check(await sb.rpc('crew_materials')) as Material[];
    },
    async markMaterialArrived(id) {
      check(await sb.rpc('mark_material_arrived', { p_material: id }));
    },
    async requestMaterial(job, name, quantity, neededBy, notes) {
      check(await sb.rpc('request_material', { p_job: job, p_name: name, p_quantity: quantity, p_needed_by: neededBy, p_notes: notes }));
    },
    async myMaterialRequests() {
      return check(await sb.rpc('my_material_requests')) as MaterialRequest[];
    },
    async inviteUser(email) {
      const { error, response } = await sb.functions.invoke('invite-user', { body: { email, redirect: window.location.origin + import.meta.env.BASE_URL } }) as { error: Error | null; response?: Response };
      if (error) {
        const detail = await response?.clone().json().catch(() => null);
        throw new Error(detail?.error ?? 'The invite could not be sent. Try again from the Team page.');
      }
    },
    async confirmTask(id) {
      check(await sb.rpc('confirm_task', { p_task: id }));
    },
    async upload(path, file) {
      const { error } = await sb.storage.from('job-files').upload(path, file);
      if (error) throw new Error(error.message);
      return path;
    },
    async removeFile(path) {
      const { error } = await sb.storage.from('job-files').remove([path]);
      if (error) throw new Error(error.message);
    },
    async fileUrl(path) {
      const { data, error } = await sb.storage.from('job-files').createSignedUrl(path, 300);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
  };
}
