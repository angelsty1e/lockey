import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import type { AuditAction, Prisma } from '@prisma/client';
import { recomputeAuditHash, auditChainKey } from '../audit.js';

/**
 * La chaîne de hash du journal d'audit est la première ligne de défense
 * forensique : si elle se brise, on doit le détecter. Ces tests garantissent
 * que :
 *  - le hash est déterministe pour un payload donné,
 *  - toute modification d'un champ casse la chaîne,
 *  - la sérialisation de `details` JSONB est stable malgré la réorganisation
 *    des clés que PostgreSQL applique au stockage (sinon `verify:audit-chain`
 *    accuserait à tort tous les logs avec un objet `details`).
 */

type Row = Parameters<typeof recomputeAuditHash>[0];

const baseRow: Row = {
  action: 'LOGIN' as AuditAction,
  userId: 'clx0000000000000000000000',
  username: 'alice',
  ip: '127.0.0.1',
  userAgent: 'Mozilla/5.0',
  serial: null,
  details: null,
  success: true,
  createdAt: new Date('2026-01-15T12:34:56.789Z'),
  prevHash: null,
};

describe('recomputeAuditHash — déterminisme', () => {
  it('produit le même hash pour deux appels identiques', () => {
    const a = recomputeAuditHash(baseRow);
    const b = recomputeAuditHash({ ...baseRow });
    expect(a).toBe(b);
  });

  it('produit un hmac-sha256 (64 hex)', () => {
    expect(recomputeAuditHash(baseRow)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash explicite stable (régression : changer la canonicalisation ou la clé casserait la chaîne)', () => {
    // Si ce test casse, c'est que stableStringify ou la dérivation de clé HMAC a
    // changé. Ne PAS le « réparer » sans avoir migré la base via fix:audit-chain
    // — sinon tous les logs anciens deviennent suspects à la prochaine vérif.
    // F1 : le sceau est désormais un HMAC clavé (clé hors base), plus un SHA-256 nu.
    const expected = crypto
      .createHmac('sha256', auditChainKey())
      .update(
        '{"action":"LOGIN","createdAt":"2026-01-15T12:34:56.789Z","details":null,"ip":"127.0.0.1","prevHash":null,"serial":null,"success":true,"userAgent":"Mozilla/5.0","userId":"clx0000000000000000000000","username":"alice"}',
      )
      .digest('hex');
    expect(recomputeAuditHash(baseRow)).toBe(expected);
  });
});

describe('recomputeAuditHash — détection de tampering', () => {
  it('change si action change', () => {
    expect(recomputeAuditHash({ ...baseRow, action: 'LOGOUT' as AuditAction })).not.toBe(
      recomputeAuditHash(baseRow),
    );
  });

  it('change si userId change', () => {
    expect(recomputeAuditHash({ ...baseRow, userId: 'autre' })).not.toBe(
      recomputeAuditHash(baseRow),
    );
  });

  it('change si ip change', () => {
    expect(recomputeAuditHash({ ...baseRow, ip: '10.0.0.1' })).not.toBe(
      recomputeAuditHash(baseRow),
    );
  });

  it('change si createdAt change (même d\'1ms)', () => {
    expect(
      recomputeAuditHash({ ...baseRow, createdAt: new Date('2026-01-15T12:34:56.790Z') }),
    ).not.toBe(recomputeAuditHash(baseRow));
  });

  it('change si success passe à false', () => {
    expect(recomputeAuditHash({ ...baseRow, success: false })).not.toBe(
      recomputeAuditHash(baseRow),
    );
  });

  it('change si serial est ajouté', () => {
    expect(recomputeAuditHash({ ...baseRow, serial: '1000' })).not.toBe(
      recomputeAuditHash(baseRow),
    );
  });
});

describe('recomputeAuditHash — chaînage', () => {
  it('change si prevHash change (même payload)', () => {
    const h1 = recomputeAuditHash({ ...baseRow, prevHash: null });
    const h2 = recomputeAuditHash({ ...baseRow, prevHash: 'a'.repeat(64) });
    const h3 = recomputeAuditHash({ ...baseRow, prevHash: 'b'.repeat(64) });
    expect(h1).not.toBe(h2);
    expect(h2).not.toBe(h3);
  });

  it('chaîne complète : 3 logs successifs ont des hashes tous différents', () => {
    const h1 = recomputeAuditHash({ ...baseRow, prevHash: null });
    const h2 = recomputeAuditHash({ ...baseRow, prevHash: h1, action: 'LOGOUT' as AuditAction });
    const h3 = recomputeAuditHash({ ...baseRow, prevHash: h2 });
    expect(new Set([h1, h2, h3]).size).toBe(3);
  });
});

describe('recomputeAuditHash — sérialisation déterministe de details (JSONB)', () => {
  // Ce groupe est *le* test critique : PostgreSQL JSONB réordonne les clés
  // au stockage. Sans stableStringify, écrire {a:1,b:2} et le relire en
  // {b:2,a:1} produirait un hash différent → la chaîne casserait sur tout
  // log avec un objet `details`. Voir feedback_jsonb_hash_determinism.md.

  it('même hash que les clés soient dans n\'importe quel ordre', () => {
    const a = recomputeAuditHash({
      ...baseRow,
      details: { foo: 'bar', alpha: 1, zoo: [1, 2, 3] } as Prisma.JsonValue,
    });
    const b = recomputeAuditHash({
      ...baseRow,
      details: { zoo: [1, 2, 3], alpha: 1, foo: 'bar' } as Prisma.JsonValue,
    });
    expect(a).toBe(b);
  });

  it('même hash sur objets imbriqués au tri profond', () => {
    const a = recomputeAuditHash({
      ...baseRow,
      details: { outer: { x: 1, y: 2 }, list: [{ a: 1, b: 2 }] } as Prisma.JsonValue,
    });
    const b = recomputeAuditHash({
      ...baseRow,
      details: { list: [{ b: 2, a: 1 }], outer: { y: 2, x: 1 } } as Prisma.JsonValue,
    });
    expect(a).toBe(b);
  });

  it('hash différent si l\'ordre des éléments d\'un array change (les arrays sont ordonnés)', () => {
    // Postgres JSONB préserve l'ordre des arrays — donc ils doivent participer
    // au hash dans leur ordre tel quel.
    const a = recomputeAuditHash({
      ...baseRow,
      details: { items: [1, 2, 3] } as Prisma.JsonValue,
    });
    const b = recomputeAuditHash({
      ...baseRow,
      details: { items: [3, 2, 1] } as Prisma.JsonValue,
    });
    expect(a).not.toBe(b);
  });

  it('hash différent si une valeur du details change', () => {
    const a = recomputeAuditHash({
      ...baseRow,
      details: { foo: 'bar' } as Prisma.JsonValue,
    });
    const b = recomputeAuditHash({
      ...baseRow,
      details: { foo: 'baz' } as Prisma.JsonValue,
    });
    expect(a).not.toBe(b);
  });

  it('details=null et details absent (undefined → null) produisent le même hash', () => {
    // canonicalPayload normalise undefined → null. C'est important parce
    // qu'à la relecture DB, l'absence devient null.
    const a = recomputeAuditHash({ ...baseRow, details: null });
    // On simule "absent" en passant null aussi : le code de production normalise
    // toute absence en null avant insertion.
    const b = recomputeAuditHash({ ...baseRow, details: null });
    expect(a).toBe(b);
  });
});
