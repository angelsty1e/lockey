/**
 * Chiffrement/déchiffrement des éléments Lockey.
 *
 * Le contenu d'un élément (`ItemContent`) est sérialisé en JSON puis chiffré
 * avec la clé de chiffrement AES-256-GCM. Le serveur ne reçoit que le blob.
 */
import { encryptString, decryptString } from '../crypto/zk';
import type { ItemContent, DecryptedItem, VaultItemRecord } from './types';

export async function encryptContent(vaultKey: CryptoKey, content: ItemContent): Promise<string> {
  return encryptString(vaultKey, JSON.stringify(content));
}

export async function decryptContent(vaultKey: CryptoKey, blob: string): Promise<ItemContent> {
  const parsed = JSON.parse(await decryptString(vaultKey, blob)) as ItemContent;
  // Normalise les champs potentiellement absents.
  return { name: '', notes: '', ...parsed };
}

/** Déchiffre un enregistrement serveur en élément exploitable. */
export async function decryptItem(
  vaultKey: CryptoKey,
  record: VaultItemRecord,
): Promise<DecryptedItem> {
  return {
    id: record.id,
    type: record.type,
    favorite: record.favorite,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    content: await decryptContent(vaultKey, record.encryptedData),
  };
}
