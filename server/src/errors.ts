export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'unauthorized') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'forbidden') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'not_found') => new HttpError(404, 'not_found', msg);
export const conflict = (msg: string) => new HttpError(409, 'conflict', msg);
export const tooMany = (msg = 'too_many_requests') => new HttpError(429, 'too_many_requests', msg);
export const internal = (msg = 'internal_error') => new HttpError(500, 'internal_error', msg);

/**
 * Sanitize stderr/stdout from external processes before exposing upstream.
 * Strips absolute file paths and limits verbosity.
 */
export function sanitizeShellError(raw: string): string {
  return raw
    .split('\n')
    .map(line => line.replace(/\/[\w./-]+/g, '<path>'))
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ')
    .slice(0, 300);
}
