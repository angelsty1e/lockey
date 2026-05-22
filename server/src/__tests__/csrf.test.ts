import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireCsrfHeader } from '../csrf.js';

/**
 * Tests du middleware CSRF par header double-submit. Aucune dépendance DB
 * — middleware pur. On mock req/res/next à la main pour rester explicite
 * sur ce qui est exercé.
 */

interface FakeReq {
  method: string;
  headers: Record<string, string | undefined>;
}

function buildReq(method: string, headers: Record<string, string | undefined> = {}): Request {
  return { method, headers } as unknown as Request;
}

function buildRes(): Response & { _status?: number; _body?: unknown } {
  const res: Partial<Response> & { _status?: number; _body?: unknown } = {};
  res.status = vi.fn().mockImplementation((code: number) => {
    res._status = code;
    return res as Response;
  });
  res.json = vi.fn().mockImplementation((body: unknown) => {
    res._body = body;
    return res as Response;
  });
  return res as Response & { _status?: number; _body?: unknown };
}

describe('requireCsrfHeader — méthodes safe (pass-through)', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('%s passe sans header', method => {
    const next = vi.fn();
    const res = buildRes();
    requireCsrfHeader(buildReq(method), res, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('requireCsrfHeader — méthodes mutantes (POST/PUT/DELETE/PATCH)', () => {
  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])(
    '%s sans header X-Lockey-Client ni Authorization → 403',
    method => {
      const next = vi.fn();
      const res = buildRes();
      requireCsrfHeader(buildReq(method), res, next as NextFunction);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res._body).toMatchObject({ error: 'csrf_required' });
    },
  );

  it('POST avec X-Lockey-Client: web → next()', () => {
    const next = vi.fn();
    const res = buildRes();
    requireCsrfHeader(buildReq('POST', { 'x-lockey-client': 'web' }), res, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('POST avec X-Lockey-Client: mauvaise valeur → 403', () => {
    // Régression : seule la valeur exacte « web » doit passer. Sinon un
    // attaquant qui peut influencer le header (depuis un sous-domaine
    // mal configuré) bypass la garde.
    const next = vi.fn();
    const res = buildRes();
    requireCsrfHeader(buildReq('POST', { 'x-lockey-client': 'cli' }), res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('POST avec Authorization: Bearer <token> → next() (token API exempté)', () => {
    const next = vi.fn();
    const res = buildRes();
    requireCsrfHeader(
      buildReq('POST', { authorization: 'Bearer tok_aaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
      res,
      next as NextFunction,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('POST avec Authorization quelconque → next() (présence du header suffit)', () => {
    // Note : la validité du token est vérifiée plus loin par requireAuth.
    // CSRF se contente de constater qu'il n'y a pas de surface CSRF (header
    // Authorization ne peut être posé par un formulaire HTML cross-site).
    const next = vi.fn();
    const res = buildRes();
    requireCsrfHeader(
      buildReq('POST', { authorization: 'Bearer ce-nest-pas-un-vrai-token' }),
      res,
      next as NextFunction,
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('requireCsrfHeader — réponse d\'erreur', () => {
  it('payload 403 contient code + message lisible', () => {
    const next = vi.fn();
    const res = buildRes();
    requireCsrfHeader(buildReq('POST'), res, next as NextFunction);
    expect(res._body).toEqual({
      error: 'csrf_required',
      message: 'Header X-Lockey-Client manquant.',
    });
  });
});
