import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { DURATION, EASE, prefersReducedMotion } from '../utils/motion';

interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'error' | 'info';
}

const TOAST_DURATION_S = 4;

interface ToastApi {
  push: (msg: string, kind?: Toast['kind']) => void;
  ok: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((msg: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev, { id, msg, kind }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id));
  }, []);

  // Mémoiser l'objet api pour garder une identité référentielle stable. Sinon
  // tout `useEffect([toast])` se redéclencherait à chaque render du Provider
  // (notamment quand un toast s'affiche / disparaît) → boucle infinie de fetch.
  const api = useMemo<ToastApi>(() => ({
    push,
    ok: (msg: string) => push(msg, 'ok'),
    error: (msg: string) => push(msg, 'error'),
    info: (msg: string) => push(msg, 'info'),
  }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {items.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const elRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!elRef.current) return;
    const reduced = prefersReducedMotion();
    const tl = gsap.timeline({ onComplete: () => onDismiss(toast.id) });

    if (!reduced) {
      tl.from(elRef.current, { x: 100, opacity: 0, duration: DURATION.base, ease: EASE.out });
    }

    if (barRef.current) {
      tl.fromTo(
        barRef.current,
        { scaleX: 1 },
        { scaleX: 0, duration: TOAST_DURATION_S, ease: 'none' },
      );
    } else {
      tl.to({}, { duration: TOAST_DURATION_S });
    }

    if (!reduced) {
      tl.to(elRef.current, { x: 100, opacity: 0, duration: DURATION.base, ease: EASE.in });
    }
  }, []);

  return (
    <div
      ref={elRef}
      className={`toast toast-${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
    >
      {toast.msg}
      <div ref={barRef} className="toast-progress" aria-hidden="true" />
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
