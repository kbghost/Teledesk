import type { ReactNode } from 'react';
import { cn } from '../../utils/format';
import { errMsg } from '../../api/http';
import { Button } from './Button';
import { Icons } from '../icons';

export const Skeleton = ({ className }: { className?: string }) => (
  <div aria-hidden className={cn('skeleton h-4 w-full', className)} />
);

export const Spinner = ({ className }: { className?: string }) => (
  <Icons.Loader aria-label="Chargement" className={cn('h-5 w-5 animate-spin text-muted', className)} />
);

export const PageSpinner = () => (
  <div className="flex min-h-[40dvh] items-center justify-center">
    <Spinner className="h-7 w-7 text-brand" />
  </div>
);

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line bg-surface/50 px-6 py-12 text-center">
      {icon && (
        <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      {text && <p className="max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = 'Impossible de charger',
}: {
  error?: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-card border border-danger/30 bg-danger/5 px-6 py-10 text-center"
    >
      <Icons.AlertCircle className="h-8 w-8 text-danger" aria-hidden />
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{errMsg(error, 'Réessayez dans un instant.')}</p>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          icon={<Icons.RotateCcw className="h-4 w-4" />}
          onClick={onRetry}
          className="mt-2"
        >
          Réessayer
        </Button>
      )}
    </div>
  );
}

export const ListSkeleton = ({ rows = 4, height = 'h-24' }: { rows?: number; height?: string }) => (
  <div className="space-y-3" aria-busy="true">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className={cn('skeleton rounded-card', height)} />
    ))}
  </div>
);
