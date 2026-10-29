import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../utils/format';
import { IconButton } from './Button';
import { Icons } from '../icons';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  side?: 'center' | 'right';
  size?: 'sm' | 'md' | 'lg';
  footer?: ReactNode;
  hideClose?: boolean;
}

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

/** Modale avec animations Framer Motion pro : Échap, clic fond, focus piégé, scroll bloqué */
export function Modal({
  open,
  onClose,
  title,
  children,
  side = 'center',
  size = 'md',
  footer,
  hideClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = ref.current;
    const focusables = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),textarea,select,[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    (focusables()[1] ?? focusables()[0] ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0]!,
          last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);

  const right = side === 'right';

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            'fixed inset-0 z-50 flex',
            right ? 'justify-end' : 'items-end justify-center sm:items-center p-0 sm:p-4',
          )}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-ink/40 backdrop-blur-xs"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={
              right
                ? { x: '100%' }
                : { opacity: 0, y: 24, scale: 0.96 }
            }
            animate={
              right
                ? { x: 0 }
                : { opacity: 1, y: 0, scale: 1 }
            }
            exit={
              right
                ? { x: '100%' }
                : { opacity: 0, y: 16, scale: 0.97 }
            }
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
            className={cn(
              'relative flex max-h-[92dvh] w-full flex-col bg-surface shadow-2xl outline-none z-10',
              right
                ? 'h-dvh max-h-none max-w-md border-l border-line'
                : cn('rounded-t-2xl sm:rounded-2xl border border-line', widths[size]),
            )}
          >
            {(title || !hideClose) && (
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
                <h2 className="font-display text-lg font-semibold">{title}</h2>
                {!hideClose && (
                  <IconButton label="Fermer" onClick={onClose} className="-mr-2">
                    <Icons.Close className="h-5 w-5" />
                  </IconButton>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && (
              <div className="safe-bottom flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
