import { useCallback, useEffect, useRef, useState } from 'react';

const CLEAR_DELAY_MS = 30_000;
// Écrire un espace plutôt qu'une chaîne vide : certains navigateurs rejettent
// `writeText('')`. Un espace efface le contenu sensible sans déposer de payload utile.
const CLEAR_PAYLOAD = ' ';

export interface UseClipboardWithClear {
  copied: boolean;
  copy: (text: string) => Promise<boolean>;
}

/**
 * Copie text dans le presse-papier et l'efface après 30s.
 *
 * L'effacement nécessite que le document soit focused (contrainte navigateur).
 * Si le focus est perdu à T+30s — typique : l'utilisateur a basculé dans un
 * terminal pour coller son secret — l'écriture initiale échoue. On retente
 * automatiquement à chaque `focus` / `visibilitychange` jusqu'à réussir.
 *
 * On n'utilise pas `readText()` (bloqué sur Brave, demande de permission sur
 * Firefox) : on assume qu'effacer un éventuel autre contenu copié entre-temps
 * vaut mieux que laisser un mot de passe en clair dans le presse-papier.
 */
export function useClipboardWithClear(): UseClipboardWithClear {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const pendingClearRef = useRef(false);

  const tryClear = useCallback(async () => {
    if (!pendingClearRef.current) return;
    try {
      await navigator.clipboard.writeText(CLEAR_PAYLOAD);
      pendingClearRef.current = false;
      setCopied(false);
    } catch {
      // Focus toujours absent — on réessaiera au prochain regain de focus.
    }
  }, []);

  useEffect(() => {
    function onWake() {
      if (!pendingClearRef.current) return;
      // Petit délai pour laisser le navigateur stabiliser le focus avant d'écrire.
      window.setTimeout(tryClear, 0);
    }
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [tryClear]);

  const copy = useCallback(
    async (text: string) => {
      if (!text) return false;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }
      setCopied(true);
      pendingClearRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        tryClear();
      }, CLEAR_DELAY_MS);
      return true;
    },
    [tryClear],
  );

  return { copied, copy };
}
