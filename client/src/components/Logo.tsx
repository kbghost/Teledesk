import { Link } from 'react-router-dom';
import { cn } from '../utils/format';
import { APP_NAME } from '../hooks/useSeo';

/** Marque : une bulle de discussion, le point doré signale le message non lu. Dessin original. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={className}>
      <rect width="64" height="64" rx="16" fill="rgb(var(--brand))" />
      <path d="M12 20h30a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6H27l-9 8v-8h-6a6 6 0 0 1-6-6V26a6 6 0 0 1 6-6z" transform="translate(2 -4)" fill="rgb(var(--brand-ink))" />
      <circle cx="46" cy="21" r="6" fill="rgb(var(--gold))" />
    </svg>
  );
}
export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <Link to="/" aria-label={`${APP_NAME} — accueil`} className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact && <span className="font-display text-xl font-bold tracking-tight">{APP_NAME}</span>}
    </Link>
  );
}
