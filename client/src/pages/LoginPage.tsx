import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { useAuth } from '../auth/AuthContext';
import { EASE, prefersReducedMotion } from '../utils/motion';
import { HexagonsBackground } from '../components/HexagonsBackground';

export function LoginPage() {
  const { user, login, verifyMfa, cancelMfa, pendingMfa, loading } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Étape 2 (MFA)
  const [mfaCode, setMfaCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Timeline d'entrée façon Kliopi : card → mark → tagline → fields → bouton.
  // Pas d'animation de fond persistante (le HexagonsBackground pulse de son
  // côté, à très faible amplitude). Le `clearProps` final remet tout d'aplomb
  // pour ne pas bloquer les transitions GSAP suivantes.
  useGSAP(() => {
    if (prefersReducedMotion()) return;
    const tl = gsap.timeline({
      defaults: { clearProps: 'opacity,scale,x,y' },
    });
    tl.from('.login-card', {
        opacity: 0,
        y: 30,
        scale: 0.96,
        duration: 0.55,
        ease: EASE.out,
      })
      .from('.login-mark', {
        opacity: 0,
        scale: 0.85,
        y: -10,
        duration: 0.5,
        ease: EASE.back,
      }, '-=0.35')
      .from('.login-tagline', {
        opacity: 0,
        y: 12,
        duration: 0.35,
        ease: EASE.out,
      }, '-=0.25')
      .from('.field', {
        opacity: 0,
        x: -16,
        stagger: 0.07,
        duration: 0.35,
        ease: EASE.out,
      }, '-=0.2')
      .from('.btn-block', {
        opacity: 0,
        y: 10,
        scale: 0.95,
        duration: 0.3,
        ease: EASE.out,
      }, '-=0.15');
  }, { scope: pageRef, dependencies: [pendingMfa] });

  useGSAP(() => {
    if (!error || prefersReducedMotion() || !formRef.current) return;
    gsap.to(formRef.current, {
      keyframes: { x: [-14, 14, -11, 11, -7, 7, -3, 3, 0] },
      duration: 0.5,
      ease: 'none',
    });
  }, { scope: pageRef, dependencies: [error] });

  if (loading) return null;
  if (user) {
    const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname || '/';
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      // Si la réponse impose le 2FA, le contexte bascule pendingMfa=true,
      // ce qui re-rend ce composant en étape 2. Sinon, redirect via <Navigate>.
    } catch (err: any) {
      setError(err?.message || 'Échec de connexion');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitMfa(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (useBackup) {
        await verifyMfa({ backupCode: mfaCode });
      } else {
        await verifyMfa({ code: mfaCode });
      }
    } catch (err: any) {
      setError(err?.message || 'Code invalide');
      setMfaCode('');
    } finally {
      setBusy(false);
    }
  }

  function backToPassword() {
    cancelMfa();
    setMfaCode('');
    setUseBackup(false);
    setError(null);
  }

  return (
    <div className="login-page" ref={pageRef}>
      <HexagonsBackground className="login-hex" minOpacity={0.04} maxOpacity={0.12} pulseDuration={6} />
      <div className="login-card">
        <div className="login-card-accent" aria-hidden="true" />
        <div className="login-brand">
          <div className="login-mark">
            <span className="brand-mark-cyan">Lockey</span>
          </div>
          <p className="login-tagline">
            {pendingMfa ? 'Vérification à deux facteurs' : 'Votre gestionnaire de mots de passe'}
          </p>
        </div>

        {!pendingMfa && (
          <form onSubmit={onSubmit} className="login-form" ref={formRef}>
            <div className="field">
              <label htmlFor="login-username">Identifiant</label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                autoFocus
                required
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">Mot de passe</label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>

            {error && <div id="login-error" className="login-error" role="alert">{error}</div>}

            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Connexion…' : 'Se connecter'}
            </button>

            <div className="login-mfa-switch">
              <Link className="link-btn" to="/recover">
                Mot de passe maître oublié ?
              </Link>
            </div>
          </form>
        )}

        {pendingMfa && (
          <form onSubmit={onSubmitMfa} className="login-form" ref={formRef}>
            <div className="field">
              <label htmlFor="login-mfa">
                {useBackup ? 'Code de secours' : 'Code à 6 chiffres'}
              </label>
              <input
                id="login-mfa"
                type="text"
                inputMode={useBackup ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                autoFocus
                required
                maxLength={useBackup ? 16 : 7}
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : 'login-mfa-hint'}
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value)}
                placeholder={useBackup ? 'xxxx-xxxx' : '123456'}
              />
              <span id="login-mfa-hint" className="hint">
                {useBackup
                  ? 'Code à usage unique généré lors de l\'activation du 2FA.'
                  : 'Affiché par ton app authenticator (Google Authenticator, Authy…).'}
              </span>
            </div>

            {error && <div id="login-error" className="login-error" role="alert">{error}</div>}

            <button type="submit" className="btn btn-primary btn-block" disabled={busy || !mfaCode}>
              {busy ? 'Vérification…' : 'Valider'}
            </button>

            <div className="login-mfa-switch">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setUseBackup(v => !v);
                  setMfaCode('');
                  setError(null);
                }}
              >
                {useBackup ? 'Utiliser le code de mon app' : 'Utiliser un code de secours'}
              </button>
              <span className="login-mfa-sep">·</span>
              <button type="button" className="link-btn" onClick={backToPassword}>
                Retour
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
