/**
 * Helpers de formatage centralisés. Tous les composants doivent passer par ici
 * plutôt que d'utiliser `toLocaleString('fr-FR', …)` directement, pour garantir
 * un rendu cohérent (date courte vs date+heure) à travers l'app.
 */

const DT_OPTS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

const D_OPTS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
};

/**
 * Formate une date ISO en français.
 *  - `datetime` (défaut) : `06/05/2026 14:32`
 *  - `date`              : `06/05/2026`
 */
export function formatDate(iso?: string | null, mode: 'datetime' | 'date' = 'datetime'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', mode === 'date' ? D_OPTS : DT_OPTS);
}

/**
 * Extrait un message lisible d'une erreur API ou JS, avec un fallback français
 * obligatoire pour ne jamais exposer un `undefined` ou un message brut anglais.
 *
 * Pattern d'usage :
 *   catch (e) { toast.error(formatApiError(e, 'Erreur lors de la révocation')); }
 */
export function formatApiError(e: unknown, fallback: string): string {
  if (!e) return fallback;
  if (typeof e === 'string') return e || fallback;
  if (e instanceof Error) {
    const msg = e.message?.trim();
    if (!msg) return fallback;
    // Heuristique : un message brut HTTP en anglais ("Bad Request", "Forbidden",
    // "Internal Server Error") n'est pas utile à l'utilisateur final.
    if (/^(bad request|forbidden|unauthorized|not found|internal server error|service unavailable)$/i.test(msg)) {
      return fallback;
    }
    return msg;
  }
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return fallback;
}
