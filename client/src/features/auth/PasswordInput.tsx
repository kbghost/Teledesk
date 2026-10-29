import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Input } from '../../components/ui';
import { Icons } from '../../components/icons';

export const PasswordInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: string }
>((props, ref) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={show ? 'text' : 'password'} {...props} className="[&_input]:pr-11" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        className="absolute right-1.5 top-[1.9rem] flex h-8 w-8 items-center justify-center rounded-ctl text-muted transition hover:text-ink"
      >
        {show ? <Icons.EyeOff className="h-4 w-4" /> : <Icons.Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';
