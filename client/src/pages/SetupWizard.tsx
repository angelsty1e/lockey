import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { buildAccountKeys } from '../crypto/zk';
import { RecoveryCodeModal } from '../components/RecoveryCodeModal';

interface Props {
  onDone: () => void;
}

export function SetupWizard({ onDone }: Props) {
  const [form, setForm] = useState({
    username: 'admin',
    email: '',
    password: '',
    confirm: '',
  });
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const usernameValid = /^[a-zA-Z0-9._-]{3,64}$/.test(form.username);
  const passwordValid = form.password.length >= 12;
  const passwordMatch = form.password === form.confirm;
  const emailValid = !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const canSubmit = usernameValid && passwordValid && passwordMatch && emailValid && !busy;

  const passwordStrength = useMemo(() => {
    const p = form.password;
    if (p.length === 0) return { score: 0, label: '' };
    let score = 0;
    if (p.length >= 12) score++;
    if (p.length >= 16) score++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
    if (/\d/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    const labels = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Fort', 'Excellent'];
    return { score, label: labels[score] || '' };
  }, [form.password]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setBusy(true);
    try {
      // Toutes les clés sont dérivées dans le navigateur ; le serveur ne reçoit
      // que des hashes et des blobs chiffrés.
      const keys = await buildAccountKeys(form.username, form.password);
      await api.setupInitialAdmin({
        username: form.username,
        email: form.email || undefined,
        authHash: keys.authHash,
        protectedVaultKey: keys.protectedVaultKey,
        recoveryHash: keys.recoveryHash,
        recoveryProtectedKey: keys.recoveryProtectedKey,
      });
      // Affiche le code de récupération ; `onDone` est déclenché à sa fermeture.
      setRecoveryCode(keys.recoveryCode);
    } catch (err: any) {
      setError(err?.message || 'Échec de la création du compte');
      setBusy(false);
    }
  }

  return (
    <div className="wizard-page">
      <div className="wizard-card">
        <header className="wizard-head">
          <div className="login-mark">
            <span className="brand-mark-cyan">Lockey</span>
          </div>
          <h1 className="wizard-title">Première installation</h1>
          <p className="wizard-tagline">
            Aucun utilisateur n'existe encore. Créez le compte administrateur initial.
          </p>
        </header>

        <form onSubmit={submit} className="wizard-form">
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="setup-username">Nom d'utilisateur *</label>
              <input
                id="setup-username"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                autoFocus
                autoComplete="username"
                required
                minLength={3}
                maxLength={64}
                aria-invalid={form.username !== '' && !usernameValid}
                aria-describedby="setup-username-hint"
              />
              <span id="setup-username-hint" className="hint">
                {usernameValid || form.username === ''
                  ? '3 à 64 caractères, lettres / chiffres / . _ -'
                  : 'Format invalide (a-z, A-Z, 0-9, ., _, -)'}
              </span>
            </div>

            <div className="field full">
              <label htmlFor="setup-email">Email (optionnel)</label>
              <input
                id="setup-email"
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                autoComplete="email"
                placeholder="admin@example.com"
                aria-invalid={!!form.email && !emailValid}
                aria-describedby={form.email && !emailValid ? 'setup-email-error' : undefined}
              />
              {form.email && !emailValid && (
                <span id="setup-email-error" className="hint" role="alert" style={{ color: 'var(--danger)' }}>Email invalide</span>
              )}
            </div>

            <div className="field full">
              <label htmlFor="setup-password">Mot de passe *</label>
              <div className="input-with-toggle">
                <input
                  id="setup-password"
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required
                  minLength={12}
                  maxLength={256}
                  autoComplete="new-password"
                  aria-describedby="setup-password-hint setup-password-strength"
                />
                <button
                  type="button"
                  className="btn btn-tiny btn-secondary"
                  onClick={() => setShowPass(v => !v)}
                  aria-pressed={showPass}
                >
                  {showPass ? 'Masquer' : 'Afficher'}
                </button>
              </div>
              {form.password && (
                <div
                  id="setup-password-strength"
                  className={`pwd-strength pwd-strength-${passwordStrength.score}`}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={5}
                  aria-valuenow={passwordStrength.score}
                  aria-valuetext={`Force du mot de passe : ${passwordStrength.label}`}
                >
                  <div className="pwd-bar"><span style={{ width: `${(passwordStrength.score / 5) * 100}%` }} /></div>
                  <span className="hint">{passwordStrength.label}</span>
                </div>
              )}
              <span id="setup-password-hint" className="hint">12 caractères minimum.</span>
            </div>

            <div className="field full">
              <label htmlFor="setup-confirm">Confirmer le mot de passe *</label>
              <input
                id="setup-confirm"
                type={showPass ? 'text' : 'password'}
                value={form.confirm}
                onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                required
                autoComplete="new-password"
                aria-invalid={!!form.confirm && !passwordMatch}
                aria-describedby={form.confirm && !passwordMatch ? 'setup-confirm-error' : undefined}
              />
              {form.confirm && !passwordMatch && (
                <span id="setup-confirm-error" className="hint" role="alert" style={{ color: 'var(--danger)' }}>
                  Les mots de passe ne correspondent pas.
                </span>
              )}
            </div>
          </div>

          {error && <div className="login-error" role="alert">{error}</div>}

          <div className="callout callout-info" style={{ marginTop: 8 }}>
            Ce compte aura le rôle <strong>ADMIN</strong> et pourra créer d'autres utilisateurs depuis l'interface.
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
            {busy ? 'Création…' : 'Créer le compte administrateur'}
          </button>
        </form>
      </div>

      {recoveryCode && <RecoveryCodeModal code={recoveryCode} onClose={onDone} />}
    </div>
  );
}
