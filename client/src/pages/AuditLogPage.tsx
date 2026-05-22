import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AuditAction, AuditLog } from '../types';
import { PageHeader } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { SkeletonTable } from '../components/Skeleton';
import { formatApiError } from '../utils/format';

const ACTIONS: AuditAction[] = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DELETED',
  'VAULT_ITEM_CREATED',
  'VAULT_ITEM_UPDATED',
  'VAULT_ITEM_DELETED',
  'MFA_SETUP_INITIATED',
  'MFA_ENABLED',
  'MFA_DISABLED',
  'MFA_VERIFIED',
  'MFA_BACKUP_CODE_USED',
  'MFA_BACKUP_CODES_REGENERATED',
  'HEALTHCHECK_CONFIG_UPDATED',
  'HEALTHCHECK_RUN',
];

const ACTION_LABEL: Record<AuditAction, string> = {
  LOGIN: 'Connexion',
  LOGIN_FAILED: 'Échec connexion',
  LOGOUT: 'Déconnexion',
  USER_CREATED: 'Utilisateur créé',
  USER_UPDATED: 'Utilisateur modifié',
  USER_DELETED: 'Utilisateur supprimé',
  VAULT_ITEM_CREATED: 'Lockey — élément créé',
  VAULT_ITEM_UPDATED: 'Lockey — élément modifié',
  VAULT_ITEM_DELETED: 'Lockey — élément supprimé',
  SETTINGS_UPDATED: 'Paramètres modifiés',
  SETTINGS_TEST_SENT: 'Paramètres — test envoyé',
  MFA_SETUP_INITIATED: '2FA — setup démarré',
  MFA_ENABLED: '2FA — activé',
  MFA_DISABLED: '2FA — désactivé',
  MFA_VERIFIED: '2FA — code vérifié',
  MFA_BACKUP_CODE_USED: '2FA — code de secours utilisé',
  MFA_BACKUP_CODES_REGENERATED: '2FA — codes de secours régénérés',
  HEALTHCHECK_CONFIG_UPDATED: 'Tests automatisés — config modifiée',
  HEALTHCHECK_RUN: 'Tests automatisés — run exécuté',
};

// L'audit affiche la seconde car on cherche souvent à corréler des événements
// très rapprochés (login → action → erreur). Volontairement plus précis que
// le formatDate() partagé.
function fmtAuditDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const PAGE_SIZE = 50;

export function AuditLogPage() {
  const toast = useToast();
  const [items, setItems] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<{ action: string; serial: string; success: '' | 'true' | 'false' }>({
    action: '',
    serial: '',
    success: '',
  });

  async function load(off = 0) {
    setLoading(true);
    try {
      const r = await api.audit({
        action: filters.action || undefined,
        serial: filters.serial || undefined,
        success: filters.success || undefined,
        limit: PAGE_SIZE,
        offset: off,
      });
      setItems(r.items);
      setTotal(r.total);
      setOffset(off);
    } catch (e) {
      toast.error(formatApiError(e, "Erreur lors du chargement du journal d'audit"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onApplyFilters() {
    load(0);
  }

  function onReset() {
    setFilters({ action: '', serial: '', success: '' });
    setTimeout(() => load(0), 0);
  }

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="page">
      <PageHeader title="Journal d'audit" subtitle={`${total} événement${total > 1 ? 's' : ''}`} />

      <div className="card">
        <div className="card-toolbar">
          <select
            className="input"
            value={filters.action}
            onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
          >
            <option value="">Toutes les actions</option>
            {ACTIONS.map(a => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
          <input
            type="search"
            className="input"
            placeholder="Filtrer par serial…"
            value={filters.serial}
            onChange={e => setFilters(f => ({ ...f, serial: e.target.value }))}
          />
          <select
            className="input"
            value={filters.success}
            onChange={e => setFilters(f => ({ ...f, success: e.target.value as '' | 'true' | 'false' }))}
          >
            <option value="">Tout</option>
            <option value="true">Succès</option>
            <option value="false">Échecs</option>
          </select>
          <button className="btn btn-primary" onClick={onApplyFilters}>Filtrer</button>
          <button className="btn btn-secondary" onClick={onReset}>Réinitialiser</button>
        </div>

        {loading ? (
          <SkeletonTable rows={8} cols={7} caption="Chargement du journal d'audit…" />
        ) : items.length === 0 ? (
          <div className="empty">Aucun événement trouvé.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Utilisateur</th>
                  <th>IP</th>
                  <th>Serial</th>
                  <th>Statut</th>
                  <th>Détails</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} className={!it.success ? 'row-fail' : undefined}>
                    <td data-label="Date" className="muted nowrap">{fmtAuditDate(it.createdAt)}</td>
                    <td data-label="Action"><span className="action-pill">{ACTION_LABEL[it.action] || it.action}</span></td>
                    <td data-label="Utilisateur">{it.user?.username || it.username || <span className="muted">—</span>}</td>
                    <td data-label="IP" className="muted mono">{it.ip || '—'}</td>
                    <td data-label="Serial" className="mono">{it.serial || '—'}</td>
                    <td data-label="Statut">
                      {it.success ? (
                        <span className="status-badge status-valid">OK</span>
                      ) : (
                        <span className="status-badge status-revoked">FAIL</span>
                      )}
                    </td>
                    <td data-label="Détails" className="details">
                      {it.details ? (
                        <code className="json-snippet">{JSON.stringify(it.details)}</code>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagination">
          <button className="btn btn-secondary" disabled={!hasPrev} onClick={() => load(offset - PAGE_SIZE)}>
            ← Précédent
          </button>
          <span className="muted">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} sur {total}
          </span>
          <button className="btn btn-secondary" disabled={!hasNext} onClick={() => load(offset + PAGE_SIZE)}>
            Suivant →
          </button>
        </div>
      </div>
    </div>
  );
}
