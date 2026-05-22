import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { DURATION, prefersReducedMotion } from '../utils/motion';

interface Props {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Désactive la fermeture par backdrop + Échap (utile pendant une opération async). */
  preventClose?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, children, onClose, footer, size = 'md', preventClose = false }: Props) {
  const titleId = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const closingRef = useRef(false);

  useGSAP(() => {
    if (prefersReducedMotion()) return;
    const tl = gsap.timeline();
    if (backdropRef.current) {
      tl.from(backdropRef.current, { opacity: 0, duration: DURATION.fast });
    }
    if (dialogRef.current) {
      tl.from(
        dialogRef.current,
        { opacity: 0, scale: 0.96, y: -8, duration: DURATION.base, ease: 'power3.out' },
        '-=0.1',
      );
    }
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    const tl = gsap.timeline({ onComplete: onClose });
    if (dialogRef.current) {
      tl.to(dialogRef.current, {
        opacity: 0,
        scale: 0.96,
        y: -8,
        duration: DURATION.fast,
        ease: 'power3.in',
      });
    }
    if (backdropRef.current) {
      tl.to(backdropRef.current, { opacity: 0, duration: DURATION.fast }, '<');
    }
  }, [onClose]);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const root = dialogRef.current;
    if (root) {
      const first = root.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? root).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!preventClose) requestClose();
        return;
      }
      if (e.key === 'Tab' && root) {
        const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
          .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused.current?.focus?.();
    };
  }, [requestClose, preventClose]);

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop"
      onClick={preventClose ? undefined : requestClose}
    >
      <div
        ref={dialogRef}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button
            className="modal-close"
            onClick={requestClose}
            aria-label="Fermer"
            disabled={preventClose}
          >×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
