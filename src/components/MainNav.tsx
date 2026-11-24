import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { canSeeContacts, type Profile } from '../domain/types';

interface Item { to: string; label: string; end?: boolean }

/** The few pages used every day, and everything else under More. */
export function navItems(me: Profile): { main: Item[]; more: Item[] } {
  const staff = me.role === 'admin' || me.role === 'staff';
  const admin = me.role === 'admin';
  if (!staff) return { main: [{ to: '/', label: 'My work', end: true }], more: [] };
  return {
    main: [
      { to: '/', label: 'Today', end: true },
      { to: '/search', label: 'Jobs' },
      { to: '/next', label: 'Next 2 weeks' },
      { to: '/estimates', label: 'Estimates' },
      { to: '/subs', label: 'Subs' },
    ],
    more: [
      { to: '/week', label: 'Monday summary' },
      { to: '/calls', label: 'Call list' },
      ...(admin ? [{ to: '/invoices', label: 'Invoices' }, { to: '/leads', label: 'Leads' }] : []),
      ...(canSeeContacts(me) ? [{ to: '/texts', label: 'Auto texts' }] : []),
      ...(admin ? [{ to: '/team', label: 'Team' }] : []),
    ],
  };
}

export function MainNav({ me }: { me: Profile }) {
  const { main, more } = navItems(me);
  const [open, setOpen] = useState(false);       // phone menu
  const [moreOpen, setMoreOpen] = useState(false);
  const loc = useLocation();
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); setMoreOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [moreOpen]);
  const moreActive = more.some((i) => loc.pathname.startsWith(i.to));

  return (
    <>
      <button className="menubtn" aria-expanded={open} aria-controls="mainnav" onClick={() => setOpen((x) => !x)}>
        {open ? 'Close' : 'Menu'}
      </button>
      <nav id="mainnav" aria-label="Main" className={open ? 'open' : ''}>
        {main.map((i) => <NavLink key={i.to} to={i.to} end={i.end}>{i.label}</NavLink>)}
        {/* On a phone the menu is one list, so More's pages are shown with the rest. */}
        {more.map((i) => <NavLink key={i.to} to={i.to} className="phoneonly">{i.label}</NavLink>)}
        {more.length > 0 && (
          <div className="more deskonly" ref={moreRef}>
            <button className={`morebtn ${moreActive ? 'active' : ''}`} aria-expanded={moreOpen} aria-haspopup="true" onClick={() => setMoreOpen((x) => !x)}>
              More <span aria-hidden="true">▾</span>
            </button>
            {moreOpen && (
              <div className="morelist" role="menu">
                {more.map((i) => <NavLink key={i.to} to={i.to} role="menuitem">{i.label}</NavLink>)}
              </div>
            )}
          </div>
        )}
      </nav>
    </>
  );
}
