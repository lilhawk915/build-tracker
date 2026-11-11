import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { Toast } from './components/ui';
import { DataProvider, store, useData } from './data';
import { canSeeContacts, type Profile } from './domain/types';
import { AutoTextsPage } from './pages/AutoTextsPage';
import { CatalogPage } from './pages/estimates/CatalogPage';
import { EstimatePage } from './pages/estimates/EstimatePage';
import { EstimateSettingsPage } from './pages/estimates/EstimateSettingsPage';
import { EstimatesPage } from './pages/estimates/EstimatesPage';
import { ImportPage } from './pages/estimates/ImportPage';
import { CallsPage } from './pages/CallsPage';
import { CrewHome } from './pages/CrewHome';
import { DrawSheetPage } from './pages/DrawSheetPage';
import { JobPage } from './pages/JobPage';
import { Login } from './pages/Login';
import { Portal } from './pages/Portal';
import { SearchPage } from './pages/SearchPage';
import { Subs } from './pages/Subs';
import { Team } from './pages/Team';
import { Today } from './pages/Today';

function TopSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      role="search"
      className="topsearch"
      onSubmit={(e) => { e.preventDefault(); nav(`/search?q=${encodeURIComponent(q.trim())}`); }}
    >
      <input type="search" aria-label="Search every job" placeholder="Search every job" value={q} onChange={(e) => setQ(e.target.value)} />
    </form>
  );
}

function Shell({ me, onSignOut }: { me: Profile; onSignOut: () => void }) {
  const { loading, loadError } = useData();
  const staff = me.role === 'admin' || me.role === 'staff';
  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="brand"><i aria-hidden="true" />Build Tracker</NavLink>
        <nav aria-label="Main">
          {staff && <NavLink to="/" end>Today</NavLink>}
          {staff && <NavLink to="/calls">Call list</NavLink>}
          {staff && <NavLink to="/estimates">Estimates</NavLink>}
          {staff && <NavLink to="/search">All jobs</NavLink>}
          {canSeeContacts(me) && <NavLink to="/texts">Auto texts</NavLink>}
          {staff && <NavLink to="/subs">Subs</NavLink>}
          {me.role === 'admin' && <NavLink to="/team">Team</NavLink>}
          {(me.role === 'sub' || me.role === 'crew') && <NavLink to="/" end>My work</NavLink>}
        </nav>
        {staff && <TopSearch />}
        {store.mode === 'local' ? (
          <label className="row who">
            Viewing as
            <select value={me.id} onChange={(e) => store.demoSwitch?.(e.target.value)}>
              <option value="demo-admin">Owner</option>
              <option value="demo-sub">Sub: Sample Framing</option>
              <option value="demo-office">Office: Casey (sees contacts)</option>
              <option value="demo-staff">Staff: Morgan</option>
              <option value="demo-crew">Crew: Jordan</option>
            </select>
          </label>
        ) : (
          <span className="who">{me.email} · <button className="linkish" onClick={onSignOut}>Sign out</button></span>
        )}
      </header>
      {store.mode === 'local' && (
        <div className="demo">
          Demo mode: sample data, saved only in this browser.{' '}
          <button className="linkish" onClick={() => store.demoReset?.()}>Reset the demo</button>
        </div>
      )}
      <main>
        {loadError && <div className="alert" role="alert">Could not load your data: {loadError}. Reload the page to try again.</div>}
        {loading ? <p className="muted">Loading…</p> : (
          <Routes>
            {staff ? (
              <>
                <Route path="/" element={<Today />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/estimates" element={<EstimatesPage />} />
                <Route path="/estimates/catalog" element={<CatalogPage />} />
                <Route path="/estimates/import" element={me.role === 'admin' ? <ImportPage /> : <div className="alert">Importing is for admins.</div>} />
                <Route path="/estimates/settings" element={me.role === 'admin' ? <EstimateSettingsPage /> : <div className="alert">Quote settings are for admins.</div>} />
                <Route path="/estimates/:estimateId" element={<EstimatePage />} />
                <Route path="/calls" element={<CallsPage />} />
                {canSeeContacts(me) && <Route path="/texts" element={<AutoTextsPage />} />}
                <Route path="/subs" element={<Subs />} />
                <Route path="/jobs/:jobId/draws/:drawId/sheet" element={<DrawSheetPage />} />
                <Route path="/jobs/:jobId/:tab?" element={<JobPage />} />
                {me.role === 'admin' && <Route path="/team" element={<Team />} />}
              </>
            ) : (
              <Route path="/" element={me.role === 'crew' ? <CrewHome /> : <Portal />} />
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
      <Toast />
    </>
  );
}

export function App() {
  const [me, setMe] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [err, setErr] = useState('');

  const refresh = useCallback(async () => {
    try {
      setMe(await store.me());
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setReady(true);
      // Supabase also fires auth events on tab focus; only the demo's reset needs a full remount.
      if (store.mode === 'local') setVersion((v) => v + 1);
    }
  }, []);

  useEffect(() => {
    store.onAuthChange(() => void refresh());
    void refresh();
  }, [refresh]);

  if (!ready) return <div className="center muted">Loading…</div>;
  if (err) return <div className="center"><div className="alert" role="alert">Could not check your login: {err}. Reload the page to try again.</div></div>;
  if (!me) return <Login />;
  if (me.role === 'none') {
    return (
      <div className="center">
        <div className="panel login">
          <h1>No access yet</h1>
          <p>{me.email} is signed in but hasn't been added to a job team. Ask the owner to invite this email.</p>
          <button className="btn" onClick={() => store.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }
  return (
    <DataProvider key={`${me.id}-${version}`} me={me}>
      <Shell me={me} onSignOut={() => store.signOut()} />
    </DataProvider>
  );
}
