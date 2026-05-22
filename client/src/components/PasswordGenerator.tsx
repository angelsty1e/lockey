import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Copy, Check } from 'lucide-react';
import { Modal } from './Modal';
import {
  generatePassword,
  generatePassphrase,
  passwordStrength,
} from '../vault/generator';

interface Props {
  onClose: () => void;
  /** Si fourni, affiche un bouton « Utiliser » qui renvoie la valeur générée. */
  onUse?: (value: string) => void;
}

export function PasswordGenerator({ onClose, onUse }: Props) {
  const [mode, setMode] = useState<'password' | 'passphrase'>('password');

  // Options — mot de passe
  const [length, setLength] = useState(20);
  const [lower, setLower] = useState(true);
  const [upper, setUpper] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [avoidAmbiguous, setAvoidAmbiguous] = useState(true);

  // Options — phrase de passe
  const [words, setWords] = useState(5);
  const [separator, setSeparator] = useState('-');
  const [capitalize, setCapitalize] = useState(true);
  const [includeNumber, setIncludeNumber] = useState(true);

  const [value, setValue] = useState('');
  const [copied, setCopied] = useState(false);

  const regenerate = useCallback(() => {
    if (mode === 'password') {
      setValue(generatePassword({ length, lower, upper, digits, symbols, avoidAmbiguous }));
    } else {
      setValue(generatePassphrase({ words, separator, capitalize, includeNumber }));
    }
  }, [
    mode, length, lower, upper, digits, symbols, avoidAmbiguous,
    words, separator, capitalize, includeNumber,
  ]);

  // Régénère à chaque changement d'option.
  useEffect(() => {
    regenerate();
  }, [regenerate]);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* presse-papiers indisponible */
    }
  }

  const strength = passwordStrength(value);

  return (
    <Modal
      title="Générateur"
      onClose={onClose}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {onUse ? 'Annuler' : 'Fermer'}
          </button>
          {onUse && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!value}
              onClick={() => onUse(value)}
            >
              Utiliser
            </button>
          )}
        </>
      }
    >
      <div className="gen-mode">
        <button
          type="button"
          className={'chip' + (mode === 'password' ? ' chip-active' : '')}
          onClick={() => setMode('password')}
        >
          Mot de passe
        </button>
        <button
          type="button"
          className={'chip' + (mode === 'passphrase' ? ' chip-active' : '')}
          onClick={() => setMode('passphrase')}
        >
          Phrase de passe
        </button>
      </div>

      <div className="gen-result">
        <code className="mono gen-value">{value || '—'}</code>
        <div className="gen-result-actions">
          <button type="button" className="icon-btn" onClick={regenerate} aria-label="Régénérer" title="Régénérer">
            <RefreshCw size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={copy} aria-label="Copier" title="Copier">
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </div>

      {value && (
        <div className={`pwd-strength pwd-strength-${strength.score}`}>
          <div className="pwd-bar"><span style={{ width: `${(strength.score / 4) * 100}%` }} /></div>
          <span className="hint">{strength.label}</span>
        </div>
      )}

      {mode === 'password' ? (
        <div className="gen-options">
          <div className="gen-row">
            <label htmlFor="gen-length">Longueur : {length}</label>
            <input
              id="gen-length"
              type="range"
              min={8}
              max={64}
              value={length}
              onChange={e => setLength(Number(e.target.value))}
            />
          </div>
          <label className="gen-check">
            <input type="checkbox" checked={lower} onChange={e => setLower(e.target.checked)} />
            <span>Minuscules (a-z)</span>
          </label>
          <label className="gen-check">
            <input type="checkbox" checked={upper} onChange={e => setUpper(e.target.checked)} />
            <span>Majuscules (A-Z)</span>
          </label>
          <label className="gen-check">
            <input type="checkbox" checked={digits} onChange={e => setDigits(e.target.checked)} />
            <span>Chiffres (0-9)</span>
          </label>
          <label className="gen-check">
            <input type="checkbox" checked={symbols} onChange={e => setSymbols(e.target.checked)} />
            <span>Symboles (!@#…)</span>
          </label>
          <label className="gen-check">
            <input
              type="checkbox"
              checked={avoidAmbiguous}
              onChange={e => setAvoidAmbiguous(e.target.checked)}
            />
            <span>Éviter les caractères ambigus (l, I, O, 0, 1)</span>
          </label>
        </div>
      ) : (
        <div className="gen-options">
          <div className="gen-row">
            <label htmlFor="gen-words">Nombre de mots : {words}</label>
            <input
              id="gen-words"
              type="range"
              min={3}
              max={10}
              value={words}
              onChange={e => setWords(Number(e.target.value))}
            />
          </div>
          <div className="gen-row">
            <label htmlFor="gen-sep">Séparateur</label>
            <input
              id="gen-sep"
              type="text"
              maxLength={3}
              value={separator}
              onChange={e => setSeparator(e.target.value)}
              style={{ width: 64 }}
            />
          </div>
          <label className="gen-check">
            <input
              type="checkbox"
              checked={capitalize}
              onChange={e => setCapitalize(e.target.checked)}
            />
            <span>Première lettre en majuscule</span>
          </label>
          <label className="gen-check">
            <input
              type="checkbox"
              checked={includeNumber}
              onChange={e => setIncludeNumber(e.target.checked)}
            />
            <span>Inclure un chiffre</span>
          </label>
        </div>
      )}
    </Modal>
  );
}
