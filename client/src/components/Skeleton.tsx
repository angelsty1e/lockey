import type { CSSProperties } from 'react';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ width, height, radius, className, style }: SkeletonProps) {
  return (
    <span
      className={`skeleton${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{
        width: width ?? '100%',
        height: height ?? '1em',
        borderRadius: radius ?? 4,
        ...style,
      }}
    />
  );
}

interface SkeletonTableProps {
  rows?: number;
  cols: number;
  /** Largeurs cibles par colonne, en %. Sinon réparties uniformément. */
  widths?: (string | number)[];
  /** Largeur de la colonne d'actions (dernière) — rendue plus étroite. */
  hasActions?: boolean;
  caption?: string;
}

export function SkeletonTable({ rows = 5, cols, widths, hasActions, caption = 'Chargement…' }: SkeletonTableProps) {
  return (
    <div className="table-wrap" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{caption}</span>
      <table className="table table-skeleton" aria-hidden="true">
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
              {Array.from({ length: cols }).map((_, j) => {
                const isActions = hasActions && j === cols - 1;
                const w = widths?.[j] ?? (isActions ? 80 : `${Math.floor(40 + ((i * 7 + j * 13) % 50))}%`);
                return (
                  <td key={j}>
                    <Skeleton width={w} height={14} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SpinnerInlineProps {
  label?: string;
  size?: number;
}

export function SpinnerInline({ label = 'En cours', size = 14 }: SpinnerInlineProps) {
  return (
    <span
      className="spinner-inline"
      role="status"
      aria-label={label}
      style={{ width: size, height: size }}
    />
  );
}
