/**
 * Cryptographie « zéro-connaissance » de Lockey.
 *
 * Le mot de passe maître ne quitte JAMAIS le navigateur. À partir de lui on
 * dérive :
 *
 *  - masterKeyBits : PBKDF2(masterPassword, sel = username) — 256 bits. C'est
 *    la dérivation coûteuse (600 000 itérations) ; on ne la fait qu'une fois
 *    par saisie du mot de passe.
 *
 *  - authHash : PBKDF2(masterKeyBits, sel = masterPassword, 1 itération). C'est
 *    la SEULE valeur envoyée au serveur, qui n'en stocke qu'un bcrypt. Remonter
 *    de authHash vers masterKeyBits est infaisable (PBKDF2 est à sens unique),
 *    donc une fuite de la base ne révèle pas la clé de chiffrement.
 *
 *  - encKey : HKDF(masterKeyBits) — clé AES-GCM qui « emballe » la clé de
 *    chiffrement. Dérivée séparément de authHash : la valeur envoyée au serveur
 *    ne partage aucun bit avec la clé de chiffrement.
 *
 * La clé de chiffrement (vaultKey) est une clé AES-256-GCM aléatoire, générée
 * une seule fois à la création du compte. Tous les éléments sont chiffrés
 * avec elle. Le serveur ne la stocke que sous forme emballée
 * (protectedVaultKey = AES-GCM(vaultKey, encKey)) : il ne peut jamais la
 * déballer, donc jamais lire les secrets.
 */

const KDF_ITERATIONS = 600_000;
const BLOB_PREFIX = 'lk1';

const subtle = crypto.subtle;
const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

// ---------------------------------------------------------------------------
// Encodage
// ---------------------------------------------------------------------------

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Normalisation du nom d'utilisateur utilisé comme sel — identique partout. */
function normUser(username: string): string {
  return username.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Primitives de dérivation
// ---------------------------------------------------------------------------

async function pbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const baseKey = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    256,
  );
  return new Uint8Array(bits);
}

/** Clé maître brute — dérivation coûteuse à partir du mot de passe maître. */
async function deriveMasterKeyBits(masterPassword: string, username: string): Promise<Uint8Array> {
  return pbkdf2(utf8.encode(masterPassword), utf8.encode(normUser(username)), KDF_ITERATIONS);
}

/** Hash d'authentification (base64) — la seule valeur transmise au serveur. */
async function deriveAuthHash(masterKeyBits: Uint8Array, masterPassword: string): Promise<string> {
  return toBase64(await pbkdf2(masterKeyBits, utf8.encode(masterPassword), 1));
}

/** Clé AES-GCM d'emballage, dérivée des bits maîtres via HKDF. */
async function deriveEncKey(masterKeyBits: Uint8Array, info: string): Promise<CryptoKey> {
  const hkdfKey = await subtle.importKey('raw', masterKeyBits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8.encode(info) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// AES-256-GCM — format de blob : "lk1:" + base64(iv(12) || ciphertext+tag)
// ---------------------------------------------------------------------------

async function aesEncrypt(key: CryptoKey, plaintext: Uint8Array): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const joined = new Uint8Array(iv.length + ct.length);
  joined.set(iv, 0);
  joined.set(ct, iv.length);
  return `${BLOB_PREFIX}:${toBase64(joined)}`;
}

async function aesDecrypt(key: CryptoKey, blob: string): Promise<Uint8Array> {
  const sep = blob.indexOf(':');
  if (sep < 0 || blob.slice(0, sep) !== BLOB_PREFIX) {
    throw new Error('format de blob chiffré invalide');
  }
  const joined = fromBase64(blob.slice(sep + 1));
  const iv = joined.slice(0, 12);
  const ct = joined.slice(12);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new Uint8Array(pt);
}

// ---------------------------------------------------------------------------
// Clé de chiffrement
// ---------------------------------------------------------------------------

/** Importe 32 octets bruts en clé AES-GCM. `extractable` pour pouvoir la
 *  ré-emballer lors d'un changement de mot de passe maître. */
async function importVaultKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// ---------------------------------------------------------------------------
// Code de récupération
// ---------------------------------------------------------------------------

// Alphabet base32 sans caractères ambigus (pas de I, L, O, 0, 1).
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Code de récupération : 25 caractères (≈125 bits), groupés par 5. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(25);
  let s = '';
  // 256 % 32 === 0 → byte % 32 est parfaitement uniforme, pas de biais modulo.
  for (let i = 0; i < 25; i++) s += RECOVERY_ALPHABET[bytes[i] % 32];
  return s.match(/.{1,5}/g)!.join('-');
}

/** Normalise un code saisi (majuscules, sans tirets ni espaces). */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-9]/g, '');
}

async function deriveRecoveryKeyBits(recoveryCode: string, username: string): Promise<Uint8Array> {
  const norm = normalizeRecoveryCode(recoveryCode);
  return pbkdf2(utf8.encode(norm), utf8.encode('lockey:recovery:' + normUser(username)), KDF_ITERATIONS);
}

// ---------------------------------------------------------------------------
// Chiffrement des données Lockey (utilisé par les éléments — Phase 2)
// ---------------------------------------------------------------------------

export async function encryptString(vaultKey: CryptoKey, text: string): Promise<string> {
  return aesEncrypt(vaultKey, utf8.encode(text));
}

export async function decryptString(vaultKey: CryptoKey, blob: string): Promise<string> {
  return utf8d.decode(await aesDecrypt(vaultKey, blob));
}

// ---------------------------------------------------------------------------
// Flux de haut niveau
// ---------------------------------------------------------------------------

/** Tout ce qui est nécessaire pour créer (ou initialiser) un compte. */
export interface AccountKeys {
  /** À envoyer au serveur (il en stocke un bcrypt). */
  authHash: string;
  /** Clé de chiffrement emballée par le mot de passe maître. */
  protectedVaultKey: string;
  /** Code de récupération — à afficher UNE fois à l'utilisateur. */
  recoveryCode: string;
  /** Hash d'authentification du code de récupération (le serveur en stocke un bcrypt). */
  recoveryHash: string;
  /** Clé de chiffrement emballée par le code de récupération. */
  recoveryProtectedKey: string;
  /** Clé de chiffrement déchiffrée, à garder en mémoire. */
  vaultKey: CryptoKey;
}

/**
 * Génère un jeu de clés complet pour un nouveau compte (ou pour initialiser
 * Lockey pour un compte créé par un administrateur lors de sa 1re connexion).
 * `authHash` correspond au `masterPassword` fourni.
 */
export async function buildAccountKeys(username: string, masterPassword: string): Promise<AccountKeys> {
  const masterKeyBits = await deriveMasterKeyBits(masterPassword, username);
  const authHash = await deriveAuthHash(masterKeyBits, masterPassword);
  const encKey = await deriveEncKey(masterKeyBits, 'lockey:enc-key:v1');

  const vaultKeyRaw = randomBytes(32);
  const vaultKey = await importVaultKey(vaultKeyRaw);
  const protectedVaultKey = await aesEncrypt(encKey, vaultKeyRaw);

  const recoveryCode = generateRecoveryCode();
  const recKeyBits = await deriveRecoveryKeyBits(recoveryCode, username);
  const recoveryHash = await deriveAuthHash(recKeyBits, normalizeRecoveryCode(recoveryCode));
  const recoveryEncKey = await deriveEncKey(recKeyBits, 'lockey:recovery-enc:v1');
  const recoveryProtectedKey = await aesEncrypt(recoveryEncKey, vaultKeyRaw);

  return { authHash, protectedVaultKey, recoveryCode, recoveryHash, recoveryProtectedKey, vaultKey };
}

/** Étape 1 du login : calcule le authHash à envoyer + garde les bits maîtres. */
export async function deriveLogin(
  username: string,
  masterPassword: string,
): Promise<{ authHash: string; masterKeyBits: Uint8Array }> {
  const masterKeyBits = await deriveMasterKeyBits(masterPassword, username);
  const authHash = await deriveAuthHash(masterKeyBits, masterPassword);
  return { authHash, masterKeyBits };
}

/** Déballe la clé de chiffrement avec les bits maîtres (issus de deriveLogin). */
export async function unlockVaultKey(
  protectedVaultKey: string,
  masterKeyBits: Uint8Array,
): Promise<CryptoKey> {
  const encKey = await deriveEncKey(masterKeyBits, 'lockey:enc-key:v1');
  const raw = await aesDecrypt(encKey, protectedVaultKey);
  return importVaultKey(raw);
}

/** Déverrouille Lockey directement depuis le mot de passe maître. */
export async function unlockWithPassword(
  username: string,
  masterPassword: string,
  protectedVaultKey: string,
): Promise<CryptoKey> {
  const masterKeyBits = await deriveMasterKeyBits(masterPassword, username);
  return unlockVaultKey(protectedVaultKey, masterKeyBits);
}

/** Calcule le recoveryHash à envoyer pour le flux de récupération. */
export async function deriveRecoveryHash(username: string, recoveryCode: string): Promise<string> {
  const recKeyBits = await deriveRecoveryKeyBits(recoveryCode, username);
  return deriveAuthHash(recKeyBits, normalizeRecoveryCode(recoveryCode));
}

/** Déballe la clé de chiffrement avec le code de récupération. */
export async function unlockWithRecovery(
  username: string,
  recoveryCode: string,
  recoveryProtectedKey: string,
): Promise<CryptoKey> {
  const recKeyBits = await deriveRecoveryKeyBits(recoveryCode, username);
  const recoveryEncKey = await deriveEncKey(recKeyBits, 'lockey:recovery-enc:v1');
  const raw = await aesDecrypt(recoveryEncKey, recoveryProtectedKey);
  return importVaultKey(raw);
}

/**
 * Emballe la clé de chiffrement avec une clé brute de 32 octets — par exemple la
 * sortie de l'extension PRF d'une passkey (Phase 5).
 */
export async function wrapVaultKeyWithRaw(
  rawWrappingKey: Uint8Array,
  vaultKey: CryptoKey,
): Promise<string> {
  const wrapKey = await subtle.importKey('raw', rawWrappingKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const raw = new Uint8Array(await subtle.exportKey('raw', vaultKey));
  return aesEncrypt(wrapKey, raw);
}

/** Déballe la clé de chiffrement emballée par une clé brute (cf. `wrapVaultKeyWithRaw`). */
export async function unwrapVaultKeyWithRaw(
  rawWrappingKey: Uint8Array,
  blob: string,
): Promise<CryptoKey> {
  const wrapKey = await subtle.importKey('raw', rawWrappingKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const raw = await aesDecrypt(wrapKey, blob);
  return importVaultKey(raw);
}

/**
 * Ré-emballe la clé de chiffrement existante pour un nouveau mot de passe maître.
 * La clé de chiffrement elle-même ne change pas — donc le code de récupération
 * reste valable et les éléments déjà chiffrés n'ont pas à être ré-écrits.
 */
export async function rewrapForNewPassword(
  username: string,
  newMasterPassword: string,
  vaultKey: CryptoKey,
): Promise<{ authHash: string; protectedVaultKey: string }> {
  const raw = new Uint8Array(await subtle.exportKey('raw', vaultKey));
  const masterKeyBits = await deriveMasterKeyBits(newMasterPassword, username);
  const authHash = await deriveAuthHash(masterKeyBits, newMasterPassword);
  const encKey = await deriveEncKey(masterKeyBits, 'lockey:enc-key:v1');
  const protectedVaultKey = await aesEncrypt(encKey, raw);
  return { authHash, protectedVaultKey };
}
