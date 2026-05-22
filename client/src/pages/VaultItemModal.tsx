import { useState, type FormEvent } from 'react';
import { Star, Copy, Check, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SpinnerInline } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api';
import { formatApiError } from '../utils/format';
import { PasswordGenerator } from '../components/PasswordGenerator';
import { TotpField } from '../components/TotpField';
import { encryptContent } from '../vault/crypto';
import { TYPE_META, fieldsFor, getField, setField } from '../vault/meta';
import { VAULT_ITEM_TYPES, emptyContent } from '../vault/types';
import type { DecryptedItem, ItemContent, VaultItemType } from '../vault/types';

interface Props {
  /** `null` = création d'un nouvel élément. */
  item: DecryptedItem | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export function VaultItemModal({ item, onClose, onSaved, onDeleted }: Props) {
  const { vaultKey } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<'pick' | 'view' | 'edit'>(item ? 'view' : 'pick');
  const [type, setType] = useState<VaultItemType | null>(item?.type ?? null);
  const [content, setContent] = useState<ItemContent>(item?.content ?? { name: '', notes: '' });
  const [favorite, setFavorite] = useState(item?.favorite ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Chemin du champ pour lequel le générateur est ouvert (édition).
  const [generatorField, setGeneratorField] = useState<string | null>(null);

  function pickType(t: VaultItemType) {
    setType(t);
    setContent(emptyContent(t));
    setMode('edit');
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!vaultKey || !type) return;
    if (!content.name.trim()) {
      setError('Le nom est requis.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const encryptedData = await encryptContent(vaultKey, content);
      if (item) {
        await api.updateVaultItem(item.id, { type, favorite, encryptedData });
      } else {
        await api.createVaultItem({ type, favorite, encryptedData });
      }
      onSaved();
    } catch (err) {
      setError(formatApiError(err, "Échec de l'enregistrement"));
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!item) return;
    setBusy(true);
    try {
      await api.deleteVaultItem(item.id);
      onDeleted();
    } catch (err) {
      toast.error(formatApiError(err, 'Échec de la suppression'));
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  // ---- Étape « choisir un type » (création) ----
  if (mode === 'pick') {
    return (
      <Modal title="Nouvel élément" onClose={onClose} size="sm">
        <p className="text-faint" style={{ marginTop: 0 }}>
          Quel type d'élément voulez-vous ajouter ?
        </p>
        <div className="type-picker">
          {VAULT_ITEM_TYPES.map(t => {
            const { label, Icon } = TYPE_META[t];
            return (
              <button key={t} type="button" className="type-pick-btn" onClick={() => pickType(t)}>
                <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </Modal>
    );
  }

  const t = type!;
  const fields = fieldsFor(t);
  const { Icon, label: typeLabel } = TYPE_META[t];

  // ---- Mode consultation ----
  if (mode === 'view' && item) {
    const titleRow = content.name || typeLabel;
    return (
      <>
      <Modal
        title={titleRow}
        onClose={onClose}
        size="md"
        footer={
          <>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              Supprimer
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setMode('edit')}>
              Modifier
            </button>
          </>
        }
      >
        <div className="item-view-head">
          <span className="item-type-chip">
            <Icon size={14} strokeWidth={1.75} aria-hidden="true" /> {typeLabel}
          </span>
          {item.favorite && (
            <span className="item-fav-chip">
              <Star size={13} aria-hidden="true" /> Favori
            </span>
          )}
        </div>

        <div className="item-view-fields">
          {fields.map(f => {
            const value = getField(content, f.path);
            if (!value) return null;
            if (f.path === 'login.totp') {
              return (
                <div className="item-view-row" key={f.path}>
                  <div className="item-view-label">Code 2FA</div>
                  <TotpField secret={value} />
                </div>
              );
            }
            return (
              <ViewRow
                key={f.path}
                label={f.label}
                value={value}
                secret={f.secret}
                isUrl={f.path === 'login.url' || f.path === 'apiKey.endpoint'}
              />
            );
          })}
          {content.notes && (
            <div className="item-view-row">
              <div className="item-view-label">Notes</div>
              <div className="item-view-notes">{content.notes}</div>
            </div>
          )}
        </div>
      </Modal>

      {confirmDelete && (
        <ConfirmDialog
          title="Supprimer l'élément"
          danger
          confirmLabel="Supprimer"
          message={<>Supprimer définitivement <strong>{content.name || typeLabel}</strong> ?</>}
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      </>
    );
  }

  // ---- Mode édition / création ----
  return (
    <>
    <Modal
      title={item ? 'Modifier l\'élément' : `Nouvel élément — ${typeLabel}`}
      onClose={onClose}
      size="md"
      preventClose={busy}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={item ? () => setMode('view') : onClose}
            disabled={busy}
          >
            Annuler
          </button>
          <button type="submit" form="vault-item-form" className="btn btn-primary" disabled={busy}>
            {busy && <SpinnerInline label="Enregistrement" />}
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id="vault-item-form" onSubmit={save} className="form">
        <div className="field">
          <label htmlFor="item-name">Nom</label>
          <input
            id="item-name"
            value={content.name}
            onChange={e => setContent({ ...content, name: e.target.value })}
            autoFocus
            required
            placeholder={typeLabel}
          />
        </div>

        {fields.map(f => (
          <EditField
            key={f.path}
            id={`item-${f.path.replace('.', '-')}`}
            label={f.label}
            value={getField(content, f.path)}
            secret={f.secret}
            multiline={f.multiline}
            onChange={v => setContent(setField(content, f.path, v))}
            onGenerate={f.generate ? () => setGeneratorField(f.path) : undefined}
          />
        ))}

        <div className="field">
          <label htmlFor="item-notes">Notes</label>
          <textarea
            id="item-notes"
            rows={t === 'NOTE' ? 8 : 3}
            value={content.notes}
            onChange={e => setContent({ ...content, notes: e.target.value })}
          />
        </div>

        <label className="item-fav-toggle">
          <input type="checkbox" checked={favorite} onChange={e => setFavorite(e.target.checked)} />
          <Star size={15} aria-hidden="true" />
          <span>Marquer comme favori</span>
        </label>

        {error && <div className="form-error" role="alert">{error}</div>}
      </form>
    </Modal>

    {generatorField && (
      <PasswordGenerator
        onClose={() => setGeneratorField(null)}
        onUse={v => {
          setContent(setField(content, generatorField, v));
          setGeneratorField(null);
        }}
      />
    )}
    </>
  );
}

// ---------------------------------------------------------------------------

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* presse-papiers indisponible */
    }
  }
  return (
    <button type="button" className="icon-btn" onClick={copy} aria-label="Copier" title="Copier">
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

function ViewRow({
  label,
  value,
  secret,
  isUrl,
}: {
  label: string;
  value: string;
  secret?: boolean;
  isUrl?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const shown = secret && !revealed ? '••••••••••••' : value;
  return (
    <div className="item-view-row">
      <div className="item-view-label">{label}</div>
      <div className="item-view-value">
        <span className={secret ? 'mono' : undefined}>{shown}</span>
        <div className="item-view-actions">
          {secret && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setRevealed(r => !r)}
              aria-label={revealed ? 'Masquer' : 'Afficher'}
              title={revealed ? 'Masquer' : 'Afficher'}
            >
              {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
          {isUrl && /^https?:\/\//i.test(value) && (
            <a
              className="icon-btn"
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Ouvrir le lien"
              title="Ouvrir"
            >
              <ExternalLink size={15} />
            </a>
          )}
          <CopyButton value={value} />
        </div>
      </div>
    </div>
  );
}

function EditField({
  id,
  label,
  value,
  secret,
  multiline,
  onChange,
  onGenerate,
}: {
  id: string;
  label: string;
  value: string;
  secret?: boolean;
  multiline?: boolean;
  onChange: (v: string) => void;
  onGenerate?: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea id={id} rows={3} value={value} onChange={e => onChange(e.target.value)} />
      ) : (
        <div className="input-with-toggle">
          <input
            id={id}
            type={secret && !revealed ? 'password' : 'text'}
            value={value}
            onChange={e => onChange(e.target.value)}
            autoComplete="off"
          />
          {secret && (
            <button
              type="button"
              className="btn btn-tiny btn-secondary"
              onClick={() => setRevealed(r => !r)}
              aria-pressed={revealed}
            >
              {revealed ? 'Masquer' : 'Afficher'}
            </button>
          )}
          {onGenerate && (
            <button type="button" className="btn btn-tiny btn-secondary" onClick={onGenerate}>
              Générer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
