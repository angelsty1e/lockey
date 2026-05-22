import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { DURATION, EASE, prefersReducedMotion } from '../utils/motion';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: 'Navigation';
  perform: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const listId = useId();

  useEffect(() => {
    if (open) closingRef.current = false;
  }, [open]);

  useGSAP(() => {
    if (!open || prefersReducedMotion()) return;
    const tl = gsap.timeline({
      defaults: { clearProps: 'opacity,scale,y' },
    });
    if (backdropRef.current) {
      tl.from(backdropRef.current, { opacity: 0, duration: DURATION.fast, ease: EASE.out });
    }
    if (panelRef.current) {
      tl.from(
        panelRef.current,
        { opacity: 0, scale: 0.95, y: -12, duration: DURATION.base, ease: 'power3.out' },
        '-=0.1',
      );
    }
    tl.from(
      '.cmdk-item',
      { opacity: 0, y: 4, stagger: 0.015, duration: DURATION.fast, ease: EASE.out },
      '-=0.15',
    );
  }, { dependencies: [open] });

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    const tl = gsap.timeline({ onComplete: onClose });
    if (panelRef.current) {
      tl.to(panelRef.current, {
        opacity: 0,
        scale: 0.95,
        y: -8,
        duration: DURATION.fast,
        ease: 'power3.in',
      });
    }
    if (backdropRef.current) {
      tl.to(backdropRef.current, { opacity: 0, duration: DURATION.fast }, '<');
    }
  }, [onClose]);

  // Reset state on open / focus input.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const navCommands: Command[] = useMemo(() => [
    { id: 'nav-dashboard', group: 'Navigation', label: 'Tableau de bord', hint: '/', perform: () => navigate('/') },
    { id: 'nav-vault', group: 'Navigation', label: 'Lockey', hint: '/vault', perform: () => navigate('/vault') },
    { id: 'nav-audit', group: 'Navigation', label: "Journal d'audit", hint: '/audit', perform: () => navigate('/audit') },
    { id: 'nav-settings', group: 'Navigation', label: 'Paramètres', hint: '/settings', perform: () => navigate('/settings') },
    { id: 'nav-users', group: 'Navigation', label: 'Utilisateurs', hint: 'Paramètres', perform: () => navigate('/settings?tab=utilisateurs') },
  ], [navigate]);

  const filtered = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return navCommands;
    return navCommands.filter(cmd =>
      cmd.label.toLowerCase().includes(q) ||
      (cmd.hint || '').toLowerCase().includes(q),
    );
  }, [query, navCommands]);

  // Keep activeIdx within bounds when filter changes.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

  if (!open) return null;

  function run(cmd: Command) {
    cmd.perform();
    requestClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[activeIdx];
      if (cmd) run(cmd);
    }
  }

  // Group consecutively for rendering.
  const groups: { name: Command['group']; items: Command[]; startIdx: number }[] = [];
  let cursor = 0;
  for (const cmd of filtered) {
    const last = groups[groups.length - 1];
    if (last && last.name === cmd.group) {
      last.items.push(cmd);
    } else {
      groups.push({ name: cmd.group, items: [cmd], startIdx: cursor });
    }
    cursor++;
  }

  return (
    <div className="cmdk-backdrop" ref={backdropRef} onClick={requestClose} role="presentation">
      <div
        ref={panelRef}
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Recherche et navigation"
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-search">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher une page…"
            aria-label="Recherche"
            aria-controls={listId}
            aria-activedescendant={filtered[activeIdx] ? `${listId}-${filtered[activeIdx].id}` : undefined}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="cmdk-esc">Esc</kbd>
        </div>
        <ul id={listId} className="cmdk-list" role="listbox">
          {filtered.length === 0 && (
            <li className="cmdk-empty">Aucun résultat</li>
          )}
          {groups.map(g => (
            <li key={g.name + g.startIdx} className="cmdk-group">
              <div className="cmdk-group-label">{g.name}</div>
              <ul role="group">
                {g.items.map((cmd, i) => {
                  const idx = g.startIdx + i;
                  const active = idx === activeIdx;
                  return (
                    <li
                      key={cmd.id}
                      id={`${listId}-${cmd.id}`}
                      role="option"
                      aria-selected={active}
                      className={'cmdk-item' + (active ? ' active' : '')}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => run(cmd)}
                    >
                      <span className="cmdk-item-label">{cmd.label}</span>
                      {cmd.hint && <span className="cmdk-item-hint">{cmd.hint}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
