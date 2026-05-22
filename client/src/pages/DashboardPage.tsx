import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, AlertTriangle, Repeat, Clock, ShieldOff, Lock } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/StatusBadge';
import { formatApiError } from '../utils/format';
import { VaultItemModal } from './VaultItemModal';
import { decryptItem } from '../vault/crypto';
import { auditVault, scoreLabel } from '../vault/audit';
import { TYPE_META } from '../vault/meta';
import type { DecryptedItem } from '../vault/types';

const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

export function DashboardPage() {
  const { vaultKey } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<DecryptedItem[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalItem, setModalItem] = useState<DecryptedItem | null>(null);

  async function load() {
    if (!vaultKey) return;
    try {
      const records = await api.listVaultItems();
      const decrypted = await Promise.all(
        records.map(async r => {
          try {
            return await decryptItem(vaultKey, r);
          } catch {
            return null;
          }
        }),
      );
      setItems(decrypted.filter((x): x is DecryptedItem => x !== null));
    } catch (e) {
      toast.error(formatApiError(e, 'Erreur lors du chargement du tableau de bord'));
      setItems([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultKey]);

  const report = useMemo(() => (items ? auditVault(items) : null), [items]);

  function openItem(it: DecryptedItem) {
    setModalItem(it);
    setModalOpen(true);
  }

  async function afterChange() {
    setModalOpen(false);
    await load();
  }

  const tone =
    report == null ? 'ok' : report.score >= 65 ? 'ok' : report.score >= 40 ? 'warn' : 'danger';

  const reusedItems = report ? report.reused.flatMap(g => g.items) : [];
  const issueCount = report
    ? report.weak.length + reusedItems.length + report.old.length + report.noTotp.length
    : 0;

  return (
    <div className="page">
      <PageHeader title="Tableau de bord" subtitle="Audit de sécurité de votre Lockey" />

      {items === null ? (
        <div className="empty">Analyse de Lockey…</div>
      ) : items.length === 0 ? (
        <section className="card">
          <div className="card-header">
            <h2>Votre Lockey est vide</h2>
          </div>
          <p className="muted" style={{ margin: '0 0 16px' }}>
            Ajoutez des identifiants pour obtenir l'audit de sécurité.
          </p>
          <Link to="/vault" className="btn btn-primary">
            <Lock size={16} strokeWidth={1.75} aria-hidden="true" /> Ouvrir Lockey
          </Link>
        </section>
      ) : (
        report && (
          <>
            <div className="audit-top">
              <div className={`audit-score audit-score-${tone}`}>
                <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
                  <circle cx="70" cy="70" r={RING_R} className="audit-ring-bg" />
                  <circle
                    cx="70"
                    cy="70"
                    r={RING_R}
                    className="audit-ring-fg"
                    strokeDasharray={RING_C}
                    strokeDashoffset={RING_C * (1 - report.score / 100)}
                    transform="rotate(-90 70 70)"
                  />
                </svg>
                <div className="audit-score-center">
                  <span className="audit-score-num">{report.score}</span>
                  <span className="audit-score-max">/ 100</span>
                </div>
              </div>
              <div className="audit-score-side">
                <h2>{scoreLabel(report.score)}</h2>
                <p className="muted">
                  {issueCount === 0
                    ? 'Aucun problème détecté — votre Lockey est en bonne santé.'
                    : `${issueCount} point${issueCount > 1 ? 's' : ''} d'attention sur ${report.logins} identifiant${report.logins > 1 ? 's' : ''}.`}
                </p>
              </div>
            </div>

            <div className="audit-stats">
              <StatCard label="Éléments" value={report.total} tone="muted" />
              <StatCard label="Identifiants" value={report.logins} tone="muted" />
              <StatCard label="Faibles" value={report.weak.length} tone="danger" />
              <StatCard label="Réutilisés" value={reusedItems.length} tone="danger" />
              <StatCard label="Anciens" value={report.old.length} tone="warn" />
              <StatCard label="Sans 2FA" value={report.noTotp.length} tone="warn" />
            </div>

            {issueCount === 0 ? (
              <section className="card audit-allclear">
                <ShieldCheck size={22} strokeWidth={1.75} aria-hidden="true" />
                <span>Tout est au vert. Continuez comme ça !</span>
              </section>
            ) : (
              <>
                <IssueSection
                  title="Mots de passe faibles"
                  hint="Trop courts ou trop simples — à renforcer avec le générateur."
                  Icon={AlertTriangle}
                  tone="danger"
                  items={report.weak}
                  onOpen={openItem}
                />
                <IssueSection
                  title="Mots de passe réutilisés"
                  hint="Le même mot de passe protège plusieurs comptes."
                  Icon={Repeat}
                  tone="danger"
                  items={reusedItems}
                  onOpen={openItem}
                />
                <IssueSection
                  title="Mots de passe anciens"
                  hint="Inchangés depuis plus d'un an."
                  Icon={Clock}
                  tone="warn"
                  items={report.old}
                  onOpen={openItem}
                />
                <IssueSection
                  title="Identifiants sans 2FA"
                  hint="Ajoutez une clé 2FA pour une protection renforcée."
                  Icon={ShieldOff}
                  tone="warn"
                  items={report.noTotp}
                  onOpen={openItem}
                />
              </>
            )}
          </>
        )
      )}

      {modalOpen && (
        <VaultItemModal
          item={modalItem}
          onClose={() => setModalOpen(false)}
          onSaved={afterChange}
          onDeleted={afterChange}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`audit-stat audit-stat-${value > 0 ? tone : 'muted'}`}>
      <span className="audit-stat-value">{value}</span>
      <span className="audit-stat-label">{label}</span>
    </div>
  );
}

function IssueSection({
  title,
  hint,
  Icon,
  tone,
  items,
  onOpen,
}: {
  title: string;
  hint: string;
  Icon: typeof AlertTriangle;
  tone: string;
  items: DecryptedItem[];
  onOpen: (it: DecryptedItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="card audit-section">
      <div className="audit-section-head">
        <span className={`audit-section-icon audit-tone-${tone}`}>
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div>
          <h3>
            {title} <span className="audit-section-count">{items.length}</span>
          </h3>
          <p className="muted small">{hint}</p>
        </div>
      </div>
      <ul className="audit-issue-list">
        {items.map(it => {
          const { Icon: TypeIcon } = TYPE_META[it.type];
          return (
            <li key={it.id}>
              <button type="button" className="audit-issue" onClick={() => onOpen(it)}>
                <TypeIcon size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>{it.content.name || '(sans nom)'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
