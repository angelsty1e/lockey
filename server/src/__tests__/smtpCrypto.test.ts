import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  encryptSmtpPass,
  decryptSmtpPass,
  smtpBlobVersion,
} from '../utils/smtpCrypto.js';

/**
 * Tests crypto-sensibles (jumeau de vaultCrypto) : un round-trip cassé fait
 * que les SMTP password stockés deviennent illisibles, et un auth-tag mal
 * vérifié accepterait des ciphertexts forgés. Couvre :
 *  - round-trip v3 (production : SMTP_ENCRYPTION_KEY défini → cf. setup.ts)
 *  - lecture v2 legacy (SMTP_ENCRYPTION_KEY, info HKDF vide)
 *  - lecture v1 legacy (JWT_SECRET-derived, info HKDF vide)
 *  - tampering ciphertext / tag / IV → throw
 *  - format errors
 */

const SALT_V1 = Buffer.from('lockey:smtp-encryption:v1');
const SALT_V2 = Buffer.from('lockey:smtp-encryption:v2');
const KEY_LENGTH = 32;

function forgeBlob(version: 'v1' | 'v2', plaintext: string, sourceKey: string, salt: Buffer): string {
  const key = Buffer.from(crypto.hkdfSync('sha256', sourceKey, salt, Buffer.alloc(0), KEY_LENGTH));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm:${version}:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

describe('smtpCrypto — round-trip v3 (production)', () => {
  it('encrypt → decrypt rend le plaintext original', () => {
    const blob = encryptSmtpPass('s3cr3t-smtp');
    expect(decryptSmtpPass(blob)).toBe('s3cr3t-smtp');
  });

  it('produit du v3 quand SMTP_ENCRYPTION_KEY est défini (cf. setup.ts)', () => {
    const blob = encryptSmtpPass('x');
    expect(blob.startsWith('gcm:v3:')).toBe(true);
  });

  it('format gcm:v3:<iv>:<tag>:<ct>', () => {
    const blob = encryptSmtpPass('x');
    const parts = blob.split(':');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('gcm');
    expect(parts[1]).toBe('v3');
    expect(parts[2]).toMatch(/^[0-9a-f]{24}$/); // IV 12 octets
    expect(parts[3]).toMatch(/^[0-9a-f]{32}$/); // tag GCM 16 octets
    expect(parts[4]).toMatch(/^[0-9a-f]+$/);
  });

  it('IV aléatoire — deux blobs différents pour le même plaintext', () => {
    const a = encryptSmtpPass('même');
    const b = encryptSmtpPass('même');
    expect(a).not.toBe(b);
    expect(decryptSmtpPass(a)).toBe('même');
    expect(decryptSmtpPass(b)).toBe('même');
  });

  it('gère unicode et chaînes vides', () => {
    expect(decryptSmtpPass(encryptSmtpPass(''))).toBe('');
    expect(decryptSmtpPass(encryptSmtpPass('café 🔐 中文'))).toBe('café 🔐 中文');
  });

  it('gère un long mot de passe (1KB)', () => {
    const big = 'P'.repeat(1024);
    expect(decryptSmtpPass(encryptSmtpPass(big))).toBe(big);
  });
});

describe('smtpCrypto — lecture v2 legacy', () => {
  // v2 = SMTP_ENCRYPTION_KEY mais sans INFO HKDF. Forgé manuellement parce
  // qu'on ne peut plus produire ce format (encryptSmtpPass écrit toujours v3
  // quand SMTP_ENCRYPTION_KEY est posé).
  it('décode un blob v2 produit avec la même SMTP_ENCRYPTION_KEY', () => {
    const key = process.env.SMTP_ENCRYPTION_KEY!;
    const blob = forgeBlob('v2', 'legacy-v2', key, SALT_V2);
    expect(blob.startsWith('gcm:v2:')).toBe(true);
    expect(decryptSmtpPass(blob)).toBe('legacy-v2');
  });
});

describe('smtpCrypto — lecture v1 legacy', () => {
  // v1 = JWT_SECRET-derived. Forgé manuellement : si SMTP_ENCRYPTION_KEY est
  // posé, encryptSmtpPass ne produit jamais v1. Mais en lecture, v1 doit
  // toujours fonctionner sinon les installations qui n'ont pas tourné
  // migrate:crypto-v2 perdent leurs SMTP credentials.
  it('décode un blob v1 produit avec JWT_SECRET', () => {
    const jwtSecret = process.env.JWT_SECRET!;
    const blob = forgeBlob('v1', 'legacy-v1', jwtSecret, SALT_V1);
    expect(blob.startsWith('gcm:v1:')).toBe(true);
    expect(decryptSmtpPass(blob)).toBe('legacy-v1');
  });
});

describe('smtpCrypto — auth tag (anti-tampering)', () => {
  it('throw si le ciphertext est modifié', () => {
    const blob = encryptSmtpPass('secret');
    const parts = blob.split(':');
    const tampered = parts[4].slice(0, -2) + (parts[4].slice(-2) === 'ff' ? '00' : 'ff');
    parts[4] = tampered;
    expect(() => decryptSmtpPass(parts.join(':'))).toThrow();
  });

  it('throw si le tag est modifié', () => {
    const blob = encryptSmtpPass('secret');
    const parts = blob.split(':');
    parts[3] = '0'.repeat(32);
    expect(() => decryptSmtpPass(parts.join(':'))).toThrow();
  });

  it('throw si l\'IV est modifié', () => {
    const blob = encryptSmtpPass('secret');
    const parts = blob.split(':');
    parts[2] = '0'.repeat(24);
    expect(() => decryptSmtpPass(parts.join(':'))).toThrow();
  });
});

describe('smtpCrypto — format', () => {
  it('throw sur format invalide', () => {
    expect(() => decryptSmtpPass('pas un blob')).toThrow(/format/);
    expect(() => decryptSmtpPass('gcm:v3:trop:peu')).toThrow(/format/);
    expect(() => decryptSmtpPass('notgcm:v3:a:b:c')).toThrow(/format/);
  });

  it('throw sur version inconnue', () => {
    const blob = encryptSmtpPass('x');
    const parts = blob.split(':');
    parts[1] = 'v99';
    expect(() => decryptSmtpPass(parts.join(':'))).toThrow(/version/);
  });
});

describe('smtpBlobVersion', () => {
  it('extrait la version depuis un blob v3', () => {
    expect(smtpBlobVersion(encryptSmtpPass('x'))).toBe('v3');
  });

  it('extrait v1 et v2 depuis des blobs forgés', () => {
    const v1 = forgeBlob('v1', 'x', process.env.JWT_SECRET!, SALT_V1);
    const v2 = forgeBlob('v2', 'x', process.env.SMTP_ENCRYPTION_KEY!, SALT_V2);
    expect(smtpBlobVersion(v1)).toBe('v1');
    expect(smtpBlobVersion(v2)).toBe('v2');
  });

  it('renvoie null sur format invalide', () => {
    expect(smtpBlobVersion('pas un blob')).toBeNull();
    expect(smtpBlobVersion('gcm:v3:trop:peu')).toBeNull();
    expect(smtpBlobVersion('notgcm:v3:a:b:c')).toBeNull();
  });
});
