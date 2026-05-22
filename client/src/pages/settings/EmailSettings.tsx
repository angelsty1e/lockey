import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import type { EmailConfig, EmailConfigInput } from '../../types';
import { useToast } from '../../components/Toast';
import { SpinnerInline } from '../../components/Skeleton';
import { formatApiError } from '../../utils/format';

interface FormState {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
}

const PRESETS: { name: string; host: string; port: number; secure: boolean }[] = [
  { name: 'Gmail',       host: 'smtp.gmail.com',          port: 587, secure: false },
  { name: 'Outlook',     host: 'smtp.office365.com',      port: 587, secure: false },
  { name: 'OVH',         host: 'ssl0.ovh.net',            port: 465, secure: true },
  { name: 'Mailgun',     host: 'smtp.mailgun.org',        port: 587, secure: false },
  { name: 'SendGrid',    host: 'smtp.sendgrid.net',       port: 587, secure: false },
];

export function EmailSettings() {
  const toast = useToast();
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [form, setForm] = useState<FormState>({
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    fromEmail: '',
    fromName: 'Lockey',
    enabled: false,
  });
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState('');

  function loadInto(c: EmailConfig) {
    setConfig(c);
    setForm({
      smtpHost: c.smtpHost || '',
      smtpPort: c.smtpPort || 587,
      smtpSecure: c.smtpSecure,
      smtpUser: c.smtpUser || '',
      smtpPass: '',
      fromEmail: c.fromEmail || '',
      fromName: c.fromName || 'Lockey',
      enabled: c.enabled,
    });
  }

  useEffect(() => {
    api.getEmailSettings()
      .then(loadInto)
      .catch(e => toast.error(formatApiError(e, 'Erreur lors du chargement de la configuration e-mail')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(p: (typeof PRESETS)[number]) {
    setForm(f => ({ ...f, smtpHost: p.host, smtpPort: p.port, smtpSecure: p.secure }));
  }

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: EmailConfigInput = {
        smtpHost: form.smtpHost || null,
        smtpPort: form.smtpPort,
        smtpSecure: form.smtpSecure,
        smtpUser: form.smtpUser || null,
        fromEmail: form.fromEmail || null,
        fromName: form.fromName || null,
        enabled: form.enabled,
      };
      if (form.smtpPass) body.smtpPass = form.smtpPass;
      const updated = await api.updateEmailSettings(body);
      loadInto(updated);
      toast.ok('Configuration enregistrée');
    } catch (err) {
      toast.error(formatApiError(err, "Erreur lors de l'enregistrement de la configuration"));
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    setTesting(true);
    try {
      const r = await api.testEmailSettings(testEmail || undefined);
      if (r.success) toast.ok(r.message);
      else toast.error(r.message);
    } catch (err) {
      toast.error(formatApiError(err, "Échec de l'envoi de l'e-mail de test"));
    } finally {
      setTesting(false);
    }
  }

  if (!config) return <div className="loading">Chargement…</div>;

  const passwordPlaceholder = config.hasSmtpPass ? '•••••••••••• (laisser vide pour ne pas changer)' : '';

  return (
    <form onSubmit={onSave} className="form">
      <div className="settings-section">
        <div className="settings-section-head">
          <h3>Serveur SMTP</h3>
          <div className="presets">
            <span className="muted small">Pré-réglages :</span>
            {PRESETS.map(p => (
              <button
                key={p.name}
                type="button"
                className="btn btn-tiny"
                onClick={() => applyPreset(p)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="form-grid">
          <div className="field full">
            <label htmlFor="smtp-host">Hôte SMTP</label>
            <input
              id="smtp-host"
              value={form.smtpHost}
              onChange={e => update('smtpHost', e.target.value)}
              placeholder="smtp.example.com"
            />
          </div>
          <div className="field">
            <label htmlFor="smtp-port">Port</label>
            <input
              id="smtp-port"
              type="number"
              min={1}
              max={65535}
              value={form.smtpPort}
              onChange={e => update('smtpPort', parseInt(e.target.value, 10) || 587)}
            />
          </div>
          <div className="field">
            <label htmlFor="smtp-secure">Sécurité</label>
            <select
              id="smtp-secure"
              value={form.smtpSecure ? 'ssl' : 'starttls'}
              onChange={e => update('smtpSecure', e.target.value === 'ssl')}
            >
              <option value="starttls">STARTTLS (587)</option>
              <option value="ssl">SSL/TLS direct (465)</option>
            </select>
          </div>
          <div className="field full">
            <label htmlFor="smtp-user">Utilisateur SMTP</label>
            <input
              id="smtp-user"
              value={form.smtpUser}
              onChange={e => update('smtpUser', e.target.value)}
              placeholder="contact@example.com"
              autoComplete="off"
            />
          </div>
          <div className="field full">
            <label htmlFor="smtp-pass">Mot de passe SMTP</label>
            <div className="input-with-toggle">
              <input
                id="smtp-pass"
                type={showPass ? 'text' : 'password'}
                value={form.smtpPass}
                onChange={e => update('smtpPass', e.target.value)}
                placeholder={passwordPlaceholder}
                autoComplete="new-password"
                aria-describedby="smtp-pass-hint"
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
            <span id="smtp-pass-hint" className="hint">
              Stocké chiffré (AES-256-GCM). Laissez vide pour conserver le mot de passe actuel.
            </span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Expéditeur</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="smtp-from-name">Nom affiché</label>
            <input
              id="smtp-from-name"
              value={form.fromName}
              onChange={e => update('fromName', e.target.value)}
              placeholder="Lockey"
            />
          </div>
          <div className="field">
            <label htmlFor="smtp-from-email">Adresse email</label>
            <input
              id="smtp-from-email"
              type="email"
              value={form.fromEmail}
              onChange={e => update('fromEmail', e.target.value)}
              placeholder="contact@example.com"
            />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Activation</h3>
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={e => update('enabled', e.target.checked)}
          />
          <span>Activer l'envoi d'emails (alertes d'expiration, notifications)</span>
        </label>
      </div>

      <div className="form-actions form-actions-spread">
        <div className="test-row">
          <input
            type="email"
            className="input"
            placeholder={config.fromEmail ? `défaut: ${config.fromEmail}` : 'destinataire du test'}
            value={testEmail}
            onChange={e => setTestEmail(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onTest}
            disabled={testing || !form.smtpHost || !form.smtpUser}
          >
            {testing && <SpinnerInline label="Envoi" />}
            {testing ? 'Envoi…' : 'Tester l\'envoi'}
          </button>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && <SpinnerInline label="Enregistrement" />}
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}
