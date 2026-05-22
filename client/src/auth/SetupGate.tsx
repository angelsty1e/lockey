import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { SetupWizard } from '../pages/SetupWizard';

type Status = 'loading' | 'setup' | 'ready';

/**
 * Pre-auth gate: queries /api/setup/status before showing anything.
 * - `setup` → renders the wizard standalone (replaces the whole app)
 * - `ready` → renders children (normal app with login flow)
 * - On wizard completion, full reload re-runs this check.
 */
export function SetupGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .setupStatus()
      .then(r => setStatus(r.needsSetup ? 'setup' : 'ready'))
      .catch(e => setError(e?.message || 'Impossible de joindre le serveur'));
  }, []);

  if (error) {
    return (
      <div className="auth-loading">
        <div className="login-error" style={{ maxWidth: 420 }}>{error}</div>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="auth-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (status === 'setup') {
    return <SetupWizard onDone={() => { window.location.href = '/'; }} />;
  }

  return <>{children}</>;
}
