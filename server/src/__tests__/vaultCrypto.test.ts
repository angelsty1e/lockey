import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  vaultEncrypt,
  vaultDecrypt,
  vaultBlobVersion,
  vaultIsConfigured,
} from '../utils/vaultCrypto.js';

/**
 * Tests crypto-sensibles : un round-trip cassé ou un auth-tag mal vérifié
 * fait perdre toutes les données stockées (ou pire, accepte un ciphertext
 * forgé). Ces tests sont la première ligne de défense.
 */

describe('vaultCrypto — round-trip v2', () => {
  it('encrypt → decrypt rend le plaintext original', () => {
    const blob = vaultEncrypt('hello world');
    expect(vaultDecrypt(blob)).toBe('hello world');
  });

  it('produit un blob au format vault:v2:<iv>:<tag>:<ct>', () => {
    const blob = vaultEncrypt('x');
    const parts = blob.split(':');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('vault');
    expect(parts[1]).toBe('v2');
    expect(parts[2]).toMatch(/^[0-9a-f]{24}$/); // IV 12 octets = 24 hex
    expect(parts[3]).toMatch(/^[0-9a-f]{32}$/); // tag GCM 16 octets = 32 hex
    expect(parts[4]).toMatch(/^[0-9a-f]+$/);
  });

  it('produit deux blobs différents pour le même plaintext (IV aléatoire)', () => {
    const a = vaultEncrypt('same');
    const b = vaultEncrypt('same');
    expect(a).not.toBe(b);
    expect(vaultDecrypt(a)).toBe('same');
    expect(vaultDecrypt(b)).toBe('same');
  });

  it('gère les chaînes vides', () => {
    const blob = vaultEncrypt('');
    expect(vaultDecrypt(blob)).toBe('');
  });

  it('gère l\'unicode (emoji, accents, CJK)', () => {
    const original = 'café 🔐 中文 — passe-phrase à étaler';
    const blob = vaultEncrypt(original);
    expect(vaultDecrypt(blob)).toBe(original);
  });

  it('gère un long secret (clé PEM ~3KB)', () => {
    const big = 'A'.repeat(3000);
    const blob = vaultEncrypt(big);
    expect(vaultDecrypt(blob)).toBe(big);
  });
});

describe('vaultCrypto — auth tag (anti-tampering)', () => {
  it('throw si le ciphertext est modifié', () => {
    const blob = vaultEncrypt('secret');
    const parts = blob.split(':');
    // Flip le dernier octet du ciphertext.
    const tampered = parts[4].slice(0, -2) + (parts[4].slice(-2) === 'ff' ? '00' : 'ff');
    parts[4] = tampered;
    expect(() => vaultDecrypt(parts.join(':'))).toThrow();
  });

  it('throw si le tag est modifié', () => {
    const blob = vaultEncrypt('secret');
    const parts = blob.split(':');
    parts[3] = '0'.repeat(32); // tag forgé à zéro
    expect(() => vaultDecrypt(parts.join(':'))).toThrow();
  });

  it('throw si l\'IV est modifié', () => {
    const blob = vaultEncrypt('secret');
    const parts = blob.split(':');
    parts[2] = '0'.repeat(24); // IV forgé à zéro
    expect(() => vaultDecrypt(parts.join(':'))).toThrow();
  });
});

describe('vaultCrypto — format', () => {
  it('throw sur un blob de format invalide', () => {
    expect(() => vaultDecrypt('pas un blob')).toThrow(/format/);
    expect(() => vaultDecrypt('vault:v2:trop:peu')).toThrow(/format/);
    expect(() => vaultDecrypt('notvault:v2:a:b:c')).toThrow(/format/);
  });

  it('throw sur une version inconnue', () => {
    // Forge un blob bien formé mais avec version v99 inconnue.
    const blob = vaultEncrypt('x');
    const parts = blob.split(':');
    parts[1] = 'v99';
    expect(() => vaultDecrypt(parts.join(':'))).toThrow(/version/);
  });
});

describe('vaultCrypto — lecture v1 legacy', () => {
  // Reproduit l'algorithme v1 (HKDF info=vide) localement pour générer un blob
  // "ancien format" et vérifier que vaultDecrypt sait le lire — sinon les
  // installations qui n'ont pas tourné `migrate:crypto-v2` perdent leurs données.
  function encryptV1(plaintext: string, masterKey: string): string {
    const salt = Buffer.from('lockey:vault:v1');
    const key = Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, Buffer.alloc(0), 32));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `vault:v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  it('décode un blob v1 produit avec la même master key', () => {
    const masterKey = process.env.VAULT_MASTER_KEY!;
    const blob = encryptV1('legacy-secret', masterKey);
    expect(blob.startsWith('vault:v1:')).toBe(true);
    expect(vaultDecrypt(blob)).toBe('legacy-secret');
  });
});

describe('vaultBlobVersion', () => {
  it('extrait la version depuis un blob valide', () => {
    expect(vaultBlobVersion(vaultEncrypt('x'))).toBe('v2');
  });

  it('renvoie null sur format invalide', () => {
    expect(vaultBlobVersion('pas un blob')).toBeNull();
    expect(vaultBlobVersion('vault:v2:trop:peu')).toBeNull();
    expect(vaultBlobVersion('notvault:v2:a:b:c')).toBeNull();
  });
});

describe('vaultIsConfigured', () => {
  it('renvoie true quand VAULT_MASTER_KEY est défini', () => {
    // Posé par setup.ts.
    expect(vaultIsConfigured()).toBe(true);
  });
});
