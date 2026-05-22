import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { DURATION, EASE, prefersReducedMotion } from '../utils/motion';

interface Props {
  value: number;
  className?: string;
}

/**
 * Anime un nombre de sa valeur courante vers `value` à chaque changement.
 * Premier rendu : tween 0 → value. Re-render : tween depuis la dernière valeur
 * (gérée implicitement par GSAP via `objRef.current.val`).
 *
 * Si l'utilisateur a `prefers-reduced-motion`, la valeur est appliquée
 * directement sans tween.
 */
export function AnimatedNumber({ value, className }: Props) {
  const elRef = useRef<HTMLSpanElement>(null);
  const objRef = useRef({ val: 0 });

  useGSAP(() => {
    if (!elRef.current) return;
    if (prefersReducedMotion()) {
      objRef.current.val = value;
      elRef.current.textContent = String(value);
      return;
    }
    gsap.to(objRef.current, {
      val: value,
      duration: DURATION.count,
      ease: EASE.out,
      onUpdate: () => {
        if (elRef.current) {
          elRef.current.textContent = String(Math.round(objRef.current.val));
        }
      },
    });
  }, [value]);

  return <span ref={elRef} className={className}>0</span>;
}
