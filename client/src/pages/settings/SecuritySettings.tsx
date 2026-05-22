import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck, ShieldOff, KeyRound, RefreshCw, Copy, Check, Lock, Fingerprint } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { deriveLogin } from '../../crypto/zk';
import { isPasskeySupported } from '../../crypto/passkey';
import { useToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SpinnerInline } from '../../components/Skeleton';
import { formatApiError } from '../../utils/format';
import type { MfaSetupResponse, MfaStatus } from '../../types';

export function SecuritySettings() {
  const toast = useToast();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [backupCodesShown, setBackupCodesShown] = useState<string[] | null>(null);
  const [changePwOpen, setChangePwOpen] = useState(false);

  async function refresh() {
    try {
      const s = await api.mfaStatus();
      setStatus(s);
    } catch (e) {
      toast.error(formatApiError(e, 'Impossible de charger l\'état du 2FA'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className="card-section">Chargement…</div>;
  if (!status) return null;

  return (
    <div className="security-settings">
      <div className="card-section">
        <div className="security-row">
          <div className="security-icon">
            <Lock size={28} />
          </div>
          <div className="security-info">
            <h3>Mot de passe maître</h3>
            <p className="text-faint">
              Il chiffre l'intégralité de votre Lockey. Le changer ré-emballe la
              clé de chiffrement dans votre navigateur — vos données et votre
              code de récupération restent valables.
            </p>
          </div>
          <div className="security-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setChangePwOpen(true)}>
              <KeyRound size={14} /> Changer le mot de passe maître
            </button>
          </div>
        </div>
      </div>

      <PasskeySection />

      <div className="card-section">
        <div className="security-row">
          <div className="security-icon">
            {status.enabled ? <ShieldCheck size={28} /> : <ShieldOff size={28} />}
          </div>
          <div className="security-info">
            <h3>Authentification à deux facteurs (2FA)</h3>
            <p className="text-faint">
              {status.enabled
                ? `Activée le ${new Date(status.activatedAt!).toLocaleDateString('fr-FR')} — ${status.backupCodesRemaining} code(s) de secours restant(s).`
                : 'Ajoute une couche de sécurité avec une app authenticator (Google Authenticator, Authy, 1Password, Dashlane…).'}
            </p>
          </div>
          <div className="security-actions">
            {status.enabled ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setRegenOpen(true)}
                >
                  <RefreshCw size={14} /> Régénérer codes de secours
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setDisableOpen(true)}
                >
                  Désactiver
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setSetupOpen(true)}
              >
                <KeyRound size={14} /> Activer le 2FA
              </button>
            )}
          </div>
        </div>
      </div>

      {setupOpen && (
        <SetupMfaModal
          onClose={() => setSetupOpen(false)}
          onEnabled={codes => {
            setSetupOpen(false);
            setBackupCodesShown(codes);
            refresh();
          }}
        />
      )}

      {disableOpen && (
        <DisableMfaModal
          onClose={() => setDisableOpen(false)}
          onDisabled={() => {
            setDisableOpen(false);
            refresh();
            toast.ok('2FA désactivé');
          }}
        />
      )}

      {regenOpen && (
        <RegenerateCodesModal
          onClose={() => setRegenOpen(false)}
          onRegenerated={codes => {
            setRegenOpen(false);
            setBackupCodesShown(codes);
            refresh();
          }}
        />
      )}

      {backupCodesShown && (
        <BackupCodesModal
          codes={backupCodesShown}
          onClose={() => setBackupCodesShown(null)}
        />
      )}

      {changePwOpen && (
        <ChangeMasterPasswordModal
          onClose={() => setChangePwOpen(false)}
          onChanged={() => {
            setChangePwOpen(false);
            toast.ok('Mot de passe maître mis à jour');
          }}
        />
      )}
    </div>
  );
}

// ---------- Changement du mot de passe maître ----------

function ChangeMasterPasswordModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const { changeMasterPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = password.length >= 12 && password === confirm;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    setSubmitting(true);
    try {
      await changeMasterPassword(password);
      onChanged();
    } catch (err) {
      setError(formatApiError(err, 'Échec du changement de mot de passe'));
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Changer le mot de passe maître"
      onClose={onClose}
      size="sm"
      preventClose={submitting}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Annuler
          </button>
          <button
            type="submit"
            form="change-master-pw-form"
            className="btn btn-primary"
            disabled={submitting || !valid}
          >
            {submitting && <SpinnerInline label="Mise à jour" />}
            Enregistrer
          </button>
        </>
      }
    >
      <form id="change-master-pw-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="new-master-pw">Nouveau mot de passe maître</label>
          <input
            id="new-master-pw"
            type="password"
            autoComplete="new-password"
            autoFocus
            minLength={12}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <span className="hint">12 caractères minimum.</span>
        </div>
        <div className="field">
          <label htmlFor="confirm-master-pw">Confirmer</label>
          <input
            id="confirm-master-pw"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            aria-invalid={!!confirm && password !== confirm}
          />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

// ---------- Déverrouillage par passkey ----------

function PasskeySection() {
  const { hasPasskey, enrollPasskey, removePasskey } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const supported = isPasskeySupported();

  async function activate() {
    setBusy(true);
    try {
      await enrollPasskey();
      toast.ok('Passkey enregistrée');
    } catch (e) {
      toast.error(formatApiError(e, "Échec de l'enrôlement de la passkey"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removePasskey();
      toast.ok('Passkey retirée');
    } catch (e) {
      toast.error(formatApiError(e, 'Échec du retrait de la passkey'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-section">
      <div className="security-row">
        <div className="security-icon">
          <Fingerprint size={28} />
        </div>
        <div className="security-info">
          <h3>Déverrouillage par passkey</h3>
          <p className="text-faint">
            {hasPasskey
              ? 'Une passkey permet de déverrouiller Lockey sans saisir le mot de passe maître (empreinte, Face ID, clé de sécurité).'
              : supported
                ? 'Déverrouillez Lockey avec votre empreinte, Face ID ou une clé de sécurité, en complément du mot de passe maître.'
                : "Votre navigateur ne prend pas en charge les passkeys (contexte sécurisé HTTPS requis)."}
          </p>
        </div>
        <div className="security-actions">
          {hasPasskey ? (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              Retirer la passkey
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={activate}
              disabled={busy || !supported}
            >
              <Fingerprint size={14} /> Activer une passkey
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Setup modal (QR + verify code) ----------

function SetupMfaModal({
  onClose,
  onEnabled,
}: {
  onClose: () => void;
  onEnabled: (backupCodes: string[]) => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<MfaSetupResponse | null>(null);
  const [loadingSetup, setLoadingSetup] = useState(true);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  useEffect(() => {
    api
      .mfaSetup()
      .then(setData)
      .catch(e => toast.error(formatApiError(e, 'Échec de la génération du secret 2FA')))
      .finally(() => setLoadingSetup(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copySecret() {
    if (!data) return;
    await navigator.clipboard.writeText(data.secret);
    setSecretCopied(true);
    setTimeout(() => setSecretCopied(false), 2000);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await api.mfaEnable(code);
      onEnabled(r.backupCodes);
    } catch (err) {
      setError(formatApiError(err, 'Code invalide'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Activer le 2FA"
      onClose={onClose}
      size="md"
      preventClose={submitting}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Annuler
          </button>
          <button
            type="submit"
            form="mfa-setup-form"
            className="btn btn-primary"
            disabled={submitting || loadingSetup || code.length < 6}
          >
            {submitting && <SpinnerInline label="Vérifier" />}
            Vérifier et activer
          </button>
        </>
      }
    >
      {loadingSetup && <p>Génération du secret…</p>}
      {data && (
        <form id="mfa-setup-form" onSubmit={handleSubmit} className="mfa-setup">
          <ol className="mfa-steps">
            <li>
              <strong>Scanne ce QR code</strong> dans ton app authenticator (Google Authenticator,
              Authy, 1Password, Dashlane…).
              <div className="mfa-qr">
                <img src={data.qrDataUrl} alt="QR code 2FA" width={240} height={240} />
              </div>
              <details className="mfa-secret-fallback">
                <summary>Pas de scanner ? Saisir le secret manuellement</summary>
                <div className="mfa-secret-row">
                  <code className="mono">{data.secret}</code>
                  <button type="button" className="btn btn-tiny" onClick={copySecret}>
                    {secretCopied ? <Check size={12} /> : <Copy size={12} />}
                    {secretCopied ? 'Copié' : 'Copier'}
                  </button>
                </div>
              </details>
            </li>
            <li>
              <strong>Saisis le code à 6 chiffres</strong> affiché par ton app pour confirmer
              que tout fonctionne.
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor="mfa-setup-code">Code à 6 chiffres</label>
                <input
                  id="mfa-setup-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={7}
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="123456"
                />
              </div>
            </li>
          </ol>
          {error && <div className="form-error" role="alert">{error}</div>}
        </form>
      )}
    </Modal>
  );
}

// ---------- Disable modal (mdp + code) ----------

function DisableMfaModal({
  onClose,
  onDisabled,
}: {
  onClose: () => void;
  onDisabled: () => void;
}) {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      // Le serveur attend la preuve zéro-connaissance du mot de passe maître.
      const { authHash } = await deriveLogin(user.username, password);
      await api.mfaDisable(authHash, code);
      onDisabled();
    } catch (err) {
      setError(formatApiError(err, 'Échec de la désactivation'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Désactiver le 2FA"
      onClose={onClose}
      size="sm"
      preventClose={submitting}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Annuler
          </button>
          <button
            type="submit"
            form="mfa-disable-form"
            className="btn btn-danger"
            disabled={submitting || !password || code.length < 6}
          >
            {submitting && <SpinnerInline label="Désactiver" />}
            Désactiver
          </button>
        </>
      }
    >
      <form id="mfa-disable-form" onSubmit={handleSubmit}>
        <p className="text-faint" style={{ marginTop: 0 }}>
          Confirme ton mot de passe et un code 2FA pour désactiver la double authentification.
        </p>
        <div className="field">
          <label htmlFor="mfa-disable-pw">Mot de passe</label>
          <input
            id="mfa-disable-pw"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="mfa-disable-code">Code à 6 chiffres</label>
          <input
            id="mfa-disable-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="123456"
            required
          />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

// ---------- Regenerate codes modal ----------

function RegenerateCodesModal({
  onClose,
  onRegenerated,
}: {
  onClose: () => void;
  onRegenerated: (codes: string[]) => void;
}) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await api.mfaRegenerateCodes(code);
      onRegenerated(r.backupCodes);
    } catch (err) {
      setError(formatApiError(err, 'Code invalide'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Régénérer les codes de secours"
      onClose={onClose}
      size="sm"
      preventClose={submitting}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Annuler
          </button>
          <button
            type="submit"
            form="mfa-regen-form"
            className="btn btn-primary"
            disabled={submitting || code.length < 6}
          >
            {submitting && <SpinnerInline label="Régénérer" />}
            Régénérer
          </button>
        </>
      }
    >
      <form id="mfa-regen-form" onSubmit={handleSubmit}>
        <p className="text-faint" style={{ marginTop: 0 }}>
          Les codes existants (utilisés ou non) seront invalidés. Tu obtiendras une nouvelle
          série de 8 codes à conserver.
        </p>
        <div className="field">
          <label htmlFor="mfa-regen-code">Code à 6 chiffres</label>
          <input
            id="mfa-regen-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={7}
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="123456"
            required
          />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

// ---------- Backup codes display (one-time) ----------

function BackupCodesModal({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    await navigator.clipboard.writeText(codes.join('\n'));
    setCopied(true);
    toast.ok('Codes copiés');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal
      title="Codes de secours — à conserver maintenant"
      onClose={onClose}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={copyAll}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copiés' : 'Tout copier'}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            J'ai sauvegardé ces codes
          </button>
        </>
      }
    >
      <div className="form-warning" style={{ marginBottom: 16 }}>
        <strong>Cette liste ne sera plus jamais affichée.</strong> Sauvegarde-la dans un endroit
        sûr (gestionnaire de mdp, papier rangé en lieu sûr). Chaque code sert <strong>une seule fois</strong>
        {' '}en remplacement du code 2FA si tu perds ton téléphone.
      </div>
      <ul className="mfa-backup-codes mono">
        {codes.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </Modal>
  );
}
