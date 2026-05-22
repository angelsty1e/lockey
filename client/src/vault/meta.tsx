import { Globe, FileText, CreditCard, Contact, Code2, type LucideIcon } from 'lucide-react';
import type { VaultItemType, ItemContent } from './types';

export interface FieldDef {
  /** Chemin dans `ItemContent` : 'name', 'notes', ou 'login.password'. */
  path: string;
  label: string;
  /** Champ sensible : masqué par défaut, dévoilable. */
  secret?: boolean;
  multiline?: boolean;
  /** Propose le générateur de mots de passe sur ce champ. */
  generate?: boolean;
}

export const TYPE_META: Record<VaultItemType, { label: string; Icon: LucideIcon }> = {
  LOGIN: { label: 'Identifiant', Icon: Globe },
  NOTE: { label: 'Note sécurisée', Icon: FileText },
  CARD: { label: 'Carte bancaire', Icon: CreditCard },
  IDENTITY: { label: 'Identité', Icon: Contact },
  API_KEY: { label: 'Clé API', Icon: Code2 },
};

const FIELDS: Record<VaultItemType, FieldDef[]> = {
  LOGIN: [
    { path: 'login.username', label: 'Identifiant' },
    { path: 'login.password', label: 'Mot de passe', secret: true, generate: true },
    { path: 'login.url', label: 'Adresse du site' },
    { path: 'login.totp', label: 'Clé 2FA (TOTP)', secret: true },
  ],
  NOTE: [],
  CARD: [
    { path: 'card.cardholder', label: 'Titulaire' },
    { path: 'card.number', label: 'Numéro de carte', secret: true },
    { path: 'card.brand', label: 'Réseau (Visa, Mastercard…)' },
    { path: 'card.expMonth', label: "Mois d'expiration" },
    { path: 'card.expYear', label: "Année d'expiration" },
    { path: 'card.cvv', label: 'Cryptogramme (CVV)', secret: true },
  ],
  IDENTITY: [
    { path: 'identity.fullName', label: 'Nom complet' },
    { path: 'identity.email', label: 'Email' },
    { path: 'identity.phone', label: 'Téléphone' },
    { path: 'identity.company', label: 'Société' },
    { path: 'identity.address', label: 'Adresse', multiline: true },
  ],
  API_KEY: [
    { path: 'apiKey.key', label: 'Clé / identifiant' },
    { path: 'apiKey.secret', label: 'Secret', secret: true },
    { path: 'apiKey.endpoint', label: 'Endpoint / URL' },
  ],
};

export function fieldsFor(type: VaultItemType): FieldDef[] {
  return FIELDS[type];
}

/** Lit un champ (chemin à 1 ou 2 niveaux) sous forme de chaîne. */
export function getField(content: ItemContent, path: string): string {
  const [a, b] = path.split('.');
  const obj = content as unknown as Record<string, unknown>;
  if (b === undefined) {
    return typeof obj[a] === 'string' ? (obj[a] as string) : '';
  }
  const sub = obj[a] as Record<string, unknown> | undefined;
  return typeof sub?.[b] === 'string' ? (sub[b] as string) : '';
}

/** Renvoie une copie de `content` avec le champ mis à jour. */
export function setField(content: ItemContent, path: string, value: string): ItemContent {
  const next = JSON.parse(JSON.stringify(content)) as ItemContent;
  const [a, b] = path.split('.');
  const obj = next as unknown as Record<string, unknown>;
  if (b === undefined) {
    obj[a] = value;
  } else {
    const sub = (obj[a] as Record<string, unknown> | undefined) ?? {};
    sub[b] = value;
    obj[a] = sub;
  }
  return next;
}

/** Sous-titre affiché dans la liste Lockey. */
export function itemSubtitle(type: VaultItemType, content: ItemContent): string {
  switch (type) {
    case 'LOGIN':
      return getField(content, 'login.username') || getField(content, 'login.url');
    case 'CARD': {
      const n = getField(content, 'card.number').replace(/\s/g, '');
      return n ? `•••• ${n.slice(-4)}` : getField(content, 'card.cardholder');
    }
    case 'IDENTITY':
      return getField(content, 'identity.email') || getField(content, 'identity.fullName');
    case 'API_KEY':
      return getField(content, 'apiKey.endpoint') || getField(content, 'apiKey.key');
    case 'NOTE':
      return content.notes.split('\n')[0] || '';
  }
}
