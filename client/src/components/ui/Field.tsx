import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../utils/format';

const control = 'w-full rounded-ctl border bg-surface px-3 text-sm text-ink placeholder:text-muted/70 transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60';
interface FieldProps { label?: string; hint?: string; error?: string; className?: string }

export function Field({ label, hint, error, children, htmlFor, className }: FieldProps & { children: ReactNode; htmlFor?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>}
      {children}
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(({ label, hint, error, className, id, ...rest }, ref) => {
  const uid = useId(); const i = id ?? uid;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={i} className={className}>
      <input ref={ref} id={i} aria-invalid={!!error} className={cn(control, 'h-10', error ? 'border-danger' : 'border-line')} {...rest} />
    </Field>
  );
});
Input.displayName = 'Input';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(({ label, hint, error, className, id, rows = 4, ...rest }, ref) => {
  const uid = useId(); const i = id ?? uid;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={i} className={className}>
      <textarea ref={ref} id={i} rows={rows} aria-invalid={!!error} className={cn(control, 'py-2.5 leading-relaxed', error ? 'border-danger' : 'border-line')} {...rest} />
    </Field>
  );
});
Textarea.displayName = 'Textarea';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps>(({ label, hint, error, className, id, children, ...rest }, ref) => {
  const uid = useId(); const i = id ?? uid;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={i} className={className}>
      <select ref={ref} id={i} className={cn(control, 'h-10 pr-8', error ? 'border-danger' : 'border-line')} {...rest}>{children}</select>
    </Field>
  );
});
Select.displayName = 'Select';

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-accent' : 'bg-line')}>
      <span className={cn('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
    </button>
  );
}
