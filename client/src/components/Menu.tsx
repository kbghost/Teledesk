import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../utils/format';

/** Menu déroulant : fermeture au clic extérieur et sur Échap, navigation ↑/↓. */
export function Menu({ trigger, children, align = 'right', label }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const i = items.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div role="menu" aria-label={label} className={cn('absolute z-40 mt-2 min-w-52 animate-pop overflow-hidden rounded-card border border-line bg-surface py-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
export const menuItem = 'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm hover:bg-ink/5 focus:bg-ink/5 focus:outline-none';
