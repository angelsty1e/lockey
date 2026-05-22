import crypto from 'node:crypto';
import { authenticator } from 'otplib';
import bcrypt from 'bcrypt';
import qrcode from 'qrcode';

// RFC 6238 — défauts de l'industrie : 30s par fenêtre, ±1 step de tolérance
// pour absorber le décalage d'horloge entre le serveur et le téléphone.
authenticator.options = {
  step: 30,
  window: 1,
  digits: 6,
};

const ISSUER = 'Lockey';

/** Génère un secret TOTP base32 (160 bits, conforme RFC 4226). */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/** URI otpauth:// que l'app authenticator peut scanner. */
export function buildOtpauthUrl(secret: string, accountName: string): string {
  return authenticator.keyuri(accountName, ISSUER, secret);
}

/** Renvoie le QR code de l'URI otpauth en data URL (PNG base64). */
export async function buildOtpauthQr(otpauthUrl: string): Promise<string> {
  return qrcode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
}

/**
 * Vérifie un code TOTP. `code` peut contenir des espaces ou tirets, on
 * les retire. `false` si le code n'est pas exactement 6 chiffres après
 * normalisation (avant même de toucher au secret).
 */
export function verifyTotp(secret: string, code: string): boolean {
  const normalized = code.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  try {
    return authenticator.verify({ token: normalized, secret });
  } catch {
    return false;
  }
}

const BACKUP_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // sans 0/o/1/l/i pour lisibilité
const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_LENGTH = 8;

/**
 * Génère N codes de secours en clair (à montrer une seule fois à l'utilisateur)
 * et leurs hashes bcrypt à persister.
 */
export async function generateBackupCodes(): Promise<{ plain: string[]; hashes: string[] }> {
  const plain: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    let code = '';
    const buf = crypto.randomBytes(BACKUP_CODE_LENGTH);
    for (let j = 0; j < BACKUP_CODE_LENGTH; j++) {
      code += BACKUP_CODE_ALPHABET[buf[j] % BACKUP_CODE_ALPHABET.length];
    }
    // Format affiché xxxx-xxxx, on le stocke sans tiret pour normaliser.
    plain.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  // bcrypt rounds=10 — codes courts à entropie moyenne (~40 bits), suffisant
  // pour usage unique. Plus de rounds inutilement coûteux.
  const hashes = await Promise.all(plain.map(c => bcrypt.hash(normalizeBackupCode(c), 10)));
  return { plain, hashes };
}

/** Normalise un code de secours saisi par l'utilisateur (tiret, espaces, casse). */
export function normalizeBackupCode(input: string): string {
  return input.replace(/[\s-]/g, '').toLowerCase();
}
