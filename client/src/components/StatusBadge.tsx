import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import type { StatusLabel } from '../types';
import { prefersReducedMotion } from '../utils/motion';

const labels: Record<StatusLabel, string> = {
  valid: 'Valide',
  expiring: 'Expire bientôt',
  expired: 'Expiré',
  revoked: 'Révoqué',
};

export function StatusBadge({ status }: { status: StatusLabel }) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(() => {
    if (status !== 'expiring' || prefersReducedMotion() || !ref.current) return;
    gsap.to(ref.current, {
      scale: 1.06,
      repeat: -1,
      yoyo: true,
      duration: 1.2,
      ease: 'sine.inOut',
    });
  }, { dependencies: [status] });

  return <span ref={ref} className={`status-badge status-${status}`}>{labels[status]}</span>;
}

export function TypeBadge({ type }: { type: string }) {
  const t = type.toLowerCase();
  return <span className={`type-badge type-${t}`}>{t === 'unknown' ? '—' : t}</span>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
