import type { ReactNode } from 'react';
import { cn } from '../../utils/format';

const tones = { neutral: 'bg-ink/8 text-ink', brand: 'bg-brand/12 text-brand', gold: 'bg-gold/20 text-ink', ok: 'bg-ok/15 text-ok', danger: 'bg-danger/12 text-danger' } as const;
export const Badge = ({ tone = 'neutral', children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>
);
export const Card = ({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('rounded-card border border-line bg-surface', className)} {...rest}>{children}</div>;

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Contrôle segmenté (onglets / filtres exclusifs). */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar inline-flex max-w-full gap-1 overflow-x-auto rounded-ctl bg-ink/5 p-1">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cn('whitespace-nowrap rounded-[8px] px-3 py-1.5 text-sm font-medium transition', value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'gold' }) {
  return (
    <Card className="min-w-[10.5rem] p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={cn('mt-1 font-display text-2xl font-bold tabular-nums', tone === 'ok' && 'text-ok')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

/** Indicateur clé : icône dans une pastille, valeur en grand, précision dessous. */
export function Kpi({ label, value, hint, icon, tone = 'brand', className }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'brand' | 'ok' | 'gold' | 'danger' | 'neutral'; className?: string }) {
  const chip = { brand: 'bg-brand/12 text-brand', ok: 'bg-ok/15 text-ok', gold: 'bg-gold/25 text-ink', danger: 'bg-danger/12 text-danger', neutral: 'bg-ink/8 text-muted' }[tone];
  return (
    <Card className={cn('flex items-start gap-3 p-4', className)}>
      {icon && <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-ctl [&>svg]:h-5 [&>svg]:w-5', chip)} aria-hidden>{icon}</span>}
      <div className="min-w-0">
        <p className="truncate text-sm text-muted">{label}</p>
        <p className="mt-0.5 font-display text-2xl font-bold tabular-nums leading-tight">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
    </Card>
  );
}

/** Section d'une page : titre, description, actions et contenu, sur une carte. */
export function Section({ title, description, actions, children, className, flush }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
        <div className="min-w-0"><h2 className="font-display text-base font-semibold">{title}</h2>{description && <p className="mt-0.5 text-sm text-muted">{description}</p>}</div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={flush ? '' : 'p-4 sm:p-5'}>{children}</div>
    </Card>
  );
}

/** Conteneur standard des pages : largeur maîtrisée et marges cohérentes. */
export const Page = ({ children, wide }: { children: ReactNode; wide?: boolean }) => <div className={cn('mx-auto space-y-5 p-4 sm:p-6', wide ? 'max-w-7xl' : 'max-w-6xl')}>{children}</div>;
