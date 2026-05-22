import { useRef, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/StatusBadge';
import { EmailSettings } from './settings/EmailSettings';
import { UsersSettings } from './settings/UsersSettings';
import { SecuritySettings } from './settings/SecuritySettings';
import { HealthChecksSettings } from './settings/HealthChecksSettings';

type Tab = 'securite' | 'email' | 'utilisateurs' | 'tests';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'securite', label: 'Sécurité (mon compte)', icon: '🛡' },
  { id: 'email', label: 'Email (SMTP)', icon: '✉' },
  { id: 'utilisateurs', label: 'Utilisateurs', icon: '◐' },
  { id: 'tests', label: 'Tests automatisés', icon: '⚡' },
];

const DEFAULT_TAB: Tab = 'securite';
const TAB_IDS = TABS.map(t => t.id) as Tab[];

function isTab(v: string | null): v is Tab {
  return v != null && (TAB_IDS as string[]).includes(v);
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab');
  const tab: Tab = isTab(raw) ? raw : DEFAULT_TAB;
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    securite: null,
    email: null,
    utilisateurs: null,
    tests: null,
  });

  function setTab(next: Tab) {
    const sp = new URLSearchParams(searchParams);
    if (next === DEFAULT_TAB) sp.delete('tab');
    else sp.set('tab', next);
    setSearchParams(sp, { replace: true });
  }

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const idx = TAB_IDS.indexOf(tab);
    let next: Tab | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = TAB_IDS[(idx + 1) % TAB_IDS.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = TAB_IDS[(idx - 1 + TAB_IDS.length) % TAB_IDS.length];
    else if (e.key === 'Home') next = TAB_IDS[0];
    else if (e.key === 'End') next = TAB_IDS[TAB_IDS.length - 1];
    if (next) {
      e.preventDefault();
      setTab(next);
      tabRefs.current[next]?.focus();
    }
  }

  return (
    <div className="page">
      <PageHeader title="Paramètres" subtitle="Configuration globale de l'application" />

      <div className="settings-shell">
        <div
          className="settings-tabs"
          role="tablist"
          aria-orientation="horizontal"
          aria-label="Sections des paramètres"
        >
          {TABS.map(t => {
            const selected = tab === t.id;
            return (
              <button
                key={t.id}
                ref={el => { tabRefs.current[t.id] = el; }}
                id={`settings-tab-${t.id}`}
                role="tab"
                aria-selected={selected}
                aria-controls={`settings-panel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                className={'settings-tab' + (selected ? ' active' : '')}
                onClick={() => setTab(t.id)}
                onKeyDown={onTabKeyDown}
              >
                <span className="settings-tab-icon" aria-hidden="true">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <div
          className="settings-body"
          role="tabpanel"
          id={`settings-panel-${tab}`}
          aria-labelledby={`settings-tab-${tab}`}
          tabIndex={0}
        >
          {tab === 'securite' && <SecuritySettings />}
          {tab === 'email' && <EmailSettings />}
          {tab === 'utilisateurs' && <UsersSettings />}
          {tab === 'tests' && <HealthChecksSettings />}
        </div>
      </div>
    </div>
  );
}
