import { useEffect, useState } from 'react';
import { gsap } from 'gsap';
import { DURATION, EASE, prefersReducedMotion } from './motion';

/**
 * Hook réactif qui retourne `true` si l'utilisateur a activé `prefers-reduced-motion`.
 * Réagit aux changements en temps réel (l'utilisateur peut basculer la préférence
 * sans recharger). Met aussi à jour les defaults GSAP en conséquence.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => {
      setReduced(e.matches);
      gsap.defaults({
        duration: e.matches ? 0 : DURATION.base,
        ease: EASE.out,
        overwrite: 'auto',
      });
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
