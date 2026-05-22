/**
 * Vérifie l'intégrité du chaînage SHA-256 du journal d'audit (M6).
 *
 * Itère toutes les lignes par id ASC, recompute `hash` et vérifie qu'il
 * correspond, et que `prevHash` correspond bien au hash de la ligne précédente.
 *
 * Sortie en cas d'incohérence :
 *   - Code de retour 1
 *   - Liste des lignes en erreur (id, action, raison)
 *
 * Les lignes pré-M6 (sans hash) sont rapportées séparément en mode "non chaînées".
 *
 * Usage :
 *   npx tsx --env-file=.env scripts/verify-audit-chain.ts
 */
import { PrismaClient } from '@prisma/client';
import { recomputeAuditHash } from '../src/audit.js';

const prisma = new PrismaClient();

interface Issue {
  id: string;
  action: string;
  reason: string;
}

async function main() {
  const total = await prisma.auditLog.count();
  console.log(`AuditLog : ${total} entrées à vérifier.\n`);

  const issues: Issue[] = [];
  let preChain = 0;
  let chained = 0;
  let lastHash: string | null = null;
  let chainStarted = false;

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
      if (row.hash === null) {
        // Ligne pré-M6 : pas chaînée. Si une ligne chaînée arrive ensuite, son
        // prevHash devrait être null (début de chaîne) — on le constatera.
        if (chainStarted) {
          issues.push({
            id: row.id,
            action: row.action,
            reason: 'ligne sans hash entre des lignes chaînées (corruption ou downgrade ?)',
          });
        }
        preChain++;
        continue;
      }

      const expected = recomputeAuditHash({
        action: row.action,
        userId: row.userId,
        username: row.username,
        ip: row.ip,
        userAgent: row.userAgent,
        serial: row.serial,
        details: row.details,
        success: row.success,
        createdAt: row.createdAt,
        prevHash: row.prevHash,
      });

      if (expected !== row.hash) {
        issues.push({
          id: row.id,
          action: row.action,
          reason: `hash incohérent (calculé=${expected.slice(0, 12)}…, stocké=${row.hash.slice(0, 12)}…)`,
        });
      }

      // Vérification du chaînage avec le précédent hash chaîné observé.
      if (chainStarted && row.prevHash !== lastHash) {
        issues.push({
          id: row.id,
          action: row.action,
          reason: `prevHash (${row.prevHash?.slice(0, 12) ?? 'null'}…) ne correspond pas au dernier hash observé (${lastHash?.slice(0, 12) ?? 'null'}…)`,
        });
      }

      lastHash = row.hash;
      chainStarted = true;
      chained++;
    }

    cursor = rows[rows.length - 1].id;
    if (rows.length < PAGE) break;
  }

  console.log(`Lignes chaînées vérifiées : ${chained}`);
  console.log(`Lignes pré-M6 (sans hash)  : ${preChain}`);
  console.log(`Incohérences détectées     : ${issues.length}`);
  console.log('');

  if (issues.length > 0) {
    console.log('--- Détail ---');
    for (const i of issues.slice(0, 50)) {
      console.log(`  ✗ [${i.id}] ${i.action} — ${i.reason}`);
    }
    if (issues.length > 50) {
      console.log(`  … et ${issues.length - 50} autres.`);
    }
    process.exitCode = 1;
  } else {
    console.log('✓ Chaîne intègre.');
  }
}

main()
  .catch(err => {
    console.error('Erreur :', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
