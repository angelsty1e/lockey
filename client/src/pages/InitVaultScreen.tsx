import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { HexagonsBackground } from '../components/HexagonsBackground';
import { formatApiError } from '../utils/format';

/**
 * Affiché à la première connexion d'un compte créé par un administrateur :
 * le Lockey zéro-connaissance n'a pas encore de clé. L'utilisateur confirme
 * son mot de passe pour générer la clé de chiffrement et son code de récupération.
 */
export function InitVaultScreen() {
  const { user, initializeVault, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Sur succès, le contexte expose `pendingRecoveryCode` ; la modale de
      // code de récupération (rendue par App) prend alors le relais.
      await initializeVault(password);
    } catch (err) {
      setError(formatApiError(err, "Échec de l'initialisation de Lockey"));
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <HexagonsBackground className="login-hex" minOpacity={0.04} maxOpacity={0.12} pulseDuration={6} />
      <div className="login-card">
        <div className="login-card-accent" aria-hidden="true" />
        <div className="login-brand">
          <div className="login-mark">
            <ShieldCheck size={26} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <p className="login-tagline">
            Initialisation de Lockey{user ? ` — ${user.username}` : ''}
          </p>
        </div>

        <form onSubmit={onSubmit} className="login-form">
          <p className="text-faint" style={{ marginTop: 0 }}>
            Confirmez votre mot de passe maître pour créer votre Lockey chiffré.
            Une clé de chiffrement et un code de récupération vont être générés
            dans votre navigateur — le serveur n'y aura jamais accès.
          </p>
          <div className="field">
            <label htmlFor="init-password">Mot de passe maître</label>
            <input
              id="init-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              minLength={1}
              aria-invalid={!!error}
              aria-describedby={error ? 'init-error' : undefined}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          {error && <div id="init-error" className="login-error" role="alert">{error}</div>}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !password}>
            {busy ? 'Initialisation…' : 'Initialiser mon Lockey'}
          </button>

          <div className="login-mfa-switch">
            <button type="button" className="link-btn" onClick={() => void logout()}>
              Se déconnecter
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
