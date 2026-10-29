import { motion, AnimatePresence } from 'framer-motion';
import { useUi } from '../../stores/ui';
import { cn } from '../../utils/format';
import { Icons } from '../icons';

const icons = {
  success: Icons.CheckCircle,
  error: Icons.AlertCircle,
  info: Icons.Info,
};

const tone = {
  success: 'text-ok bg-ok/10',
  error: 'text-danger bg-danger/10',
  info: 'text-brand bg-brand/10',
};

export function Toaster() {
  const { toasts, dismiss } = useUi();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2.5 px-4 md:bottom-6 md:items-end md:pr-6"
    >
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = icons[t.kind];
          return (
            <motion.div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-line bg-surface/95 backdrop-blur-md p-3.5 shadow-lg"
            >
              <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', tone[t.kind])}>
                <Icon className="h-4 w-4" aria-hidden />
              </div>
              <p className="flex-1 text-sm font-medium leading-relaxed">{t.text}</p>
              <button
                aria-label="Fermer"
                onClick={() => dismiss(t.id)}
                className="rounded-ctl p-1 text-muted transition hover:bg-ink/5 hover:text-ink"
              >
                <Icons.Close className="h-4 w-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
