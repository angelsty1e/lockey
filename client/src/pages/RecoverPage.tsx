import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { HexagonsBackground } from '../components/HexagonsBackground';

/**
 * Récupération de Lockey via le code de récupération, quand le mot de passe
 * maître est oublié. L'utilisateur fournit son code et choisit immédiatement
 * un nouveau mot de passe maître.
 */
export function RecoverPage() {
  const { user, vaultKey, recover } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Déjà connecté ET déverrouillé → rien à récupérer.
  if (user && vaultKey) return <Navigate to="/" replace />;

  const passwordValid = password.length >= 12;
  const passwordMatch = password === confirm;
  const canSubmit =
    username.trim().length > 0 && code.trim().length > 0 && passwordValid && passwordMatch && !busy;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      await recover(username.trim(), code, password);
      navigate('/', { replace: true });
    } catch {
      setError('Code de récupération ou identifiant invalide.');
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
            <KeyRound size={26} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <p className="login-tagline">Récupération de Lockey</p>
        </div>

        <form onSubmit={onSubmit} className="login-form">
          <p className="text-faint" style={{ marginTop: 0 }}>
            Saisissez votre code de récupération pour reprendre le contrôle de
            votre Lockey et définir un nouveau mot de passe maître.
          </p>

          <div className="field">
            <label htmlFor="recover-username">Identifiant</label>
            <input
              id="recover-username"
              type="text"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="recover-code">Code de récupération</label>
            <input
              id="recover-code"
              type="text"
              autoComplete="off"
              spellCheck={false}
              required
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
              value={code}
              onChange={e => setCode(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="recover-password">Nouveau mot de passe maître</label>
            <input
              id="recover-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={e => setPassword(e.target.value)}
              aria-describedby="recover-password-hint"
            />
            <span id="recover-password-hint" className="hint">12 caractères minimum.</span>
          </div>

          <div className="field">
            <label htmlFor="recover-confirm">Confirmer le mot de passe</label>
            <input
              id="recover-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              aria-invalid={!!confirm && !passwordMatch}
            />
            {confirm && !passwordMatch && (
              <span className="hint" role="alert" style={{ color: 'var(--danger)' }}>
                Les mots de passe ne correspondent pas.
              </span>
            )}
          </div>

          {error && <div className="login-error" role="alert">{error}</div>}

          <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
            {busy ? 'Récupération…' : 'Récupérer mon Lockey'}
          </button>

          <div className="login-mfa-switch">
            <Link className="link-btn" to="/login">Retour à la connexion</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
