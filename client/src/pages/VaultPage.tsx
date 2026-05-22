import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { Plus, Star, Search, Wand2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/StatusBadge';
import { PasswordGenerator } from '../components/PasswordGenerator';
import { formatApiError } from '../utils/format';
import { VaultItemModal } from './VaultItemModal';
import { decryptItem } from '../vault/crypto';
import { TYPE_META, itemSubtitle } from '../vault/meta';
import { VAULT_ITEM_TYPES } from '../vault/types';
import type { DecryptedItem, VaultItemType } from '../vault/types';

type Filter = 'ALL' | 'FAV' | VaultItemType;

export function VaultPage() {
  const { vaultKey } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<DecryptedItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalItem, setModalItem] = useState<DecryptedItem | null>(null);
  const [genOpen, setGenOpen] = useState(false);

  async function load() {
    if (!vaultKey) return;
    try {
      const records = await api.listVaultItems();
      const decrypted = await Promise.all(
        records.map(async r => {
          try {
            return await decryptItem(vaultKey, r);
          } catch {
            // Un blob illisible (clé incohérente, corruption) ne doit pas
            // faire échouer tout le chargement.
            return null;
          }
        }),
      );
      const ok = decrypted.filter((x): x is DecryptedItem => x !== null);
      if (ok.length < decrypted.length) {
        toast.error(`${decrypted.length - ok.length} élément(s) illisible(s) ignoré(s).`);
      }
      setItems(ok);
    } catch (e) {
      toast.error(formatApiError(e, 'Erreur lors du chargement de Lockey'));
      setItems([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultKey]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items.filter(it => {
      if (filter === 'FAV' && !it.favorite) return false;
      if (filter !== 'ALL' && filter !== 'FAV' && it.type !== filter) return false;
      if (!q) return true;
      const sub = itemSubtitle(it.type, it.content).toLowerCase();
      return it.content.name.toLowerCase().includes(q) || sub.includes(q);
    });
  }, [items, query, filter]);

  function openNew() {
    setModalItem(null);
    setModalOpen(true);
  }

  function openItem(it: DecryptedItem) {
    setModalItem(it);
    setModalOpen(true);
  }

  async function afterChange() {
    setModalOpen(false);
    await load();
  }

  async function toggleFav(it: DecryptedItem, e: SyntheticEvent) {
    e.stopPropagation();
    const next = !it.favorite;
    setItems(cur => cur?.map(x => (x.id === it.id ? { ...x, favorite: next } : x)) ?? null);
    try {
      await api.updateVaultItem(it.id, { favorite: next });
    } catch (err) {
      toast.error(formatApiError(err, 'Échec de la mise à jour'));
      setItems(cur => cur?.map(x => (x.id === it.id ? { ...x, favorite: !next } : x)) ?? null);
    }
  }

  const filters: { id: Filter; label: string }[] = [
    { id: 'ALL', label: 'Tous' },
    { id: 'FAV', label: 'Favoris' },
    ...VAULT_ITEM_TYPES.map(t => ({ id: t as Filter, label: TYPE_META[t].label })),
  ];

  return (
    <div className="page">
      <PageHeader
        title="Lockey"
        subtitle={items ? `${items.length} élément${items.length > 1 ? 's' : ''}` : undefined}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setGenOpen(true)}>
              <Wand2 size={16} strokeWidth={1.75} aria-hidden="true" /> Générateur
            </button>
            <button className="btn btn-primary" onClick={openNew}>
              <Plus size={16} strokeWidth={2} aria-hidden="true" /> Nouvel élément
            </button>
          </>
        }
      />

      <div className="vault-toolbar">
        <div className="vault-search">
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
          <input
            type="search"
            placeholder="Rechercher dans Lockey…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Rechercher"
          />
        </div>
        <div className="vault-filters" role="group" aria-label="Filtrer par type">
          {filters.map(f => (
            <button
              key={f.id}
              type="button"
              className={'chip' + (filter === f.id ? ' chip-active' : '')}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {items === null ? (
        <div className="empty">Chargement de Lockey…</div>
      ) : items.length === 0 ? (
        <div className="empty">
          <p>Votre Lockey est vide.</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={openNew}>
            <Plus size={16} aria-hidden="true" /> Ajouter un premier élément
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">Aucun élément ne correspond à votre recherche.</div>
      ) : (
        <ul className="vault-list">
          {filtered.map(it => {
            const { Icon } = TYPE_META[it.type];
            const subtitle = itemSubtitle(it.type, it.content);
            return (
              <li key={it.id}>
                <button type="button" className="vault-item" onClick={() => openItem(it)}>
                  <span className={`vault-item-icon vault-icon-${it.type.toLowerCase()}`}>
                    <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span className="vault-item-text">
                    <span className="vault-item-name">{it.content.name || '(sans nom)'}</span>
                    {subtitle && <span className="vault-item-sub">{subtitle}</span>}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    className={'vault-item-fav' + (it.favorite ? ' active' : '')}
                    aria-label={it.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                    aria-pressed={it.favorite}
                    onClick={e => toggleFav(it, e)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleFav(it, e);
                      }
                    }}
                  >
                    <Star size={16} aria-hidden="true" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {modalOpen && (
        <VaultItemModal
          item={modalItem}
          onClose={() => setModalOpen(false)}
          onSaved={afterChange}
          onDeleted={afterChange}
        />
      )}

      {genOpen && <PasswordGenerator onClose={() => setGenOpen(false)} />}
    </div>
  );
}
