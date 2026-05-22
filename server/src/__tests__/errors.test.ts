import { describe, it, expect } from 'vitest';
import {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooMany,
  internal,
  sanitizeShellError,
} from '../errors.js';

/**
 * sanitizeShellError est utilisé pour exposer la sortie d'erreur de
 * processus externes à l'API sans fuiter les chemins absolus du serveur
 * ni la verbosité interne.
 */

describe('HttpError factories', () => {
  it('badRequest = 400', () => {
    const e = badRequest('mauvais payload');
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(400);
    expect(e.code).toBe('bad_request');
    expect(e.message).toBe('mauvais payload');
  });

  it('unauthorized = 401', () => {
    expect(unauthorized().status).toBe(401);
    expect(unauthorized().code).toBe('unauthorized');
  });

  it('forbidden = 403', () => {
    expect(forbidden().status).toBe(403);
    expect(forbidden().code).toBe('forbidden');
  });

  it('notFound = 404', () => {
    expect(notFound().status).toBe(404);
    expect(notFound().code).toBe('not_found');
  });

  it('conflict = 409', () => {
    expect(conflict('déjà existant').status).toBe(409);
  });

  it('tooMany = 429', () => {
    expect(tooMany().status).toBe(429);
    expect(tooMany().code).toBe('too_many_requests');
  });

  it('internal = 500', () => {
    expect(internal().status).toBe(500);
  });

  it('details est attaché si fourni', () => {
    const e = badRequest('msg', { field: 'username' });
    expect(e.details).toEqual({ field: 'username' });
  });
});

describe('sanitizeShellError — redaction des chemins', () => {
  it('remplace un chemin absolu unix par <path>', () => {
    expect(sanitizeShellError('error reading /etc/passwd')).toBe('error reading <path>');
  });

  it('redact tous les chemins absolus du serveur', () => {
    const raw = 'unable to load private key from /tmp/abc/data.json';
    expect(sanitizeShellError(raw)).toBe('unable to load private key from <path>');
  });

  it('redact plusieurs chemins sur la même ligne', () => {
    const raw = '/var/cache/data/foo.tmp is invalid against /etc/app/config.json';
    expect(sanitizeShellError(raw)).toBe('<path> is invalid against <path>');
  });

  it('préserve le message d\'erreur lisible', () => {
    expect(sanitizeShellError('unable to load private key')).toBe('unable to load private key');
    expect(sanitizeShellError('bad decrypt')).toBe('bad decrypt');
  });
});

describe('sanitizeShellError — bornes', () => {
  it('ne garde que les 3 premières lignes (limite de verbosité)', () => {
    const raw = ['ligne 1', 'ligne 2', 'ligne 3', 'ligne 4 cachée', 'ligne 5'].join('\n');
    const out = sanitizeShellError(raw);
    expect(out).toBe('ligne 1 | ligne 2 | ligne 3');
    expect(out).not.toContain('ligne 4');
  });

  it('élimine les lignes vides intercalées', () => {
    const raw = 'ligne A\n\n\nligne B';
    expect(sanitizeShellError(raw)).toBe('ligne A | ligne B');
  });

  it('borne la sortie à 300 caractères', () => {
    const raw = 'x'.repeat(1000);
    expect(sanitizeShellError(raw).length).toBeLessThanOrEqual(300);
  });

  it('joint les lignes restantes par " | " plutôt que par newline', () => {
    expect(sanitizeShellError('a\nb\nc')).toBe('a | b | c');
  });

  it('chaîne vide → chaîne vide', () => {
    expect(sanitizeShellError('')).toBe('');
  });
});
