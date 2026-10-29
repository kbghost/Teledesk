import { HiCheckBadge } from 'react-icons/hi2';
import { cn, initials } from '../../utils/format';

const palette = ['#4F46E5', '#9333EA', '#0D9488', '#EA580C', '#2563EB', '#E11D48'];
const pick = (s: string) => palette[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length]!;

export function Avatar({
  src,
  name,
  size = 40,
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: size * 0.38 };
  return src ? (
    <img
      src={src}
      alt=""
      loading="lazy"
      style={style}
      className={cn('shrink-0 rounded-full bg-line object-cover', className)}
    />
  ) : (
    <span
      aria-hidden
      style={{ ...style, background: pick(name) }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-display font-semibold text-white shadow-2xs',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export const Verified = ({ className }: { className?: string }) => (
  <HiCheckBadge aria-label="Compte vérifié" className={cn('inline h-4 w-4 text-brand', className)} />
);
