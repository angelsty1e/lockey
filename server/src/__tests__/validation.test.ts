import { describe, it, expect } from 'vitest';
import {
  idSchema,
  loginSchema,
  userCreateSchema,
  vaultItemCreateSchema,
  vaultItemUpdateSchema,
  mfaEnableSchema,
  mfaDisableSchema,
  mfaRegenerateCodesSchema,
  mfaLoginVerifySchema,
} from '../validation.js';

describe('idSchema', () => {
  it('accepte les cuids et uuids', () => {
    expect(idSchema.safeParse('clx0abcdef0000abcdefghijk').success).toBe(true); // cuid-ish
    expect(idSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);
  });

  it('rejette les caractères dangereux', () => {
    expect(idSchema.safeParse('id with spaces').success).toBe(false);
    expect(idSchema.safeParse('../traverse').success).toBe(false);
    expect(idSchema.safeParse('id;DROP TABLE').success).toBe(false);
    expect(idSchema.safeParse('').success).toBe(false);
  });

  it('rejette une longueur > 64', () => {
    expect(idSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });
});

describe('loginSchema', () => {
  // `authHash` = base64 d'un PBKDF2 32 octets ; champ de 40 à 128 caractères.
  const authHash = 'a'.repeat(44);

  it('accepte un login valide', () => {
    expect(loginSchema.safeParse({ username: 'admin', authHash }).success).toBe(true);
  });

  it('rejette un username vide', () => {
    expect(loginSchema.safeParse({ username: '', authHash }).success).toBe(false);
  });

  it('rejette un authHash trop court', () => {
    expect(loginSchema.safeParse({ username: 'admin', authHash: 'short' }).success).toBe(false);
  });
});

describe('userCreateSchema', () => {
  // L'enum role est 'ADMIN' | 'USER'. Le compte est créé avec un `authHash`
  // zéro-connaissance (Lockey est initialisé à la 1re connexion).
  const base = { username: 'jdoe', authHash: 'a'.repeat(44), role: 'USER' as const };

  it('accepte les caractères autorisés', () => {
    expect(userCreateSchema.safeParse(base).success).toBe(true);
    expect(userCreateSchema.safeParse({ ...base, username: 'j.doe_1-2' }).success).toBe(true);
  });

  it('rejette les caractères interdits', () => {
    expect(userCreateSchema.safeParse({ ...base, username: 'j doe' }).success).toBe(false);
    expect(userCreateSchema.safeParse({ ...base, username: "j'doe" }).success).toBe(false);
  });

  it('exige un authHash', () => {
    const { authHash, ...withoutHash } = base;
    expect(userCreateSchema.safeParse(withoutHash).success).toBe(false);
  });
});

// ---------- Lockey (éléments chiffrés) ----------

describe('vaultItemCreateSchema', () => {
  const base = { type: 'LOGIN' as const, encryptedData: 'lk1:abcdef0123456789' };

  it('accepte un élément minimal', () => {
    expect(vaultItemCreateSchema.safeParse(base).success).toBe(true);
  });

  it('accepte le drapeau favorite', () => {
    expect(vaultItemCreateSchema.safeParse({ ...base, favorite: true }).success).toBe(true);
  });

  it('rejette un type inconnu', () => {
    expect(vaultItemCreateSchema.safeParse({ ...base, type: 'SSH' }).success).toBe(false);
  });

  it('accepte les cinq types pris en charge', () => {
    for (const type of ['LOGIN', 'NOTE', 'CARD', 'IDENTITY', 'API_KEY']) {
      expect(vaultItemCreateSchema.safeParse({ ...base, type }).success).toBe(true);
    }
  });

  it('exige un blob chiffré non vide', () => {
    expect(vaultItemCreateSchema.safeParse({ ...base, encryptedData: '' }).success).toBe(false);
    expect(vaultItemCreateSchema.safeParse({ type: 'NOTE' }).success).toBe(false);
  });
});

describe('vaultItemUpdateSchema', () => {
  it('accepte une mise à jour partielle', () => {
    expect(vaultItemUpdateSchema.safeParse({ favorite: true }).success).toBe(true);
    expect(vaultItemUpdateSchema.safeParse({ encryptedData: 'lk1:zzz' }).success).toBe(true);
    expect(vaultItemUpdateSchema.safeParse({}).success).toBe(true);
  });

  it('rejette un type inconnu', () => {
    expect(vaultItemUpdateSchema.safeParse({ type: 'SSH' }).success).toBe(false);
  });
});

// ---------- MFA ----------

describe('mfaEnableSchema', () => {
  it('accepte un code à 6 chiffres', () => {
    expect(mfaEnableSchema.safeParse({ code: '123456' }).success).toBe(true);
  });

  it('accepte un code avec espaces ou tirets', () => {
    expect(mfaEnableSchema.safeParse({ code: '123 456' }).success).toBe(true);
    expect(mfaEnableSchema.safeParse({ code: '123-456' }).success).toBe(true);
  });

  it('rejette un code contenant des lettres', () => {
    expect(mfaEnableSchema.safeParse({ code: '12345a' }).success).toBe(false);
  });

  it('rejette un code vide ou trop court', () => {
    expect(mfaEnableSchema.safeParse({ code: '' }).success).toBe(false);
    expect(mfaEnableSchema.safeParse({ code: '12345' }).success).toBe(false);
  });
});

describe('mfaDisableSchema', () => {
  const authHash = 'a'.repeat(44);

  it('accepte authHash + code', () => {
    expect(mfaDisableSchema.safeParse({ authHash, code: '123456' }).success).toBe(true);
  });

  it('exige le authHash', () => {
    expect(mfaDisableSchema.safeParse({ authHash: 'short', code: '123456' }).success).toBe(false);
  });

  it('exige le code', () => {
    expect(mfaDisableSchema.safeParse({ authHash, code: '' }).success).toBe(false);
  });
});

describe('mfaRegenerateCodesSchema', () => {
  it('accepte un code à 6 chiffres', () => {
    expect(mfaRegenerateCodesSchema.safeParse({ code: '123456' }).success).toBe(true);
  });
});

describe('mfaLoginVerifySchema (XOR code/backupCode)', () => {
  const token = 'eyJhbGc.fakejwt.signature';

  it('accepte mfaToken + code TOTP', () => {
    expect(mfaLoginVerifySchema.safeParse({ mfaToken: token, code: '123456' }).success).toBe(true);
  });

  it('accepte mfaToken + backupCode', () => {
    expect(
      mfaLoginVerifySchema.safeParse({ mfaToken: token, backupCode: 'abcd-1234' }).success,
    ).toBe(true);
  });

  it('rejette si on envoie code ET backupCode', () => {
    expect(
      mfaLoginVerifySchema.safeParse({
        mfaToken: token,
        code: '123456',
        backupCode: 'abcd-1234',
      }).success,
    ).toBe(false);
  });

  it('rejette si on n\'envoie ni code ni backupCode', () => {
    expect(mfaLoginVerifySchema.safeParse({ mfaToken: token }).success).toBe(false);
  });

  it('rejette un mfaToken vide', () => {
    expect(mfaLoginVerifySchema.safeParse({ mfaToken: '', code: '123456' }).success).toBe(false);
  });
});
