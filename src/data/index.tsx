import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { canSeeContacts, type MaterialRequest, type Profile, type SubJob, type Tables } from '../domain/types';
import { localStore } from './localStore';
import type { Store } from './store';
import { makeSupabaseStore } from './supabaseStore';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const store: Store = url && key ? makeSupabaseStore(url, key) : localStore;

export type Data = { [K in keyof Tables]: Tables[K][] } & { subJobs: SubJob[]; myRequests: MaterialRequest[] };

const EMPTY: Data = {
  vendors: [], profiles: [], team_invites: [], jobs: [], budget_lines: [], pos: [], bills: [], change_orders: [],
  draws: [], draw_lines: [], lien_waivers: [], tasks: [], daily_logs: [], photos: [], selections: [], documents: [], job_steps: [], scope_items: [], materials: [], notifications: [], vendor_contacts: [], auto_text_settings: [], auto_texts: [], subJobs: [], myRequests: [],
};

interface Ctx {
  me: Profile;
  data: Data;
  loading: boolean;
  loadError: string;
  reload: () => Promise<void>;
  run: (work: () => Promise<unknown>, done?: string) => Promise<boolean>;
  toast: { kind: 'ok' | 'err'; text: string } | null;
  clearToast: () => void;
}

const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({ me, children }: { me: Profile; children: ReactNode }) {
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState<Ctx['toast']>(null);

  const reload = useCallback(async () => {
    try {
      const staff = me.role === 'admin' || me.role === 'staff';
      const crew = me.role === 'crew';
      const contacts = canSeeContacts(me);
      const [vendors, profiles, team_invites, jobs, budget_lines, pos, bills, change_orders, draws, draw_lines, lien_waivers, tasks, daily_logs, photos, selections, documents, job_steps, scope_items, materials, notifications, vendor_contacts, auto_text_settings, auto_texts, subJobs, myRequests] =
        await Promise.all([
          store.list('vendors'),
          store.list('profiles'),
          me.role === 'admin' ? store.list('team_invites') : Promise.resolve([]),
          staff ? store.list('jobs') : Promise.resolve([]),
          staff ? store.list('budget_lines') : Promise.resolve([]),
          store.list('pos'),
          store.list('bills'),
          staff ? store.list('change_orders') : Promise.resolve([]),
          staff ? store.list('draws') : Promise.resolve([]),
          staff ? store.list('draw_lines') : Promise.resolve([]),
          store.list('lien_waivers'),
          store.list('tasks'),
          staff ? store.list('daily_logs') : Promise.resolve([]),
          store.list('photos'),
          staff || crew ? store.list('selections') : Promise.resolve([]),
          staff || crew ? store.list('documents') : Promise.resolve([]),
          staff ? store.list('job_steps') : Promise.resolve([]),
          staff || crew ? store.list('scope_items') : Promise.resolve([]),
          staff ? store.list('materials') : crew ? store.crewMaterials() : Promise.resolve([]),
          staff ? store.list('notifications') : Promise.resolve([]),
          contacts ? store.list('vendor_contacts') : Promise.resolve([]),
          contacts ? store.list('auto_text_settings') : Promise.resolve([]),
          contacts ? store.list('auto_texts') : Promise.resolve([]),
          staff ? Promise.resolve([]) : store.myJobs(),
          me.role === 'sub' ? store.myMaterialRequests() : Promise.resolve([]),
        ]);
      setData({ vendors, profiles, team_invites, jobs, budget_lines, pos, bills, change_orders, draws, draw_lines, lien_waivers, tasks, daily_logs, photos, selections, documents, job_steps, scope_items, materials, notifications, vendor_contacts, auto_text_settings, auto_texts, subJobs, myRequests });
      setLoadError('');
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => { void reload(); }, [reload]);

  const run = useCallback<Ctx['run']>(async (work, done) => {
    try {
      await work();
      await reload();
      if (done) setToast({ kind: 'ok', text: done });
      return true;
    } catch (e) {
      setToast({ kind: 'err', text: (e as Error).message });
      await reload();
      return false;
    }
  }, [reload]);

  const value = useMemo(
    () => ({ me, data, loading, loadError, reload, run, toast, clearToast: () => setToast(null) }),
    [me, data, loading, loadError, reload, run, toast],
  );
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData() {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useData must be inside DataProvider');
  return c;
}
