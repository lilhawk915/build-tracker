import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { canSeeContacts, type MaterialRequest, type Profile, type SubJob, type Tables } from '../domain/types';
import { localStore } from './localStore';
import type { Store } from './store';
import { makeSupabaseStore } from './supabaseStore';
import { clearUndo, rememberRows, startUndoGroup, undoLast, undoState, withUndo } from './undo';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const store: Store = withUndo(url && key ? makeSupabaseStore(url, key) : localStore);

export type Data = { [K in keyof Tables]: Tables[K][] } & { subJobs: SubJob[]; myRequests: MaterialRequest[] };

const EMPTY: Data = {
  vendors: [], profiles: [], team_invites: [], jobs: [], budget_lines: [], pos: [], bills: [], change_orders: [],
  draws: [], draw_lines: [], lien_waivers: [], tasks: [], daily_logs: [], photos: [], selections: [], documents: [], job_steps: [], scope_items: [], materials: [], notifications: [], vendor_contacts: [], auto_text_settings: [], auto_texts: [], estimates: [], estimate_markups: [], estimate_versions: [], catalog_items: [], company_settings: [], markup_defaults: [], expenses: [], invoices: [], leads: [], lead_appointments: [], subJobs: [], myRequests: [],
};

interface Ctx {
  me: Profile;
  data: Data;
  loading: boolean;
  loadError: string;
  reload: () => Promise<void>;
  run: (work: () => Promise<unknown>, done?: string) => Promise<boolean>;
  say: (kind: 'ok' | 'err', text: string) => void;
  toast: { kind: 'ok' | 'err'; text: string } | null;
  clearToast: () => void;
  /** Reverses the last change. */
  undo: () => Promise<void>;
  /** Goes up by one after each undo, so pages holding their own copy reload it. */
  undoTick: number;
}

const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({ me, children }: { me: Profile; children: ReactNode }) {
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState<Ctx['toast']>(null);
  const [undoTick, setUndoTick] = useState(0);
  // A different login starts with nothing to undo.
  useEffect(() => { clearUndo(); }, [me.id]);

  const reload = useCallback(async () => {
    try {
      const staff = me.role === 'admin' || me.role === 'staff';
      const crew = me.role === 'crew';
      const admin = me.role === 'admin';
      const contacts = canSeeContacts(me);
      const [vendors, profiles, team_invites, jobs, budget_lines, pos, bills, change_orders, draws, draw_lines, lien_waivers, tasks, daily_logs, photos, selections, documents, job_steps, scope_items, materials, notifications, vendor_contacts, auto_text_settings, auto_texts, estimates, estimate_markups, estimate_versions, catalog_items, company_settings, markup_defaults, expenses, invoices, leads, lead_appointments, subJobs, myRequests] =
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
          staff ? store.list('estimates') : Promise.resolve([]),
          admin ? store.list('estimate_markups') : Promise.resolve([]),
          admin ? store.list('estimate_versions') : Promise.resolve([]),
          staff ? store.list('catalog_items') : Promise.resolve([]),
          staff ? store.list('company_settings') : Promise.resolve([]),
          admin ? store.list('markup_defaults') : Promise.resolve([]),
          staff ? store.list('expenses') : Promise.resolve([]),
          admin ? store.list('invoices') : Promise.resolve([]),
          admin ? store.list('leads') : Promise.resolve([]),
          admin ? store.list('lead_appointments') : Promise.resolve([]),
          staff ? Promise.resolve([]) : store.myJobs(),
          me.role === 'sub' ? store.myMaterialRequests() : Promise.resolve([]),
        ]);
      rememberRows({ vendors, team_invites, jobs, budget_lines, pos, bills, change_orders, draws, draw_lines, lien_waivers, tasks, daily_logs, photos, selections, documents, job_steps, scope_items, materials, notifications, vendor_contacts, auto_text_settings, estimates, estimate_markups, catalog_items, company_settings, markup_defaults, expenses, invoices, leads, lead_appointments } as never);
      setData({ vendors, profiles, team_invites, jobs, budget_lines, pos, bills, change_orders, draws, draw_lines, lien_waivers, tasks, daily_logs, photos, selections, documents, job_steps, scope_items, materials, notifications, vendor_contacts, auto_text_settings, auto_texts, estimates, estimate_markups, estimate_versions, catalog_items, company_settings, markup_defaults, expenses, invoices, leads, lead_appointments, subJobs, myRequests });
      setLoadError('');
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => { void reload(); }, [reload]);

  const run = useCallback<Ctx['run']>(async (work, done) => {
    const endGroup = startUndoGroup(done ? done.replace(/\.$/, '') : 'your last change');
    try {
      await work();
      endGroup();
      await reload();
      if (done) setToast({ kind: 'ok', text: done });
      return true;
    } catch (e) {
      endGroup();
      setToast({ kind: 'err', text: (e as Error).message });
      await reload();
      return false;
    }
  }, [reload]);

  const undo = useCallback(async () => {
    try {
      const label = await undoLast();
      await reload();
      setUndoTick((t) => t + 1);
      setToast(label ? { kind: 'ok', text: `Undone: ${label}.` } : { kind: 'ok', text: 'Nothing to undo.' });
    } catch (e) {
      await reload();
      setUndoTick((t) => t + 1);
      setToast({ kind: 'err', text: `That could not be undone: ${(e as Error).message}` });
    }
  }, [reload]);

  const value = useMemo(
    () => ({ me, data, loading, loadError, reload, run, toast, clearToast: () => setToast(null), say: (kind: 'ok' | 'err', text: string) => setToast({ kind, text }), undo, undoTick }),
    [me, data, loading, loadError, reload, run, toast, undo, undoTick],
  );
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData() {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useData must be inside DataProvider');
  return c;
}

/** What the Undo button would undo next, or null. */
export function useUndoNext(): string | null {
  useSyncExternalStore(undoState.subscribe, undoState.version);
  return undoState.next();
}
