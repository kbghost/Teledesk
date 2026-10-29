import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '../../utils/format';
import { Icons } from '../icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-btn,10px)] font-semibold transition-[background,box-shadow,color] duration-150 disabled:pointer-events-none disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink shadow-sm hover:shadow hover:brightness-105 active:brightness-95',
  secondary: 'border border-line bg-surface text-ink hover:bg-raised active:bg-line/40 shadow-xs',
  ghost: 'text-ink hover:bg-ink/5 active:bg-ink/10',
  danger: 'bg-danger text-white shadow-sm hover:brightness-105 active:brightness-95',
  gold: 'bg-gold text-gold-ink shadow-sm hover:brightness-105 active:brightness-95',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export const buttonClass = (v: Variant = 'primary', s: Size = 'md', extra?: string) =>
  cn(base, variants[v], sizes[s], extra);

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref) => (
    <motion.button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      whileHover={!disabled && !loading ? { scale: 1.015 } : undefined}
      whileTap={!disabled && !loading ? { scale: 0.975 } : undefined}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={buttonClass(variant, size, className)}
      {...(rest as HTMLMotionProps<'button'>)}
    >
      {loading ? <Icons.Loader className="h-4 w-4 animate-spin shrink-0" aria-hidden /> : icon}
      {children}
    </motion.button>
  ),
);
Button.displayName = 'Button';

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(({ label, className, children, type = 'button', disabled, ...rest }, ref) => (
  <motion.button
    ref={ref}
    type={type}
    aria-label={label}
    title={label}
    disabled={disabled}
    whileHover={!disabled ? { scale: 1.05 } : undefined}
    whileTap={!disabled ? { scale: 0.95 } : undefined}
    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
    className={cn(
      'inline-flex h-10 w-10 items-center justify-center rounded-ctl text-ink transition hover:bg-ink/5 disabled:opacity-50',
      className,
    )}
    {...(rest as HTMLMotionProps<'button'>)}
  >
    {children}
  </motion.button>
));
IconButton.displayName = 'IconButton';
