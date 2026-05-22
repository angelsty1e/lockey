import type {
  AuditPage,
  EmailConfig,
  EmailConfigInput,
  HealthcheckCatalogItem,
  HealthcheckConfig,
  HealthcheckResult,
  HealthcheckRunDetail,
  HealthcheckRunSummary,
  LoginResponse,
  MfaEnableResponse,
  MfaSetupResponse,
  MfaStatus,
  SmtpTestResult,
  User,
} from './types';
import type { VaultItemRecord, VaultItemType } from './vault/types';
import type { PasskeyEnrollment } from './crypto/passkey';

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

class ApiException extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Lockey-Client': 'web',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const r = await fetch(path, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (r.status === 401 && onUnauthorized) {
    onUnauthorized();
    throw new ApiException(401, 'unauthorized', 'Session expirée');
  }

  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: 'http_error', message: r.statusText }));
    throw new ApiException(r.status, err.error || 'error', err.message || err.error || r.statusText, err.details);
  }

  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

export const api = {
  // Setup (public, only works while no user exists)
  setupStatus: () => request<{ needsSetup: boolean }>('GET', '/api/setup/status'),
  setupInitialAdmin: (body: {
    username: string;
    email?: string;
    authHash: string;
    protectedVaultKey: string;
    recoveryHash: string;
    recoveryProtectedKey: string;
  }) => request<{ user: User }>('POST', '/api/setup/initial-admin', body),

  // Auth — le client n'envoie jamais le mot de passe maître, seulement le authHash.
  login: (username: string, authHash: string) =>
    request<LoginResponse>('POST', '/api/auth/login', { username, authHash }),
  loginVerifyMfa: (body: { mfaToken: string; code?: string; backupCode?: string }) =>
    request<{ user: User; protectedVaultKey?: string | null }>('POST', '/api/auth/login/mfa', body),
  recover: (username: string, recoveryHash: string) =>
    request<{ user: User; recoveryProtectedKey: string }>('POST', '/api/auth/recover', {
      username,
      recoveryHash,
    }),
  me: () =>
    request<{
      user: User;
      protectedVaultKey: string | null;
      passkey: PasskeyEnrollment | null;
    }>('GET', '/api/auth/me'),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),

  // Account (compte courant)
  changeMasterPassword: (body: { authHash: string; protectedVaultKey: string }) =>
    request<{ ok: true }>('POST', '/api/account/master-password', body),
  initVault: (body: { protectedVaultKey: string; recoveryHash: string; recoveryProtectedKey: string }) =>
    request<{ ok: true }>('POST', '/api/account/init-vault', body),
  savePasskey: (body: PasskeyEnrollment) =>
    request<{ ok: true }>('POST', '/api/account/passkey', body),
  deletePasskey: () => request<{ ok: true }>('DELETE', '/api/account/passkey'),

  // Healthcheck (admin)
  healthcheckCatalog: () =>
    request<{ checks: HealthcheckCatalogItem[] }>('GET', '/api/settings/healthcheck/catalog'),
  healthcheckConfig: () =>
    request<{ config: HealthcheckConfig; lastRun: HealthcheckRunSummary | null }>(
      'GET',
      '/api/settings/healthcheck/config',
    ),
  healthcheckUpdateConfig: (body: {
    enabledChecks: string[];
    scheduleHour: number;
    scheduleMinute: number;
    scheduleEnabled: boolean;
  }) => request<HealthcheckConfig>('PUT', '/api/settings/healthcheck/config', body),
  healthcheckRunNow: () =>
    request<{
      runId: string;
      results: HealthcheckResult[];
      emailSent: boolean;
      emailError: string | null;
    }>('POST', '/api/settings/healthcheck/run'),
  healthcheckHistory: (limit = 20) =>
    request<{ runs: HealthcheckRunSummary[] }>(
      'GET',
      `/api/settings/healthcheck/history?limit=${limit}`,
    ),
  healthcheckRunDetail: (id: string) =>
    request<HealthcheckRunDetail>('GET', `/api/settings/healthcheck/history/${id}`),

  // MFA (compte courant)
  mfaStatus: () => request<MfaStatus>('GET', '/api/account/mfa/status'),
  mfaSetup: () => request<MfaSetupResponse>('POST', '/api/account/mfa/setup'),
  mfaEnable: (code: string) =>
    request<MfaEnableResponse>('POST', '/api/account/mfa/enable', { code }),
  mfaDisable: (authHash: string, code: string) =>
    request<{ enabled: false }>('POST', '/api/account/mfa/disable', { authHash, code }),
  mfaRegenerateCodes: (code: string) =>
    request<{ backupCodes: string[] }>('POST', '/api/account/mfa/regenerate-codes', { code }),

  // Users
  listUsers: () => request<User[]>('GET', '/api/users'),
  createUser: (body: { username: string; authHash: string; email?: string; role?: 'ADMIN' | 'USER' }) =>
    request<User>('POST', '/api/users', body),
  updateUser: (id: string, body: Partial<{ email: string | null; active: boolean; role: 'ADMIN' | 'USER' }>) =>
    request<User>('PATCH', `/api/users/${id}`, body),
  deleteUser: (id: string) => request<{ ok: true }>('DELETE', `/api/users/${id}`),

  // Settings
  getEmailSettings: () => request<EmailConfig>('GET', '/api/settings/email'),
  updateEmailSettings: (body: EmailConfigInput) =>
    request<EmailConfig>('PUT', '/api/settings/email', body),
  testEmailSettings: (testEmail?: string) =>
    request<SmtpTestResult>('POST', '/api/settings/email/test', testEmail ? { testEmail } : {}),

  // Lockey — éléments chiffrés de bout en bout (le serveur ne stocke que
  // des blobs : `encryptedData`).
  listVaultItems: () => request<VaultItemRecord[]>('GET', '/api/vault/items'),
  createVaultItem: (body: { type: VaultItemType; favorite?: boolean; encryptedData: string }) =>
    request<VaultItemRecord>('POST', '/api/vault/items', body),
  updateVaultItem: (
    id: string,
    body: { type?: VaultItemType; favorite?: boolean; encryptedData?: string },
  ) => request<VaultItemRecord>('PATCH', `/api/vault/items/${id}`, body),
  deleteVaultItem: (id: string) =>
    request<{ ok: true }>('DELETE', `/api/vault/items/${id}`),

  // Audit
  audit: (params: {
    action?: string;
    userId?: string;
    serial?: string;
    success?: 'true' | 'false';
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') q.set(k, String(v));
    });
    const qs = q.toString();
    return request<AuditPage>('GET', `/api/audit${qs ? `?${qs}` : ''}`);
  },
};

export { ApiException };
