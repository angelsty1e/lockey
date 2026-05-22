/**
 * Génération de codes TOTP (RFC 6238) côté navigateur.
 *
 * Paramètres standard (compatibles Google Authenticator, etc.) : HMAC-SHA1,
 * 6 chiffres, période de 30 s.
 */

const PERIOD = 30;
const DIGITS = 6;
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Décode une chaîne base32 en octets. Ignore espaces et padding. */
function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    const idx = B32_ALPHABET.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/**
 * Extrait le secret base32 brut d'une saisie : accepte soit le secret
 * directement, soit une URI `otpauth://totp/...?secret=XXX`.
 */
export function extractTotpSecret(input: string): string {
  const trimmed = input.trim();
  if (/^otpauth:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).searchParams.get('secret') ?? '';
    } catch {
      return '';
    }
  }
  return trimmed;
}

/** Secondes restantes avant le prochain code. */
export function totpRemaining(): number {
  return PERIOD - (Math.floor(Date.now() / 1000) % PERIOD);
}

/** Index de la fenêtre TOTP courante (change toutes les 30 s). */
export function totpCounter(): number {
  return Math.floor(Date.now() / 1000 / PERIOD);
}

/** Calcule le code TOTP courant. Lève une erreur si le secret est invalide. */
export async function generateTotp(secretInput: string): Promise<string> {
  const secret = extractTotpSecret(secretInput);
  const key = base32Decode(secret);
  if (key.length === 0) throw new Error('secret TOTP invalide');

  const counter = totpCounter();
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, buf));

  // Dynamic truncation (RFC 4226).
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}
