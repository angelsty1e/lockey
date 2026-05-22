import { useEffect } from 'react';

interface Options {
  /** Si true, le raccourci se déclenche aussi quand le focus est dans un input/textarea/contenteditable. */
  allowInInputs?: boolean;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

/**
 * Match patterns supported:
 *   "k"          → simple key (skip si focus dans input sauf allowInInputs)
 *   "?"          → simple key (idem)
 *   "mod+k"      → Ctrl (Win/Linux) ou Cmd (Mac)
 *   "mod+shift+k"
 */
export function useGlobalShortcut(
  pattern: string,
  handler: (e: KeyboardEvent) => void,
  options: Options = {},
) {
  useEffect(() => {
    const parts = pattern.toLowerCase().split('+').map(s => s.trim());
    const key = parts[parts.length - 1];
    const wantMod = parts.includes('mod');
    const wantShift = parts.includes('shift');
    const wantAlt = parts.includes('alt');

    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (wantMod !== mod) return;
      if (wantShift !== e.shiftKey) return;
      if (wantAlt !== e.altKey) return;
      if (e.key.toLowerCase() !== key) return;
      if (!options.allowInInputs && !wantMod && isTypingTarget(e.target)) return;
      handler(e);
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pattern, handler, options.allowInInputs]);
}
