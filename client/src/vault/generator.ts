/**
 * Générateur de mots de passe et de phrases de passe.
 *
 * Toute la randomness vient de `crypto.getRandomValues` (CSPRNG).
 */
import { WORDLIST } from './wordlist';

const LOWER = 'abcdefghijkmnpqrstuvwxyz'; // sans l/o (ambigus)
const LOWER_FULL = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I/O
const UPPER_FULL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '23456789'; // sans 0/1 (ambigus)
const DIGITS_FULL = '0123456789';
const SYMBOLS = '!@#$%^&*-_=+?';

/** Entier aléatoire uniforme dans [0, max) sans biais modulo (rejet). */
function randomInt(max: number): number {
  if (max <= 0) return 0;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return n % max;
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)];
}

/** Mélange un tableau en place (Fisher-Yates). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  /** Exclut les caractères ambigus (l, I, O, 0, 1…). */
  avoidAmbiguous: boolean;
}

export function generatePassword(opts: PasswordOptions): string {
  const sets: string[] = [];
  if (opts.lower) sets.push(opts.avoidAmbiguous ? LOWER : LOWER_FULL);
  if (opts.upper) sets.push(opts.avoidAmbiguous ? UPPER : UPPER_FULL);
  if (opts.digits) sets.push(opts.avoidAmbiguous ? DIGITS : DIGITS_FULL);
  if (opts.symbols) sets.push(SYMBOLS);
  if (sets.length === 0) return '';

  const length = Math.max(sets.length, Math.min(opts.length, 128));
  const all = sets.join('');
  const chars: string[] = [];
  // Garantit au moins un caractère de chaque jeu sélectionné.
  for (const set of sets) chars.push(pick(set));
  for (let i = chars.length; i < length; i++) chars.push(pick(all));
  return shuffle(chars).join('');
}

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
}

export function generatePassphrase(opts: PassphraseOptions): string {
  const count = Math.max(2, Math.min(opts.words, 12));
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    let w = WORDLIST[randomInt(WORDLIST.length)];
    if (opts.capitalize) w = w[0].toUpperCase() + w.slice(1);
    parts.push(w);
  }
  if (opts.includeNumber) {
    // Accole un nombre à un mot tiré au hasard.
    const idx = randomInt(parts.length);
    parts[idx] += String(randomInt(100));
  }
  return parts.join(opts.separator || '-');
}

/**
 * Estimation grossière de la force (0-4) à partir de la longueur et de la
 * variété des caractères. Sert au retour visuel, pas à une garantie.
 */
export function passwordStrength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: '' };
  let variety = 0;
  if (/[a-z]/.test(pw)) variety++;
  if (/[A-Z]/.test(pw)) variety++;
  if (/[0-9]/.test(pw)) variety++;
  if (/[^a-zA-Z0-9]/.test(pw)) variety++;
  const bitsPerChar = [0, 3.3, 4.2, 4.7, 5.5][variety] ?? 4;
  const bits = pw.length * bitsPerChar;
  let score: number;
  if (bits < 40) score = 1;
  else if (bits < 60) score = 2;
  else if (bits < 90) score = 3;
  else score = 4;
  const labels = ['', 'Faible', 'Moyen', 'Fort', 'Excellent'];
  return { score, label: labels[score] };
}
