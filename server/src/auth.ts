import type { Request, Response, NextFunction } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma } from './db.js';
import { env } from './env.js';
import { unauthorized, forbidden } from './errors.js';
import { SESSION_COOKIE } from './cookies.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        role: 'ADMIN' | 'USER';
        via: 'jwt';
      };
    }
  }
}

interface JwtPayload {
  sub: string;
  username: string;
  tv: number;
}

export function signJwt(payload: JwtPayload): string {
  const opts: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    algorithm: 'HS256',
  };
  return jwt.sign(payload, env.JWT_SECRET, opts);
}

export function verifyJwt(token: string): JwtPayload {
  // S6 — liste blanche d'algorithme explicite : empêche toute confusion
  // d'algorithme (ex. acceptation d'un `alg` asymétrique introduit plus tard).
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
}

/**
 * Token éphémère (5 min) émis après validation du mdp quand l'utilisateur a
 * le 2FA activé. Ne donne aucun droit d'accès aux ressources — il sert
 * uniquement à prouver à l'endpoint /login/mfa que l'étape 1 a été passée.
 * Stage = 'mfa' pour empêcher la confusion avec un JWT de session normal.
 */
interface MfaChallengePayload {
  sub: string;
  stage: 'mfa';
  tv: number;
}

export function signMfaChallenge(payload: Omit<MfaChallengePayload, 'stage'>): string {
  return jwt.sign({ ...payload, stage: 'mfa' as const }, env.JWT_SECRET, {
    expiresIn: '5m',
    algorithm: 'HS256',
  });
}

export function verifyMfaChallenge(token: string): MfaChallengePayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
  }) as MfaChallengePayload;
  if (decoded.stage !== 'mfa') throw new Error('not an MFA challenge token');
  return decoded;
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const comparePassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

async function authenticateJwt(token: string) {
  let payload: JwtPayload;
  try {
    payload = verifyJwt(token);
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, username: true, role: true, active: true, tokenVersion: true },
  });
  if (!user || !user.active) return null;
  if (typeof payload.tv !== 'number' || payload.tv !== user.tokenVersion) return null;
  return { id: user.id, username: user.username, role: user.role as 'ADMIN' | 'USER' };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  // Session interactive uniquement : cookie httpOnly portant le JWT.
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[
    SESSION_COOKIE
  ];
  if (cookieToken) {
    authenticateJwt(cookieToken)
      .then(user => {
        if (!user) return next(unauthorized('session invalide'));
        req.user = { ...user, via: 'jwt' };
        next();
      })
      .catch(next);
    return;
  }

  return next(unauthorized('authentification requise'));
}

/**
 * Restreint une opération aux sessions interactives. Conservé pour
 * compatibilité : toute authentification passe désormais par un JWT de
 * session, donc ce garde ne fait que vérifier la présence de `req.user`.
 */
export function requireSession(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Restrict an op to admin sessions. Must run AFTER requireAuth (+ usually requireSession). */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'ADMIN') return next(forbidden('admin requis'));
  next();
}
