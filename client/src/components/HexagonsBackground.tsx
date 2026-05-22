import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { prefersReducedMotion } from '../utils/motion';

// Pattern hexagonal SVG en background, opacité pulsée doucement (yoyo).
// Esthétique "blue team / SOC" — cohérent avec une console de sécurité.
//
// Un seul tween cible l'opacité globale du <svg> : pas de surcoût à rendu
// (à comparer avec un canvas redessiné en boucle façon MatrixRain).
// Couleur via `currentColor` — le parent pilote la teinte avec sa propre `color`.

interface HexagonsBackgroundProps {
  className?: string;
  /** Espacement du pattern (px). Plus grand = hexagones plus larges. */
  size?: number;
  /** Épaisseur du trait (px). */
  strokeWidth?: number;
  /** Opacités min/max pour le cycle de pulse. */
  minOpacity?: number;
  maxOpacity?: number;
  /** Durée d'un cycle (s) — la pulsation va min → max → min en 2 × pulseDuration. */
  pulseDuration?: number;
}

export function HexagonsBackground({
  className = '',
  size = 56,
  strokeWidth = 0.6,
  minOpacity = 0.05,
  maxOpacity = 0.14,
  pulseDuration = 5,
}: HexagonsBackgroundProps) {
  const ref = useRef<SVGSVGElement>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      if (prefersReducedMotion()) {
        // Pas d'animation : on fige à mi-opacité, juste pour conserver la texture.
        gsap.set(ref.current, { opacity: (minOpacity + maxOpacity) / 2 });
        return;
      }
      gsap.set(ref.current, { opacity: minOpacity });
      gsap.to(ref.current, {
        opacity: maxOpacity,
        duration: pulseDuration,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      });
    },
    { scope: ref, dependencies: [minOpacity, maxOpacity, pulseDuration] },
  );

  // Hexagone "pointu en haut" : 6 sommets autour du centre d'une tile w × h
  // (h = w * sqrt(3)/2 pour un hexagone régulier).
  const w = size;
  const h = size * 0.866;
  const halfH = h / 2;

  const hexagon = (offsetX = 0, offsetY = 0): string =>
    [
      [w * 0.5 + offsetX, 0 + offsetY],
      [w + offsetX, halfH * 0.5 + offsetY],
      [w + offsetX, h - halfH * 0.5 + offsetY],
      [w * 0.5 + offsetX, h + offsetY],
      [0 + offsetX, h - halfH * 0.5 + offsetY],
      [0 + offsetX, halfH * 0.5 + offsetY],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(' ');

  return (
    <svg
      ref={ref}
      className={`hexagons-bg ${className}`.trim()}
      aria-hidden="true"
      style={{ opacity: minOpacity }}
    >
      <defs>
        <pattern
          id="hexagons-pattern"
          x="0"
          y="0"
          width={w * 1.5}
          height={h}
          patternUnits="userSpaceOnUse"
        >
          <polygon
            points={hexagon()}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
          />
          <polygon
            points={hexagon(w * 0.75, h * 0.5)}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hexagons-pattern)" />
    </svg>
  );
}
