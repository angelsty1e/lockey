import type { Request, Response, NextFunction } from 'express';

/**
 * Protection CSRF par header custom obligatoire.
 *
 * L'auth web repose sur un cookie httpOnly + SameSite=strict. En complément,
 * toute requête mutante doit porter `X-Lockey-Client: web`. C'est une parade
 * CSRF reconnue (OWASP « Use of Custom Request Headers ») : un navigateur
 * interdit de poser un header custom en cross-origin sans preflight CORS, que
 * le serveur n'autorise pas. Deux couches indépendantes (SameSite + header).
 *
 * S1 — l'ancienne exemption `Authorization` a été retirée : aucun flux Bearer
 * n'existe (l'auth est exclusivement par cookie de session), donc cette
 * exemption ne protégeait qu'une surface inexistante et brouillait la garde.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.headers['x-lockey-client'] === 'web') return next();
  res.status(403).json({
    error: 'csrf_required',
    message: 'Header X-Lockey-Client manquant.',
  });
}
