import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, setUnauthorizedHandler } from '../api';
import type { User } from '../types';
import {
  buildAccountKeys,
  deriveLogin,
  deriveRecoveryHash,
  rewrapForNewPassword,
  unlockVaultKey,
  unlockWithPassword,
  unlockWithRecovery,
} from '../crypto/zk';
import {
  enrollPasskey as createPasskeyEnrollment,
  unlockWithPasskey,
} from '../crypto/passkey';
import type { PasskeyEnrollment } from '../crypto/passkey';

/**
 * Résultat de l'étape 1 du login.
 *  - `ok` : session ouverte (Lockey déverrouillé, ou à initialiser).
 *  - `mfa` : il faut appeler `verifyMfa(code | backupCode)` pour finaliser.
 */
export type LoginResult = { kind: 'ok' } | { kind: 'mfa' };

/** Délai d'inactivité avant verrouillage automatique de Lockey (ms). */
const AUTO_LOCK_MS = 15 * 60_000;

interface AuthState {
  user: User | null;
  loading: boolean;
  /** Vrai entre l'étape mdp validée et la vérif du code 2FA. */
  pendingMfa: boolean;
  /** Clé de chiffrement déchiffrée — en mémoire uniquement. Null = Lockey verrouillé. */
  vaultKey: CryptoKey | null;
  /** Faux tant que le Lockey zéro-connaissance n'a pas été initialisé. */
  vaultInitialized: boolean;
  login: (username: string, masterPassword: string) => Promise<LoginResult>;
  verifyMfa: (input: { code?: string; backupCode?: string }) => Promise<void>;
  cancelMfa: () => void;
  /** Déverrouille Lockey depuis le mot de passe maître. */
  unlock: (masterPassword: string) => Promise<void>;
  /** Initialise Lockey (compte créé par un admin). Le code de récupération
   *  généré est exposé via `pendingRecoveryCode` jusqu'à acquittement. */
  initializeVault: (masterPassword: string) => Promise<void>;
  /** Code de récupération à présenter une fois (création/initialisation). */
  pendingRecoveryCode: string | null;
  /** Acquitte le code de récupération et déverrouille effectivement Lockey. */
  clearPendingRecoveryCode: () => void;
  /** Change le mot de passe maître (Lockey déjà déverrouillé). */
  changeMasterPassword: (newMasterPassword: string) => Promise<void>;
  /** Récupération via code de secours : ouvre la session et impose un nouveau mdp. */
  recover: (username: string, recoveryCode: string, newMasterPassword: string) => Promise<void>;
  /** Une passkey de déverrouillage est-elle enregistrée ? */
  hasPasskey: boolean;
  /** Déverrouille Lockey via la passkey enregistrée. */
  unlockViaPasskey: () => Promise<void>;
  /** Enrôle une passkey (Lockey déverrouillé requis). */
  enrollPasskey: () => Promise<void>;
  /** Retire la passkey enregistrée. */
  removePasskey: () => Promise<void>;
  lock: () => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [protectedVaultKey, setProtectedVaultKey] = useState<string | null>(null);
  // Token de challenge MFA (5 min de TTL côté serveur). Mémoire React seulement.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  // Bits maîtres retenus entre l'étape mdp et la vérif 2FA, pour pouvoir
  // déballer la clé de chiffrement une fois le 2FA validé.
  const pendingKeyBits = useRef<Uint8Array | null>(null);
  // Code de récupération à présenter après une initialisation de Lockey. Les
  // clés correspondantes restent en attente jusqu'à acquittement (sinon l'app
  // s'afficherait avant que l'utilisateur ait noté son code).
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState<string | null>(null);
  const pendingVaultKey = useRef<CryptoKey | null>(null);
  const pendingProtectedKey = useRef<string | null>(null);
  // Passkey de déverrouillage (renseignée par /me).
  const [passkey, setPasskey] = useState<PasskeyEnrollment | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.me();
      setUser(r.user);
      setProtectedVaultKey(r.protectedVaultKey);
      setPasskey(r.passkey);
    } catch {
      setUser(null);
      setProtectedVaultKey(null);
      setVaultKey(null);
      setPasskey(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setProtectedVaultKey(null);
      setVaultKey(null);
      setMfaToken(null);
      setPasskey(null);
      pendingKeyBits.current = null;
    });
    refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, masterPassword: string): Promise<LoginResult> => {
    const { authHash, masterKeyBits } = await deriveLogin(username, masterPassword);
    const r = await api.login(username, authHash);

    if (r.mfaRequired && r.mfaToken) {
      setMfaToken(r.mfaToken);
      pendingKeyBits.current = masterKeyBits;
      return { kind: 'mfa' };
    }
    if (r.user) {
      setUser(r.user);
      setProtectedVaultKey(r.protectedVaultKey ?? null);
      setMfaToken(null);
      if (r.protectedVaultKey) {
        setVaultKey(await unlockVaultKey(r.protectedVaultKey, masterKeyBits));
      }
      // Sinon : Lockey non initialisé → l'écran d'initialisation prendra le relais.
      return { kind: 'ok' };
    }
    throw new Error('Réponse de login inattendue');
  }, []);

  const verifyMfa = useCallback(
    async (input: { code?: string; backupCode?: string }) => {
      if (!mfaToken) throw new Error('Aucun challenge MFA en cours — recommence depuis le login');
      const r = await api.loginVerifyMfa({ mfaToken, ...input });
      setUser(r.user);
      setProtectedVaultKey(r.protectedVaultKey ?? null);
      const bits = pendingKeyBits.current;
      if (r.protectedVaultKey && bits) {
        setVaultKey(await unlockVaultKey(r.protectedVaultKey, bits));
      }
      pendingKeyBits.current = null;
      setMfaToken(null);
    },
    [mfaToken],
  );

  const cancelMfa = useCallback(() => {
    setMfaToken(null);
    pendingKeyBits.current = null;
  }, []);

  const unlock = useCallback(
    async (masterPassword: string) => {
      if (!user || !protectedVaultKey) throw new Error('Lockey indisponible');
      setVaultKey(await unlockWithPassword(user.username, masterPassword, protectedVaultKey));
    },
    [user, protectedVaultKey],
  );

  const initializeVault = useCallback(
    async (masterPassword: string): Promise<void> => {
      if (!user) throw new Error('Non connecté');
      const keys = await buildAccountKeys(user.username, masterPassword);
      await api.initVault({
        protectedVaultKey: keys.protectedVaultKey,
        recoveryHash: keys.recoveryHash,
        recoveryProtectedKey: keys.recoveryProtectedKey,
      });
      // On ne committe les clés qu'après acquittement du code de récupération.
      pendingVaultKey.current = keys.vaultKey;
      pendingProtectedKey.current = keys.protectedVaultKey;
      setPendingRecoveryCode(keys.recoveryCode);
    },
    [user],
  );

  const clearPendingRecoveryCode = useCallback(() => {
    if (pendingProtectedKey.current) setProtectedVaultKey(pendingProtectedKey.current);
    if (pendingVaultKey.current) setVaultKey(pendingVaultKey.current);
    pendingVaultKey.current = null;
    pendingProtectedKey.current = null;
    setPendingRecoveryCode(null);
  }, []);

  const changeMasterPassword = useCallback(
    async (newMasterPassword: string) => {
      if (!user || !vaultKey) throw new Error('Lockey verrouillé');
      const rewrapped = await rewrapForNewPassword(user.username, newMasterPassword, vaultKey);
      await api.changeMasterPassword(rewrapped);
      setProtectedVaultKey(rewrapped.protectedVaultKey);
    },
    [user, vaultKey],
  );

  const recover = useCallback(
    async (username: string, recoveryCode: string, newMasterPassword: string) => {
      const recoveryHash = await deriveRecoveryHash(username, recoveryCode);
      const r = await api.recover(username, recoveryHash);
      const vk = await unlockWithRecovery(username, recoveryCode, r.recoveryProtectedKey);
      // Impose immédiatement un nouveau mot de passe maître.
      const rewrapped = await rewrapForNewPassword(username, newMasterPassword, vk);
      await api.changeMasterPassword(rewrapped);
      setUser(r.user);
      setProtectedVaultKey(rewrapped.protectedVaultKey);
      setVaultKey(vk);
    },
    [],
  );

  const unlockViaPasskey = useCallback(async () => {
    if (!passkey) throw new Error('Aucune passkey enregistrée');
    setVaultKey(await unlockWithPasskey(passkey));
  }, [passkey]);

  const enrollPasskey = useCallback(async () => {
    if (!user || !vaultKey) throw new Error('Lockey verrouillé');
    const enrollment = await createPasskeyEnrollment(user.username, vaultKey);
    await api.savePasskey(enrollment);
    setPasskey(enrollment);
  }, [user, vaultKey]);

  const removePasskey = useCallback(async () => {
    await api.deletePasskey();
    setPasskey(null);
  }, []);

  const lock = useCallback(() => {
    setVaultKey(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setUser(null);
    setProtectedVaultKey(null);
    setVaultKey(null);
    setMfaToken(null);
    setPasskey(null);
    pendingKeyBits.current = null;
  }, []);

  // Verrouillage automatique après inactivité prolongée.
  useEffect(() => {
    if (!vaultKey) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setVaultKey(null), AUTO_LOCK_MS);
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [vaultKey]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      pendingMfa: !!mfaToken,
      vaultKey,
      vaultInitialized: protectedVaultKey !== null,
      login,
      verifyMfa,
      cancelMfa,
      unlock,
      initializeVault,
      pendingRecoveryCode,
      clearPendingRecoveryCode,
      changeMasterPassword,
      recover,
      hasPasskey: passkey !== null,
      unlockViaPasskey,
      enrollPasskey,
      removePasskey,
      lock,
      logout,
      refresh,
    }),
    [
      user,
      loading,
      mfaToken,
      vaultKey,
      protectedVaultKey,
      pendingRecoveryCode,
      passkey,
      login,
      verifyMfa,
      cancelMfa,
      unlock,
      initializeVault,
      clearPendingRecoveryCode,
      changeMasterPassword,
      recover,
      unlockViaPasskey,
      enrollPasskey,
      removePasskey,
      lock,
      logout,
      refresh,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
