/**
 * Déverrouillage de Lockey par passkey (WebAuthn + extension PRF).
 *
 * L'extension PRF fournit, pour un couple (passkey, sel), un secret de 32
 * octets stable et reproductible. On l'utilise pour emballer la clé de chiffrement :
 * présenter la passkey suffit alors à la déballer, sans mot de passe maître.
 *
 * Le serveur ne stocke que l'identifiant de credential, le sel et le blob
 * emballé — il ne peut jamais reconstituer le secret PRF.
 */
import { wrapVaultKeyWithRaw, unwrapVaultKeyWithRaw, toBase64, fromBase64 } from './zk';
import type { Bytes } from './zk';

export interface PasskeyEnrollment {
  /** Identifiant de credential WebAuthn (base64url). */
  credentialId: string;
  /** Sel d'évaluation PRF (base64). */
  prfSalt: string;
  /** Clé de chiffrement emballée par le secret PRF. */
  passkeyProtectedKey: string;
}

// ---- base64url (les identifiants WebAuthn sont binaires) ----

function toB64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Bytes {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return fromBase64(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

/** Le navigateur peut-il faire des passkeys ? (contexte sécurisé requis) */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential !== 'undefined'
  );
}

// Les types DOM ne couvrent pas toujours l'extension PRF — on caste localement.
interface PrfResults {
  prf?: { results?: { first?: ArrayBuffer } };
}

function randomBytes(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Évalue l'extension PRF d'une passkey existante → secret de 32 octets. */
async function evaluatePrf(credentialId: BufferSource, prfSalt: BufferSource): Promise<Bytes> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ id: credentialId, type: 'public-key' }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } } as unknown as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error('Authentification par passkey annulée.');
  const ext = assertion.getClientExtensionResults() as unknown as PrfResults;
  const first = ext?.prf?.results?.first;
  if (!first) {
    throw new Error("Cette passkey ne prend pas en charge l'extension PRF.");
  }
  return new Uint8Array(first);
}

/**
 * Enrôle une nouvelle passkey et emballe la clé de chiffrement avec son secret PRF.
 * Lockey doit être déverrouillé (`vaultKey` disponible).
 */
export async function enrollPasskey(
  username: string,
  vaultKey: CryptoKey,
): Promise<PasskeyEnrollment> {
  const prfSalt = randomBytes(32);

  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { id: location.hostname, name: 'Lockey' },
      user: { id: randomBytes(16), name: username, displayName: username },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      timeout: 60_000,
      extensions: { prf: {} } as unknown as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!created) throw new Error('Création de la passkey annulée.');

  // L'évaluation du PRF se fait via une assertion immédiate sur la passkey créée.
  const prfOutput = await evaluatePrf(created.rawId, prfSalt);
  const passkeyProtectedKey = await wrapVaultKeyWithRaw(prfOutput, vaultKey);

  return {
    credentialId: toB64Url(new Uint8Array(created.rawId)),
    prfSalt: toBase64(prfSalt),
    passkeyProtectedKey,
  };
}

/** Déverrouille Lockey en présentant la passkey enrôlée. */
export async function unlockWithPasskey(enr: PasskeyEnrollment): Promise<CryptoKey> {
  const prfOutput = await evaluatePrf(fromB64Url(enr.credentialId), fromBase64(enr.prfSalt));
  return unwrapVaultKeyWithRaw(prfOutput, enr.passkeyProtectedKey);
}
