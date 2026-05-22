import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  signJwt,
  verifyJwt,
  signMfaChallenge,
  verifyMfaChallenge,
  hashPassword,
  comparePassword,
} from '../auth.js';

/**
 * Tests des primitives d'authentification. La vérification effective
 * (requireAuth/...) dépend de Prisma et n'est pas couverte ici
 * — voir les tests d'intégration HTTP. Ce fichier garantit que :
 *  - les JWT de session et les MFA challenges ne se mélangent pas,
 *  - bcrypt fait son boulot (cost ≥ 10 enforce le minimum).
 */

describe('signJwt / verifyJwt — round-trip session', () => {
  it('signature → vérification rend le payload', () => {
    const token = signJwt({ sub: 'user-1', username: 'alice', tv: 0 });
    const decoded = verifyJwt(token);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.username).toBe('alice');
    expect(decoded.tv).toBe(0);
  });

  it('rejette un JWT signé avec une autre clé', () => {
    const forged = jwt.sign({ sub: 'user-1', username: 'alice', tv: 0 }, 'autre-clé-suffisamment-longue-32-chars');
    expect(() => verifyJwt(forged)).toThrow();
  });

  it('rejette un JWT corrompu', () => {
    const token = signJwt({ sub: 'user-1', username: 'alice', tv: 0 });
    const tampered = token.slice(0, -4) + 'xxxx';
    expect(() => verifyJwt(tampered)).toThrow();
  });

  it('rejette une chaîne qui n\'est pas un JWT', () => {
    expect(() => verifyJwt('pas-un-jwt')).toThrow();
    expect(() => verifyJwt('')).toThrow();
  });
});

describe('signMfaChallenge / verifyMfaChallenge — séparation challenges/sessions', () => {
  it('round-trip : pose stage=mfa et le restitue', () => {
    const token = signMfaChallenge({ sub: 'user-1', tv: 0 });
    const decoded = verifyMfaChallenge(token);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.stage).toBe('mfa');
    expect(decoded.tv).toBe(0);
  });

  it('rejette un JWT de session normal présenté comme challenge MFA', () => {
    // C'est le test critique : un challenge MFA accepté à la place d'un JWT
    // de session permettrait à l'attaquant de skip l'étape mdp.
    const session = signJwt({ sub: 'user-1', username: 'alice', tv: 0 });
    expect(() => verifyMfaChallenge(session)).toThrow(/MFA challenge/);
  });

  it('verifyJwt accepte un challenge MFA — c\'est verifyMfaChallenge qui filtre via stage', () => {
    // Note : verifyJwt ne re-filtre PAS le stage — la garde de cohérence
    // est dans verifyMfaChallenge qui rejette tout token sans stage='mfa'.
    // Le filtrage inverse (rejeter un challenge MFA dans verifyJwt) est
    // assuré au niveau routes via la séparation des endpoints.
    const challenge = signMfaChallenge({ sub: 'user-1', tv: 0 });
    expect(() => verifyJwt(challenge)).not.toThrow();
  });

  it('rejette un challenge MFA signé avec une autre clé', () => {
    const forged = jwt.sign(
      { sub: 'user-1', tv: 0, stage: 'mfa' },
      'autre-clé-suffisamment-longue-32-chars',
    );
    expect(() => verifyMfaChallenge(forged)).toThrow();
  });
});

describe('hashPassword / comparePassword (bcrypt)', () => {
  it('round-trip : un hash valide le mot de passe', async () => {
    const hash = await hashPassword('p4ssw0rd-très-long');
    expect(await comparePassword('p4ssw0rd-très-long', hash)).toBe(true);
  });

  it('rejette un mauvais mot de passe', async () => {
    const hash = await hashPassword('p4ssw0rd');
    expect(await comparePassword('p5ssw0rd', hash)).toBe(false);
  });

  it('produit un hash différent à chaque appel (salt aléatoire)', async () => {
    const a = await hashPassword('même');
    const b = await hashPassword('même');
    expect(a).not.toBe(b);
    expect(await comparePassword('même', a)).toBe(true);
    expect(await comparePassword('même', b)).toBe(true);
  });

  it('le hash est au format bcrypt $2b$ avec cost ≥ 10', () => {
    // Cost 12 dans hashPassword. Si quelqu'un baisse à 4 pour « accélérer
    // les tests », ce test casse. Voir security-best-practices.
    return hashPassword('x').then(hash => {
      const m = hash.match(/^\$2[aby]\$(\d{2})\$/);
      expect(m).not.toBeNull();
      expect(parseInt(m![1], 10)).toBeGreaterThanOrEqual(10);
    });
  });
});
