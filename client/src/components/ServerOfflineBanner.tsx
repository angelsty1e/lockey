import { useState } from 'react';
import { RefreshCw, WifiOff, X } from 'lucide-react';

interface Props {
  errorMessage?: string | null;
  onRetry: () => void | Promise<void>;
  onDismiss?: () => void;
}

export function ServerOfflineBanner({ errorMessage, onRetry, onDismiss }: Props) {
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="offline-banner" role="alert" aria-live="assertive">
      <div className="offline-banner-inner">
        <div className="offline-banner-msg">
          <WifiOff size={18} aria-hidden="true" />
          <span>
            {errorMessage || 'Connexion au serveur perdue. Vos modifications ne seront pas sauvegardées.'}
          </span>
        </div>

        <div className="offline-banner-actions">
          <button
            type="button"
            className="offline-banner-btn"
            onClick={handleRetry}
            disabled={retrying}
          >
            <RefreshCw size={14} className={retrying ? 'offline-spin' : ''} aria-hidden="true" />
            {retrying ? 'Reconnexion…' : 'Réessayer'}
          </button>
          {onDismiss && (
            <button
              type="button"
              className="offline-banner-close"
              onClick={onDismiss}
              aria-label="Fermer"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
