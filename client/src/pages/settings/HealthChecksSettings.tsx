import { useEffect, useState, type FormEvent } from 'react';
import { Activity, Play, CheckCircle2, AlertTriangle, XCircle, Mail, MailX } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { SpinnerInline } from '../../components/Skeleton';
import { formatApiError } from '../../utils/format';
import type {
  HealthcheckCatalogItem,
  HealthcheckConfig,
  HealthcheckResult,
  HealthcheckRunSummary,
  HealthcheckSeverity,
} from '../../types';

const SEV_ICON: Record<HealthcheckSeverity, typeof CheckCircle2> = {
  OK: CheckCircle2,
  WARN: AlertTriangle,
  FAIL: XCircle,
};

const SEV_CLASS: Record<HealthcheckSeverity, string> = {
  OK: 'sev-ok',
  WARN: 'sev-warn',
  FAIL: 'sev-fail',
};

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HealthChecksSettings() {
  const toast = useToast();
  const [catalog, setCatalog] = useState<HealthcheckCatalogItem[]>([]);
  const [config, setConfig] = useState<HealthcheckConfig | null>(null);
  const [lastRun, setLastRun] = useState<HealthcheckRunSummary | null>(null);
  const [history, setHistory] = useState<HealthcheckRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResults, setRunResults] = useState<HealthcheckResult[] | null>(null);

  async function refresh() {
    try {
      const [cat, cfg, hist] = await Promise.all([
        api.healthcheckCatalog(),
        api.healthcheckConfig(),
        api.healthcheckHistory(20),
      ]);
      setCatalog(cat.checks);
      setConfig(cfg.config);
      setLastRun(cfg.lastRun);
      setHistory(hist.runs);
    } catch (e) {
      toast.error(formatApiError(e, 'Erreur de chargement healthchecks'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleCheck(key: string) {
    if (!config) return;
    const next = config.enabledChecks.includes(key)
      ? config.enabledChecks.filter(k => k !== key)
      : [...config.enabledChecks, key];
    setConfig({ ...config, enabledChecks: next });
  }

  function setHM(hh: number, mm: number) {
    if (!config) return;
    setConfig({ ...config, scheduleHour: hh, scheduleMinute: mm });
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    try {
      await api.healthcheckUpdateConfig({
        enabledChecks: config.enabledChecks,
        scheduleHour: config.scheduleHour,
        scheduleMinute: config.scheduleMinute,
        scheduleEnabled: config.scheduleEnabled,
      });
      toast.ok('Configuration enregistrée');
    } catch (err) {
      toast.error(formatApiError(err, 'Échec de l\'enregistrement'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    setRunning(true);
    setRunResults(null);
    try {
      const r = await api.healthcheckRunNow();
      setRunResults(r.results);
      const failCount = r.results.filter(x => !x.ok).length;
      if (failCount > 0) toast.error(`${failCount} check(s) en échec`);
      else toast.ok('Tous les checks sont au vert');
      if (r.emailSent) toast.ok('Rapport envoyé par email');
      else if (r.emailError) toast.error(`Email non envoyé : ${r.emailError}`);
      // Refresh history + lastRun.
      const [cfg, hist] = await Promise.all([api.healthcheckConfig(), api.healthcheckHistory(20)]);
      setLastRun(cfg.lastRun);
      setHistory(hist.runs);
    } catch (err) {
      toast.error(formatApiError(err, 'Échec du run'));
    } finally {
      setRunning(false);
    }
  }

  if (loading || !config) return <div className="card-section">Chargement…</div>;

  const hh = String(config.scheduleHour).padStart(2, '0');
  const mm = String(config.scheduleMinute).padStart(2, '0');

  return (
    <div className="health-settings">
      <div className="card-section">
        <div className="security-row">
          <div className="security-icon"><Activity size={28} /></div>
          <div className="security-info">
            <h3>Tests automatisés (healthchecks)</h3>
            <p className="text-faint">
              Coche les vérifications à exécuter quotidiennement. Le rapport est envoyé
              par email à l'admin (premier compte ADMIN actif avec un email renseigné).
            </p>
          </div>
          <div className="security-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleRunNow}
              disabled={running || config.enabledChecks.length === 0}
              title={config.enabledChecks.length === 0 ? 'Active au moins un check' : ''}
            >
              {running ? <SpinnerInline label="Lancer maintenant" /> : <Play size={14} />}
              Lancer maintenant
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="card-section health-form">
        <h3>Planification</h3>
        <div className="health-schedule">
          <label className="health-toggle">
            <input
              type="checkbox"
              checked={config.scheduleEnabled}
              onChange={e => setConfig({ ...config, scheduleEnabled: e.target.checked })}
            />
            <span>Activer l'envoi quotidien automatique</span>
          </label>
          <div className="health-time">
            <label htmlFor="hc-time">Heure d'envoi</label>
            <input
              id="hc-time"
              type="time"
              value={`${hh}:${mm}`}
              onChange={e => {
                const [h, m] = e.target.value.split(':').map(Number);
                setHM(h, m);
              }}
              disabled={!config.scheduleEnabled}
            />
            <span className="hint">Heure locale du serveur ({Intl.DateTimeFormat().resolvedOptions().timeZone})</span>
          </div>
        </div>

        <h3 style={{ marginTop: 20 }}>Checks ({config.enabledChecks.length}/{catalog.length} activés)</h3>
        <ul className="health-catalog">
          {catalog.map(c => {
            const checked = config.enabledChecks.includes(c.key);
            return (
              <li key={c.key} className="health-check-row">
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCheck(c.key)}
                  />
                  <div className="health-check-text">
                    <span className="health-check-label">{c.label}</span>
                    <span className="health-check-desc">{c.description}</span>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving && <SpinnerInline label="Enregistrer" />}
            Enregistrer
          </button>
        </div>
      </form>

      {runResults && (
        <div className="card-section">
          <h3>Dernier run (manuel)</h3>
          <ul className="health-results">
            {runResults.map(r => {
              const Icon = SEV_ICON[r.severity];
              return (
                <li key={r.key} className={`health-result ${SEV_CLASS[r.severity]}`}>
                  <Icon size={18} />
                  <div className="health-result-info">
                    <span className="health-result-label">{r.label}</span>
                    <span className="health-result-msg">{r.message}</span>
                  </div>
                  <span className="health-result-duration text-faint">{r.durationMs}ms</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="card-section">
        <h3>Historique des runs ({history.length})</h3>
        {lastRun ? (
          <p className="text-faint">
            Dernier run : <strong>{fmtTime(lastRun.startedAt)}</strong> ({lastRun.triggeredBy === 'CRON' ? 'auto' : 'manuel'}) —{' '}
            {lastRun.okCount} OK · {lastRun.failCount} FAIL ·{' '}
            {lastRun.emailSent ? (
              <span><Mail size={12} /> envoyé à {lastRun.recipientEmail}</span>
            ) : (
              <span><MailX size={12} /> {lastRun.emailError ?? 'email non envoyé'}</span>
            )}
          </p>
        ) : (
          <p className="text-faint">Aucun run encore exécuté.</p>
        )}
        {history.length > 0 && (
          <table className="health-history">
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th>OK</th>
                <th>FAIL</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {history.map(r => (
                <tr key={r.id} className={r.failCount > 0 ? 'row-fail' : undefined}>
                  <td>{fmtTime(r.startedAt)}</td>
                  <td>{r.triggeredBy === 'CRON' ? 'auto' : 'manuel'}</td>
                  <td>{r.okCount}</td>
                  <td>{r.failCount}</td>
                  <td>{r.emailSent ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
