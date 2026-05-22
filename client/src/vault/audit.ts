/**
 * Audit de sécurité de Lockey — calculé entièrement dans le navigateur, après
 * déverrouillage. Le serveur ne voit jamais les mots de passe et ne participe
 * donc pas à cette analyse.
 */
import { passwordStrength } from './generator';
import type { DecryptedItem } from './types';

/** Au-delà de cet âge (jours), un mot de passe est jugé « ancien ». */
const OLD_DAYS = 365;

export interface ReusedGroup {
  password: string;
  items: DecryptedItem[];
}

export interface AuditReport {
  total: number;
  logins: number;
  /** Mots de passe vides ou de faible robustesse. */
  weak: DecryptedItem[];
  /** Groupes d'identifiants partageant le même mot de passe. */
  reused: ReusedGroup[];
  /** Identifiants non modifiés depuis plus d'un an. */
  old: DecryptedItem[];
  /** Identifiants sans clé 2FA enregistrée. */
  noTotp: DecryptedItem[];
  /** Score global de santé (0-100). */
  score: number;
}

export function auditVault(items: DecryptedItem[]): AuditReport {
  const logins = items.filter(i => i.type === 'LOGIN');
  const now = Date.now();

  const weak: DecryptedItem[] = [];
  const old: DecryptedItem[] = [];
  const noTotp: DecryptedItem[] = [];
  const byPassword = new Map<string, DecryptedItem[]>();

  for (const it of logins) {
    const pw = it.content.login?.password ?? '';
    const totp = it.content.login?.totp ?? '';

    if (!pw || passwordStrength(pw).score <= 1) weak.push(it);
    if (!totp) noTotp.push(it);

    const ageDays = (now - new Date(it.updatedAt).getTime()) / 86_400_000;
    if (ageDays > OLD_DAYS) old.push(it);

    if (pw) {
      const arr = byPassword.get(pw) ?? [];
      arr.push(it);
      byPassword.set(pw, arr);
    }
  }

  const reused: ReusedGroup[] = [];
  for (const [password, group] of byPassword) {
    if (group.length > 1) reused.push({ password, items: group });
  }

  // Score : moyenne de la « santé » de chaque identifiant.
  const weakSet = new Set(weak.map(i => i.id));
  const oldSet = new Set(old.map(i => i.id));
  const noTotpSet = new Set(noTotp.map(i => i.id));
  const reusedSet = new Set(reused.flatMap(g => g.items.map(i => i.id)));

  let score = 100;
  if (logins.length > 0) {
    let sum = 0;
    for (const it of logins) {
      let health = 100;
      if (weakSet.has(it.id)) health -= 45;
      if (reusedSet.has(it.id)) health -= 35;
      if (oldSet.has(it.id)) health -= 12;
      if (noTotpSet.has(it.id)) health -= 12;
      sum += Math.max(0, health);
    }
    score = Math.round(sum / logins.length);
  }

  return { total: items.length, logins: logins.length, weak, reused, old, noTotp, score };
}

/** Libellé qualitatif du score. */
export function scoreLabel(score: number): string {
  if (score >= 85) return 'Excellent';
  if (score >= 65) return 'Bon';
  if (score >= 40) return 'À renforcer';
  return 'Vulnérable';
}
