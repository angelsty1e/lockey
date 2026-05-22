import { describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import {
  generateTotpSecret,
  buildOtpauthUrl,
  verifyTotp,
  generateBackupCodes,
  normalizeBackupCode,
} from '../utils/mfa.js';

describe('generateTotpSecret', () => {
  it('produit un secret base32 non vide', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it('produit deux secrets différents (entropie)', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe('buildOtpauthUrl', () => {
  it('produit une URI otpauth valide avec issuer et compte', () => {
    const url = buildOtpauthUrl('JBSWY3DPEHPK3PXP', 'alice');
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain('alice');
    expect(url).toContain('Lockey'); // issuer
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
  });
});

describe('verifyTotp', () => {
  const secret = 'JBSWY3DPEHPK3PXP'; // RFC 6238 test secret

  it('accepte le code courant calculé par otplib', () => {
    const code = authenticator.generate(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it('accepte un code avec espaces', () => {
    const code = authenticator.generate(secret);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(secret, spaced)).toBe(true);
  });

  it('accepte un code avec tirets', () => {
    const code = authenticator.generate(secret);
    const dashed = `${code.slice(0, 3)}-${code.slice(3)}`;
    expect(verifyTotp(secret, dashed)).toBe(true);
  });

  it('rejette un code à 5 chiffres', () => {
    expect(verifyTotp(secret, '12345')).toBe(false);
  });

  it('rejette un code à 7 chiffres', () => {
    expect(verifyTotp(secret, '1234567')).toBe(false);
  });

  it('rejette un code contenant des lettres', () => {
    expect(verifyTotp(secret, '12345a')).toBe(false);
  });

  it('rejette un code vide', () => {
    expect(verifyTotp(secret, '')).toBe(false);
    expect(verifyTotp(secret, '   ')).toBe(false);
  });

  it('rejette un code 6 chiffres incorrect', () => {
    // 000000 a une probabilité ~1/10^6 d'être correct au moment du test ;
    // si le test devient flaky, c'est qu'on a perdu au loto, on relance.
    const wrong = '000000';
    const correct = authenticator.generate(secret);
    if (correct === wrong) return; // skip cas extrêmement improbable
    expect(verifyTotp(secret, wrong)).toBe(false);
  });
});

describe('generateBackupCodes', () => {
  it('génère exactement 8 codes', async () => {
    const { plain, hashes } = await generateBackupCodes();
    expect(plain).toHaveLength(8);
    expect(hashes).toHaveLength(8);
  });

  it('chaque code est au format xxxx-xxxx (alphabet sans 0/o/1/l/i)', async () => {
    const { plain } = await generateBackupCodes();
    for (const code of plain) {
      expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    }
  });

  it('les 8 codes sont uniques', async () => {
    const { plain } = await generateBackupCodes();
    expect(new Set(plain).size).toBe(8);
  });

  it('chaque hash valide le code en clair (normalisé) via bcrypt', async () => {
    const { plain, hashes } = await generateBackupCodes();
    for (let i = 0; i < plain.length; i++) {
      const ok = await bcrypt.compare(normalizeBackupCode(plain[i]), hashes[i]);
      expect(ok).toBe(true);
    }
  });

  it('un hash ne valide pas un autre code', async () => {
    const { plain, hashes } = await generateBackupCodes();
    const ok = await bcrypt.compare(normalizeBackupCode(plain[0]), hashes[1]);
    expect(ok).toBe(false);
  });
});

describe('normalizeBackupCode', () => {
  it('retire les tirets', () => {
    expect(normalizeBackupCode('abcd-efgh')).toBe('abcdefgh');
  });

  it('retire les espaces', () => {
    expect(normalizeBackupCode('abcd efgh')).toBe('abcdefgh');
    expect(normalizeBackupCode('  ab cd-ef gh  ')).toBe('abcdefgh');
  });

  it('passe en lowercase', () => {
    expect(normalizeBackupCode('ABCD-EFGH')).toBe('abcdefgh');
    expect(normalizeBackupCode('AbCd-EfGh')).toBe('abcdefgh');
  });

  it('rend la chaîne déjà normalisée intacte', () => {
    expect(normalizeBackupCode('abcd1234')).toBe('abcd1234');
  });
});
