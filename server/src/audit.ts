import crypto from 'node:crypto';
import type { Request } from 'express';
import type { AuditAction, Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Clé HMAC du chaînage d'audit — détenue HORS de la base (F1).
 *
 * Avant : `hash = SHA256(prevHash || payload)`, non clavé. Toutes les entrées
 * étant en clair en DB, quiconque obtenait un accès *write* Postgres pouvait
 * altérer une ligne puis recalculer toute la chaîne avec l'algorithme public
 * (le « tamper-evident » revendiqué était illusoire dans son propre modèle de
 * menace).
 *
 * Maintenant : `hash = HMAC-SHA256(key, prevHash || payload)` où `key` n'est
 * jamais en base. Sans la clé, recalculer la chaîne est infaisable.
 *   - `AUDIT_HMAC_KEY` si fournie (recommandé : découple la rotation de session
 *     de l'intégrité d'audit),
 *   - sinon dérivée de `JWT_SECRET` par HKDF (domain-separated) — toujours hors
 *     base, mais une rotation de JWT_SECRET invalide alors la vérification
 *     historique (à re-sceller via `fix:audit-chain`).
 */
let cachedAuditKey: Buffer | null = null;
export function auditChainKey(): Buffer {
  if (cachedAuditKey) return cachedAuditKey;
  cachedAuditKey = env.AUDIT_HMAC_KEY
    ? Buffer.from(env.AUDIT_HMAC_KEY, 'utf8')
    : Buffer.from(
        crypto.hkdfSync(
          'sha256',
          env.JWT_SECRET,
          Buffer.from('lockey:audit-chain'),
          Buffer.from('hmac-key:v1'),
          32,
        ),
      );
  return cachedAuditKey;
}

function chainHash(canonical: string): string {
  return crypto.createHmac('sha256', auditChainKey()).update(canonical).digest('hex');
}

interface AuditInput {
  action: AuditAction;
  req?: Request;
  userId?: string | null;
  username?: string | null;
  serial?: string;
  success?: boolean;
  details?: Prisma.InputJsonValue;
}

/**
 * M6 — chaînage par HMAC du journal d'audit.
 *
 * Chaque ligne calcule `hash = HMAC-SHA256(key, prevHash || canonical(payload))`
 * où `prevHash` est le hash du dernier log écrit (ordre par id décroissant ;
 * cuid est k-sortable donc cohérent avec l'ordre temporel) et `key` est détenue
 * hors base (cf. `auditChainKey`).
 *
 * Si une ligne est modifiée ou supprimée en DB, la chaîne casse à partir de
 * cette ligne et c'est détectable par `npm run verify:audit-chain`. Comme la
 * clé HMAC n'est pas en base, un attaquant ayant un accès write Postgres ne
 * peut PAS recalculer une chaîne cohérente (contrairement à l'ancien SHA-256
 * non clavé).
 *
 * Limite connue : sur écriture concurrente (rare en pratique), deux logs
 * peuvent lire le même prevHash et créer un fork. La vérification le détecte
 * mais ne garantit pas un ordre total. Pour un ordre total strict il faudrait
 * une table de "log_state" verrouillée ou une isolation SERIALIZABLE.
 */
interface CanonicalPayload {
  action: AuditAction;
  userId: string | null;
  username: string | null;
  ip: string | null;
  userAgent: string | null;
  serial: string | null;
  details: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined;
  success: boolean;
  createdAt: Date;
  prevHash: string | null;
}

/**
 * Sérialisation JSON déterministe (RFC 8785-ish) : trie les clés des objets
 * profondément. Indispensable parce que PostgreSQL JSONB réordonne les clés
 * au stockage (par longueur puis lex), donc à la relecture l'ordre des clés
 * de `details` n'est PAS celui de l'écriture — `JSON.stringify` produirait
 * deux strings différentes pour la même donnée logique → hash incohérent.
 *
 * Les arrays préservent leur ordre (JSONB aussi). Les Date sont sérialisées
 * via leur `toISOString()` pour cohérence cross-version Node.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function canonicalPayload(p: CanonicalPayload): string {
  // Ordre de clés stable + normalisation undefined→null + sérialisation
  // déterministe de `details` (cf. stableStringify ci-dessus).
  return stableStringify({
    action: p.action,
    userId: p.userId,
    username: p.username,
    ip: p.ip,
    userAgent: p.userAgent,
    serial: p.serial,
    details: p.details ?? null,
    success: p.success,
    createdAt: p.createdAt.toISOString(),
    prevHash: p.prevHash,
  });
}

export async function logAudit(input: AuditInput): Promise<void> {
  try {
    const prev = await prisma.auditLog.findFirst({
      orderBy: { id: 'desc' },
      select: { hash: true },
    });
    const prevHash = prev?.hash ?? null;

    const createdAt = new Date();
    // Construire le data Prisma : `details` reste `undefined` si absent
    // (Prisma stocke alors NULL en DB sans que TS rouspète sur `null`).
    const userId = input.userId ?? input.req?.user?.id ?? null;
    const username = input.username ?? input.req?.user?.username ?? null;
    const ip = input.req?.ip ?? null;
    const userAgent = input.req?.get('user-agent') ?? null;
    const serial = input.serial ?? null;
    const success = input.success ?? true;

    const hash = chainHash(
      canonicalPayload({
        action: input.action,
        userId,
        username,
        ip,
        userAgent,
        serial,
        details: input.details,
        success,
        createdAt,
        prevHash,
      }),
    );

    await prisma.auditLog.create({
      data: {
        action: input.action,
        userId,
        username,
        ip,
        userAgent,
        serial,
        details: input.details,
        success,
        createdAt,
        prevHash,
        hash,
      },
    });
  } catch (err) {
    // M3 — fail-loud : on logge fatal (chaîne d'audit cassée, à investiguer
    // immédiatement) et on pose `X-Audit-Failed: 1` sur la réponse en cours
    // pour que le client/proxy puisse alerter. On NE throw PAS pour ne pas
    // re-rollback une opération qui a déjà des effets de bord persistés.
    // La gap dans la chaîne sera détectée par `npm run verify:audit-chain`.
    logger.fatal(
      {
        err,
        action: input.action,
        userId: input.userId ?? input.req?.user?.id ?? null,
      },
      'audit log write failed — chaîne d\'audit cassée',
    );
    const res = input.req?.res;
    if (res && !res.headersSent) {
      res.setHeader('X-Audit-Failed', '1');
    }
  }
}

/**
 * Recalcule le hash attendu pour une ligne déjà écrite (utilitaire pour le
 * script de vérification).
 */
export function recomputeAuditHash(row: {
  action: AuditAction;
  userId: string | null;
  username: string | null;
  ip: string | null;
  userAgent: string | null;
  serial: string | null;
  details: Prisma.JsonValue | null;
  success: boolean;
  createdAt: Date;
  prevHash: string | null;
}): string {
  return chainHash(canonicalPayload(row));
}
