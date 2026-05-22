import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Fingerprint } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { HexagonsBackground } from '../components/HexagonsBackground';

/**
 * Affiché quand la session est valide mais Lockey verrouillé (au
 * rechargement de la page, ou après verrouillage automatique). La clé de
 * chiffrement ne survit jamais à un rechargement : il faut ressaisir le mot de
 * passe maître (ou présenter une passkey) pour la re-dériver.
 */
export function UnlockScreen() {
  const { user, unlock, logout, hasPasskey, unlockViaPasskey } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await unlock(password);
    } catch {
      setError('Mot de passe maître incorrect.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  async function onPasskey() {
    setError(null);
    setPasskeyBusy(true);
    try {
      await unlockViaPasskey();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du déverrouillage par passkey.');
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <div className="login-page">
      <HexagonsBackground className="login-hex" minOpacity={0.04} maxOpacity={0.12} pulseDuration={6} />
      <div className="login-card">
        <div className="login-card-accent" aria-hidden="true" />
        <div className="login-brand">
          <div className="login-mark">
            <Lock size={26} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <p className="login-tagline">
            Lockey verrouillé{user ? ` — ${user.username}` : ''}
          </p>
        </div>

        <form onSubmit={onSubmit} className="login-form">
          <div className="field">
            <label htmlFor="unlock-password">Mot de passe maître</label>
            <input
              id="unlock-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              aria-invalid={!!error}
              aria-describedby={error ? 'unlock-error' : undefined}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          {error && <div id="unlock-error" className="login-error" role="alert">{error}</div>}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !password}>
            {busy ? 'Déverrouillage…' : 'Déverrouiller'}
          </button>

          {hasPasskey && (
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={onPasskey}
              disabled={passkeyBusy}
            >
              <Fingerprint size={16} strokeWidth={1.75} aria-hidden="true" />
              {passkeyBusy ? 'Déverrouillage…' : 'Déverrouiller avec une passkey'}
            </button>
          )}

          <div className="login-mfa-switch">
            <button type="button" className="link-btn" onClick={() => navigate('/recover')}>
              Mot de passe maître oublié ?
            </button>
            <span className="login-mfa-sep">·</span>
            <button type="button" className="link-btn" onClick={() => void logout()}>
              Se déconnecter
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
