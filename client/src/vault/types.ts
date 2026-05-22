/**
 * Types de Lockey.
 *
 * `VaultItemRecord` est la forme stockée/transmise par le serveur : tout est
 * opaque sauf `type` et `favorite`. `ItemContent` est la forme déchiffrée,
 * manipulée uniquement dans le navigateur.
 */

export type VaultItemType = 'LOGIN' | 'NOTE' | 'CARD' | 'IDENTITY' | 'API_KEY';

export const VAULT_ITEM_TYPES: VaultItemType[] = ['LOGIN', 'NOTE', 'CARD', 'IDENTITY', 'API_KEY'];

/** Enregistrement tel que renvoyé par l'API (contenu chiffré opaque). */
export interface VaultItemRecord {
  id: string;
  type: VaultItemType;
  favorite: boolean;
  encryptedData: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginData {
  username: string;
  password: string;
  url: string;
  /** Secret TOTP (clé 2FA) — l'affichage des codes en direct arrive en Phase 3. */
  totp: string;
}

export interface CardData {
  cardholder: string;
  number: string;
  brand: string;
  expMonth: string;
  expYear: string;
  cvv: string;
}

export interface IdentityData {
  fullName: string;
  email: string;
  phone: string;
  company: string;
  address: string;
}

export interface ApiKeyData {
  key: string;
  secret: string;
  endpoint: string;
}

/** Contenu déchiffré d'un élément. Sérialisé en JSON puis chiffré. */
export interface ItemContent {
  name: string;
  notes: string;
  login?: LoginData;
  card?: CardData;
  identity?: IdentityData;
  apiKey?: ApiKeyData;
}

/** Élément déchiffré, manipulé en mémoire dans l'application. */
export interface DecryptedItem {
  id: string;
  type: VaultItemType;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  content: ItemContent;
}

export function emptyContent(type: VaultItemType): ItemContent {
  const base: ItemContent = { name: '', notes: '' };
  switch (type) {
    case 'LOGIN':
      base.login = { username: '', password: '', url: '', totp: '' };
      break;
    case 'CARD':
      base.card = { cardholder: '', number: '', brand: '', expMonth: '', expYear: '', cvv: '' };
      break;
    case 'IDENTITY':
      base.identity = { fullName: '', email: '', phone: '', company: '', address: '' };
      break;
    case 'API_KEY':
      base.apiKey = { key: '', secret: '', endpoint: '' };
      break;
    case 'NOTE':
      break;
  }
  return base;
}
