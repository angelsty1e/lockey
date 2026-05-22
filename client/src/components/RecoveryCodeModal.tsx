import { useState } from 'react';
import { Copy, Check, KeyRound } from 'lucide-react';
import { Modal } from './Modal';

/**
 * Affiche le code de récupération UNE seule fois. Tant que l'utilisateur n'a
 * pas confirmé l'avoir sauvegardé, la fermeture est bloquée.
 */
export function RecoveryCodeModal({ code, onClose }: { code: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponible — l'utilisateur peut copier à la main */
    }
  }

  return (
    <Modal
      title="Code de récupération"
      onClose={onClose}
      size="md"
      preventClose
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={!acknowledged}
          onClick={onClose}
        >
          Continuer
        </button>
      }
    >
      <div className="form-warning" style={{ marginBottom: 16 }}>
        <strong>Ce code ne sera plus jamais affiché.</strong> C'est la seule façon
        de récupérer votre Lockey si vous oubliez votre mot de passe maître —
        ni vous ni le serveur ne pouvez le retrouver autrement. Conservez-le hors
        ligne (imprimé, dans un autre gestionnaire, un endroit sûr).
      </div>

      <div className="recovery-code-box">
        <KeyRound size={18} strokeWidth={1.75} aria-hidden="true" />
        <code className="mono recovery-code">{code}</code>
      </div>

      <button type="button" className="btn btn-secondary" onClick={copy} style={{ marginTop: 12 }}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? 'Copié' : 'Copier le code'}
      </button>

      <label className="recovery-ack">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={e => setAcknowledged(e.target.checked)}
        />
        <span>J'ai sauvegardé ce code de récupération en lieu sûr.</span>
      </label>
    </Modal>
  );
}
