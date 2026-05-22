import { useTheme, type ThemeChoice } from '../utils/useTheme';

const OPTIONS: { value: ThemeChoice; label: string; symbol: string; aria: string }[] = [
  { value: 'light', label: 'Clair', symbol: '☀', aria: 'Thème clair' },
  { value: 'system', label: 'Système', symbol: '◐', aria: 'Suivre le thème système' },
  { value: 'dark', label: 'Sombre', symbol: '☾', aria: 'Thème sombre' },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Thème de l'interface">
      {OPTIONS.map(o => {
        const selected = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            className={'theme-toggle-btn' + (selected ? ' active' : '')}
            role="radio"
            aria-checked={selected}
            aria-label={o.aria}
            title={o.label}
            onClick={() => setTheme(o.value)}
          >
            <span aria-hidden="true">{o.symbol}</span>
          </button>
        );
      })}
    </div>
  );
}
