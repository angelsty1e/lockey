import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CommandPalette } from './CommandPalette';
import { ShortcutsHelp } from './ShortcutsHelp';
import { ServerOfflineBanner } from './ServerOfflineBanner';
import { useGlobalShortcut } from '../utils/useGlobalShortcut';
import { useServerStatus } from '../hooks/useServerStatus';

export function Layout() {
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const { isOnline, errorMessage, checkServer } = useServerStatus();

  useEffect(() => {
    if (isOnline) setOfflineDismissed(false);
  }, [isOnline]);

  // Ferme le drawer mobile au changement de route.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // Ferme le drawer si on dépasse le breakpoint en cours d'utilisation.
  useEffect(() => {
    if (!navOpen) return;
    const mq = window.matchMedia('(min-width: 769px)');
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) setNavOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [navOpen]);

  // Verrouille le scroll body quand le drawer est ouvert.
  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [navOpen]);

  useGlobalShortcut('mod+k', e => {
    e.preventDefault();
    setHelpOpen(false);
    setPaletteOpen(o => !o);
  }, { allowInInputs: true });

  useGlobalShortcut('?', e => {
    e.preventDefault();
    setPaletteOpen(false);
    setHelpOpen(o => !o);
  });

  return (
    <div className={'app-shell' + (navOpen ? ' nav-open' : '')}>
      {!isOnline && !offlineDismissed && (
        <ServerOfflineBanner
          errorMessage={errorMessage}
          onRetry={checkServer}
          onDismiss={() => setOfflineDismissed(true)}
        />
      )}
      <a href="#main-content" className="skip-link">Aller au contenu</a>

      <button
        type="button"
        className="mobile-menu-btn"
        aria-label={navOpen ? 'Fermer la navigation' : 'Ouvrir la navigation'}
        aria-expanded={navOpen}
        aria-controls="primary-nav"
        onClick={() => setNavOpen(o => !o)}
      >
        <span aria-hidden="true">{navOpen ? '✕' : '☰'}</span>
      </button>

      <button
        type="button"
        className="nav-backdrop"
        aria-label="Fermer la navigation"
        tabIndex={navOpen ? 0 : -1}
        onClick={() => setNavOpen(false)}
      />

      <Sidebar id="primary-nav" />

      <TopBar />

      <main className="app-main" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
