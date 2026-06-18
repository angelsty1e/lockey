import crypto from 'node:crypto';
import { env } from '../env.js';

/**
 * AES-256-GCM symmetric encryption for SMTP passwords stored in DB.
 *
 * Trois formats coexistent en lecture pour la migration :
 *   - `gcm:v1:<iv>:<tag>:<ct>`  key derived from JWT_SECRET (legacy, info vide)
 *   - `gcm:v2:<iv>:<tag>:<ct>`  key derived from SMTP_ENCRYPTION_KEY, info vide
 *   - `gcm:v3:<iv>:<tag>:<ct>`  key derived from SMTP_ENCRYPTION_KEY + INFO HKDF
 *                               (préféré, domain-separator RFC 5869)
 *
 * Encryption :
 *   - SMTP_ENCRYPTION_KEY défini → v3 (seul format écrit)
 *   - SMTP_ENCRYPTION_KEY absent → ÉCHEC (F3). On NE chiffre plus jamais avec la
 *     clé dérivée de JWT_SECRET : ça mélangeait l'usage « signature de session »
 *     et « chiffrement au repos », et une rotation de JWT_SECRET rendait alors
 *     le mot de passe SMTP silencieusement indéchiffrable.
 *
 * Les blobs `gcm:v1` (legacy, JWT_SECRET) restent lisibles en DÉCHIFFREMENT
 * pour les installations historiques — re-sauver le mot de passe les migre en v3.
 */

const SALT_V1 = Buffer.from('lockey:smtp-encryption:v1');
const SALT_V2 = Buffer.from('lockey:smtp-encryption:v2');
const SALT_V3 = Buffer.from('lockey:smtp-encryption:v3');
const INFO_V3 = Buffer.from('lockey:smtp-key:v3');
const KEY_LENGTH = 32; // AES-256

let cachedV1: Buffer | null = null;
let cachedV2: Buffer | null = null;
let cachedV3: Buffer | null = null;

function keyV1(): Buffer {
  if (cachedV1) return cachedV1;
  cachedV1 = Buffer.from(
    crypto.hkdfSync('sha256', env.JWT_SECRET, SALT_V1, Buffer.alloc(0), KEY_LENGTH),
  );
  return cachedV1;
}

function keyV2(): Buffer | null {
  if (!env.SMTP_ENCRYPTION_KEY) return null;
  if (cachedV2) return cachedV2;
  cachedV2 = Buffer.from(
    crypto.hkdfSync('sha256', env.SMTP_ENCRYPTION_KEY, SALT_V2, Buffer.alloc(0), KEY_LENGTH),
  );
  return cachedV2;
}

function keyV3(): Buffer | null {
  if (!env.SMTP_ENCRYPTION_KEY) return null;
  if (cachedV3) return cachedV3;
  cachedV3 = Buffer.from(
    crypto.hkdfSync('sha256', env.SMTP_ENCRYPTION_KEY, SALT_V3, INFO_V3, KEY_LENGTH),
  );
  return cachedV3;
}

/** True si le chiffrement SMTP « propre » (v3, clé dédiée) est disponible. */
export function smtpEncryptionConfigured(): boolean {
  return !!env.SMTP_ENCRYPTION_KEY;
}

export function encryptSmtpPass(plaintext: string): string {
  const v3 = keyV3();
  if (!v3) {
    // F3 : on refuse de retomber sur la clé dérivée de JWT_SECRET (v1).
    throw new Error(
      'SMTP_ENCRYPTION_KEY non configuré : impossible de chiffrer un mot de passe SMTP. ' +
        'Générez-la avec `openssl rand -base64 32` et posez-la dans l\'environnement.',
    );
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', v3, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm:v3:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSmtpPass(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 5 || parts[0] !== 'gcm') {
    throw new Error('format de chiffrement SMTP invalide');
  }
  let key: Buffer;
  if (parts[1] === 'v1') key = keyV1();
  else if (parts[1] === 'v2') {
    const v2 = keyV2();
    if (!v2) throw new Error('SMTP_ENCRYPTION_KEY requis pour déchiffrer ce mot de passe (gcm:v2)');
    key = v2;
  } else if (parts[1] === 'v3') {
    const v3 = keyV3();
    if (!v3) throw new Error('SMTP_ENCRYPTION_KEY requis pour déchiffrer ce mot de passe (gcm:v3)');
    key = v3;
  } else {
    throw new Error(`version de chiffrement SMTP inconnue: ${parts[1]}`);
  }
  const iv = Buffer.from(parts[2], 'hex');
  const tag = Buffer.from(parts[3], 'hex');
  const data = Buffer.from(parts[4], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Renvoie la version stockée (v1, v2, v3) pour audit / migration. */
export function smtpBlobVersion(blob: string): string | null {
  const parts = blob.split(':');
  if (parts.length !== 5 || parts[0] !== 'gcm') return null;
  return parts[1] || null;
}
