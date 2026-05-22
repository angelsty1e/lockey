import type { Response, CookieOptions } from 'express';
import { env } from './env.js';

export const SESSION_COOKIE = 'lockey_session';

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: '/api',
  };
}

export function setSessionCookie(res: Response, token: string, maxAgeMs?: number) {
  res.cookie(SESSION_COOKIE, token, {
    ...baseOptions(),
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, baseOptions());
}
