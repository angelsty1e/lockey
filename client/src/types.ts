export type StatusLabel = 'valid' | 'expiring' | 'expired' | 'revoked';

export type UserRole = 'ADMIN' | 'USER';

export interface User {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  active: boolean;
  lastLoginAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserMini {
  id: string;
  username: string;
}

export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'SETTINGS_UPDATED'
  | 'SETTINGS_TEST_SENT'
  | 'VAULT_ITEM_CREATED'
  | 'VAULT_ITEM_UPDATED'
  | 'VAULT_ITEM_DELETED'
  | 'MFA_SETUP_INITIATED'
  | 'MFA_ENABLED'
  | 'MFA_DISABLED'
  | 'MFA_VERIFIED'
  | 'MFA_BACKUP_CODE_USED'
  | 'MFA_BACKUP_CODES_REGENERATED'
  | 'HEALTHCHECK_CONFIG_UPDATED'
  | 'HEALTHCHECK_RUN';

export type HealthcheckSeverity = 'OK' | 'WARN' | 'FAIL';

export interface HealthcheckCatalogItem {
  key: string;
  label: string;
  description: string;
}

export interface HealthcheckResult {
  key: string;
  label: string;
  ok: boolean;
  severity: HealthcheckSeverity;
  durationMs: number;
  message: string;
}

export interface HealthcheckConfig {
  enabledChecks: string[];
  scheduleHour: number;
  scheduleMinute: number;
  scheduleEnabled: boolean;
  lastRunAt: string | null;
}

export interface HealthcheckRunSummary {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: 'CRON' | 'MANUAL';
  ok: boolean;
  okCount: number;
  failCount: number;
  emailSent: boolean;
  emailError: string | null;
  recipientEmail?: string | null;
}

export interface HealthcheckRunDetail extends HealthcheckRunSummary {
  results: HealthcheckResult[];
}

export interface MfaStatus {
  enabled: boolean;
  activatedAt: string | null;
  backupCodesRemaining: number;
}

export interface MfaSetupResponse {
  otpauthUrl: string;
  qrDataUrl: string;
  secret: string;
}

export interface MfaEnableResponse {
  enabled: true;
  backupCodes: string[];
}

export interface LoginResponse {
  user?: User;
  mfaRequired?: boolean;
  mfaToken?: string;
  /** Clé de chiffrement emballée (chiffrement zéro-connaissance). Null si Lockey
   *  n'a pas encore été initialisé. */
  protectedVaultKey?: string | null;
}

export interface AuditLog {
  id: string;
  action: AuditAction;
  userId: string | null;
  user: { id: string; username: string } | null;
  username: string | null;
  ip: string | null;
  userAgent: string | null;
  serial: string | null;
  details: Record<string, unknown> | null;
  success: boolean;
  createdAt: string;
}

export interface AuditPage {
  items: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiError {
  error: string;
  message?: string;
  details?: unknown;
}

export interface EmailConfig {
  id: string;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  fromEmail: string | null;
  fromName: string | null;
  enabled: boolean;
  hasSmtpPass: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailConfigInput {
  smtpHost?: string | null;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  smtpPass?: string;
  fromEmail?: string | null;
  fromName?: string | null;
  enabled?: boolean;
}

export interface SmtpTestResult {
  success: boolean;
  message: string;
  messageId?: string;
}
