import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';

gsap.registerPlugin(Flip);

/**
 * Durées partagées pour toutes les animations de l'app.
 * Garder court : on est sur une console sysadmin, pas une landing page.
 */
export const DURATION = {
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
  count: 0.8,
} as const;

/**
 * Easings standardisés. Toujours préférer ces alias plutôt que d'écrire
 * `power2.out` à la main pour garder une cohérence visuelle entre composants.
 */
export const EASE = {
  out: 'power2.out',
  in: 'power2.in',
  inOut: 'power2.inOut',
  pop: 'back.out(1.4)',
  back: 'back.out(1.6)',
} as const;

/**
 * Stagger par défaut pour les listes (lignes de tableau, items de palette, etc.).
 */
export const STAGGER = {
  tight: 0.015,
  base: 0.03,
  loose: 0.05,
} as const;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Initialise GSAP au boot de l'app. Doit être appelé une seule fois depuis main.tsx.
 * Si l'utilisateur a `prefers-reduced-motion: reduce`, les animations sautent à
 * leur état final (durée 0) — le rendu reste correct mais sans transition.
 */
export function configureMotion(): void {
  const reduced = prefersReducedMotion();
  gsap.defaults({
    duration: reduced ? 0 : DURATION.base,
    ease: EASE.out,
    overwrite: 'auto',
  });
}
