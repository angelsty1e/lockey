/**
 * Rétro-correction de la chaîne de hash AuditLog après le fix de
 * sérialisation déterministe (v1.22.x).
 *
 * Contexte : avant v1.22.x, `canonicalPayload` faisait `JSON.stringify(details)`
 * direct. Comme PostgreSQL JSONB réordonne les clés au stockage, le hash
 * recalculé à la relecture ne matchait pas le hash écrit. ~50% des lignes
 * post-M6 avec un `details` multi-clés étaient marquées corrompues à tort.
 *
 * Ce script :
 *   1. Itère par id ASC (= ordre temporel via cuid k-sortable)
 *   2. Pour chaque ligne hashée, recalcule prevHash + hash avec la nouvelle
 *      sérialisation et update si différent
 *   3. Reconstitue ainsi une chaîne propre, vérifiable par
 *      `npm run verify:audit-chain` ensuite
 *
 * IMPORTANT : après ce rejeu, les modifications éventuelles ANTÉRIEURES
 * d'une ligne ne sont plus détectables (on rejoue sur les données actuelles).
 * En pratique on ne perd rien : la chaîne était déjà cassée. La propriété
 * "modifications FUTURES détectables" est restaurée.
 *
 * Usage :
 *   npx tsx --env-file=.env scripts/fix-audit-chain.ts          # dry-run
 *   npx tsx --env-file=.env scripts/fix-audit-chain.ts --apply  # écrit en DB
 */
import { PrismaClient } from '@prisma/client';
import { recomputeAuditHash } from '../src/audit.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// F1 — ce script RÉÉCRIT la chaîne d'audit à partir des données actuelles :
// c'est un outil de migration légitime (re-scellement après un changement de
// canonicalisation/clé), mais aussi, entre de mauvaises mains, un oracle de
// réécriture. En production, on exige un opt-in explicite pour éviter qu'il
// serve à blanchir une altération. Le re-scellement reste impossible sans la
// clé HMAC (auditChainKey), mais on garde ce garde-fou de défense en profondeur.
if (APPLY && process.env.NODE_ENV === 'production' && process.env.ALLOW_AUDIT_REWRITE !== '1') {
  console.error(
    'Refus : réécriture de la chaîne d\'audit en production.\n' +
      'Ce script ré-scelle TOUTES les lignes — toute altération antérieure devient\n' +
      'indétectable. Si c\'est une migration légitime, relancez avec ALLOW_AUDIT_REWRITE=1\n' +
      'et tracez l\'opération hors bande.',
  );
  process.exit(1);
}

async function main() {
  const total = await prisma.auditLog.count();
  console.log(`AuditLog : ${total} entrées au total.`);
  console.log(`Mode : ${APPLY ? 'APPLY (écriture en DB)' : 'DRY-RUN (aucune modification)'}\n`);

  let prevHash: string | null = null;
  let chainStarted = false;
  let nbScanned = 0;
  let nbFixed = 0;
  let nbAlreadyOk = 0;
  let nbPreM6 = 0;

  const PAGE = 500;
  let cursor: string | undefined = undefined;

  while (true) {
    const rows = await prisma.auditLog.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      nbScanned++;
      if (row.hash === null) {
        // Ligne pré-M6 : on ne touche pas, on la skip.
        nbPreM6++;
        continue;
      }

      const newHash = recomputeAuditHash({
        action: row.action,
        userId: row.userId,
        username: row.username,
        ip: row.ip,
        userAgent: row.userAgent,
        serial: row.serial,
        details: row.details,
        success: row.success,
        createdAt: row.createdAt,
        prevHash: chainStarted ? prevHash : row.prevHash,
      });

      const needsFix =
        row.hash !== newHash ||
        (chainStarted && row.prevHash !== prevHash);

      if (needsFix) {
        nbFixed++;
        if (APPLY) {
          await prisma.auditLog.update({
            where: { id: row.id },
            data: {
              prevHash: chainStarted ? prevHash : row.prevHash,
              hash: newHash,
            },
          });
        } else {
          console.log(
            `  [fix] ${row.id} ${row.action.padEnd(28)} ` +
              `hash ${row.hash.slice(0, 12)}… → ${newHash.slice(0, 12)}…`,
          );
        }
      } else {
        nbAlreadyOk++;
      }

      prevHash = newHash;
      chainStarted = true;
    }

    cursor = rows[rows.length - 1].id;
    if (rows.length < PAGE) break;
  }

  console.log(`\n--- Résumé ---`);
  console.log(`Lignes scannées      : ${nbScanned}`);
  console.log(`Lignes pré-M6 (skip) : ${nbPreM6}`);
  console.log(`Lignes déjà OK       : ${nbAlreadyOk}`);
  console.log(`Lignes ${APPLY ? 'corrigées' : 'à corriger '}     : ${nbFixed}`);

  if (!APPLY && nbFixed > 0) {
    console.log(`\n→ Relance avec --apply pour appliquer.`);
  } else if (APPLY) {
    console.log(`\n→ Vérifie avec : npm run verify:audit-chain`);
  } else {
    console.log(`\n✓ Rien à faire, la chaîne est déjà cohérente.`);
  }
}

main()
  .catch(err => {
    console.error('Erreur :', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
