import { Modal } from './Modal';

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: { section: string; items: Shortcut[] }[] = [
  {
    section: 'Global',
    items: [
      { keys: ['Ctrl', 'K'], description: 'Ouvrir la recherche / palette de commandes' },
      { keys: ['?'], description: 'Afficher cette aide' },
      { keys: ['Esc'], description: 'Fermer la fenêtre / palette en cours' },
    ],
  },
  {
    section: 'Modale / Palette',
    items: [
      { keys: ['↑'], description: 'Élément précédent' },
      { keys: ['↓'], description: 'Élément suivant' },
      { keys: ['Entrée'], description: "Valider l'élément actif" },
      { keys: ['Tab'], description: 'Champ suivant (focus piégé dans la modale)' },
    ],
  },
];

interface Props {
  onClose: () => void;
}

export function ShortcutsHelp({ onClose }: Props) {
  return (
    <Modal title="Raccourcis clavier" onClose={onClose} size="md">
      <div className="shortcuts-list">
        {SHORTCUTS.map(s => (
          <section key={s.section} className="shortcuts-section">
            <h4>{s.section}</h4>
            <dl>
              {s.items.map((it, i) => (
                <div key={i} className="shortcuts-row">
                  <dt>
                    {it.keys.map((k, j) => (
                      <span key={j}>
                        <kbd>{k}</kbd>
                        {j < it.keys.length - 1 && <span className="kbd-sep">+</span>}
                      </span>
                    ))}
                  </dt>
                  <dd>{it.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
