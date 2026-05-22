import crypto from 'node:crypto';
import { env } from '../env.js';

/**
 * AES-256-GCM symmetric encryption for vault secrets (server passwords, SSH
 * private keys, passphrases) at rest.
 *
 * Deux formats coexistent en lecture pour la migration :
 *   - `vault:v1:<iv>:<tag>:<ct>`  HKDF info=vide   (legacy)
 *   - `vault:v2:<iv>:<tag>:<ct>`  HKDF info=domain-separator (préféré, RFC 5869)
 *
 * Le chiffrement se fait toujours en v2. Pour migrer les anciens secrets
 * v1 vers v2, lancer `npm run migrate:crypto-v2`.
 *
 * Le master key est lu via VAULT_MASTER_KEY (env). Rotater VAULT_MASTER_KEY
 * invalide tous les secrets stockés — sauvegarder avant rotation.
 */

const SALT_V1 = Buffer.from('lockey:vault:v1');
const SALT_V2 = Buffer.from('lockey:vault:v2');
const INFO_V2 = Buffer.from('lockey:vault-key:v2');
const KEY_LENGTH = 32;

let cachedV1: Buffer | null = null;
let cachedV2: Buffer | null = null;

function ensureMaster(): string {
  if (!env.VAULT_MASTER_KEY) {
    throw new Error('VAULT_MASTER_KEY non configuré : impossible d\'utiliser le chiffrement serveur');
  }
  return env.VAULT_MASTER_KEY;
}

function keyV1(): Buffer {
  if (cachedV1) return cachedV1;
  cachedV1 = Buffer.from(
    crypto.hkdfSync('sha256', ensureMaster(), SALT_V1, Buffer.alloc(0), KEY_LENGTH),
  );
  return cachedV1;
}

function keyV2(): Buffer {
  if (cachedV2) return cachedV2;
  cachedV2 = Buffer.from(
    crypto.hkdfSync('sha256', ensureMaster(), SALT_V2, INFO_V2, KEY_LENGTH),
  );
  return cachedV2;
}

export function vaultEncrypt(plaintext: string): string {
  const key = keyV2();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `vault:v2:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function vaultDecrypt(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 5 || parts[0] !== 'vault') {
    throw new Error('format de chiffrement vault invalide');
  }
  let key: Buffer;
  if (parts[1] === 'v1') key = keyV1();
  else if (parts[1] === 'v2') key = keyV2();
  else throw new Error(`version de chiffrement vault inconnue: ${parts[1]}`);
  const iv = Buffer.from(parts[2], 'hex');
  const tag = Buffer.from(parts[3], 'hex');
  const data = Buffer.from(parts[4], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Renvoie la version stockée (v1, v2, …) pour audit / migration. */
export function vaultBlobVersion(blob: string): string | null {
  const parts = blob.split(':');
  if (parts.length !== 5 || parts[0] !== 'vault') return null;
  return parts[1] || null;
}

export function vaultIsConfigured(): boolean {
  return !!env.VAULT_MASTER_KEY;
}
