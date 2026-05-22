import type { Request, Response, NextFunction } from 'express';

/**
 * Protection CSRF légère par header custom (« double-submit » sans token).
 *
 * L'auth web repose sur un cookie httpOnly + SameSite=strict. SameSite seul
 * suffit sur les navigateurs modernes, mais on ajoute une seconde barrière :
 * toute requête mutante issue du SPA doit porter `X-Lockey-Client: web`. Un
 * formulaire HTML cross-site ne peut pas définir un header custom sans
 * preflight CORS, donc cette exigence neutralise les attaques CSRF même si
 * un futur changement de cookie/SameSite fait régresser la protection.
 *
 * Les requêtes authentifiées par token API (`Authorization: Bearer …`)
 * sont exemptées : un attaquant ne peut pas faire envoyer ce header par
 * le navigateur d'une victime, donc il n'y a pas de surface CSRF.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.headers.authorization) return next();
  if (req.headers['x-lockey-client'] === 'web') return next();
  res.status(403).json({
    error: 'csrf_required',
    message: 'Header X-Lockey-Client manquant.',
  });
}
