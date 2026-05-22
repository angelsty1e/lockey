import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { generateTotp, totpRemaining, totpCounter } from '../vault/totp';

const RING_R = 9;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Affiche le code TOTP courant d'un secret 2FA, rafraîchi chaque seconde,
 * avec un anneau de décompte avant rotation.
 */
export function TotpField({ secret }: { secret: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(30);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    let lastCounter = -1;

    async function tick() {
      const counter = totpCounter();
      if (counter !== lastCounter) {
        lastCounter = counter;
        try {
          const c = await generateTotp(secret);
          if (mounted) {
            setCode(c);
            setError(false);
          }
        } catch {
          if (mounted) {
            setError(true);
            setCode(null);
          }
        }
      }
      if (mounted) setRemaining(totpRemaining());
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [secret]);

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* presse-papiers indisponible */
    }
  }

  if (error) {
    return <span className="totp-error">Clé 2FA invalide</span>;
  }
  if (!code) {
    return <span className="muted">…</span>;
  }

  const formatted = `${code.slice(0, 3)} ${code.slice(3)}`;
  const low = remaining <= 5;

  return (
    <div className="totp-field">
      <span className="totp-code mono">{formatted}</span>
      <svg className="totp-ring" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r={RING_R} className="totp-ring-bg" />
        <circle
          cx="12"
          cy="12"
          r={RING_R}
          className={low ? 'totp-ring-fg totp-ring-low' : 'totp-ring-fg'}
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - remaining / 30)}
          transform="rotate(-90 12 12)"
        />
      </svg>
      <span className={'totp-secs' + (low ? ' totp-secs-low' : '')}>{remaining}s</span>
      <button type="button" className="icon-btn" onClick={copy} aria-label="Copier le code" title="Copier">
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}
