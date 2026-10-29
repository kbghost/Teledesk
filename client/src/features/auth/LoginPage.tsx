import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@teledesk/shared';
import type { z } from 'zod';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/http';
import { useAuth } from '../../stores/auth';
import { Button, Input } from '../../components/ui';
import { applyServerErrors, safeNext } from '../../lib/forms';
import { useSeo } from '../../hooks/useSeo';
import { PasswordInput } from './PasswordInput';

type Form = z.infer<typeof loginSchema>;
export default function LoginPage() {
  useSeo({ title: 'Connexion', noindex: true });
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const [global, setGlobal] = useState<string>();
  const [needTotp, setNeedTotp] = useState(false);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(loginSchema) });
  const onSubmit = handleSubmit(async (v) => {
    setGlobal(undefined);
    try {
      const r = await authApi.login(v);
      useAuth.getState().setSession(r.accessToken, r.user);
      navigate(safeNext(sp.get('next'), '/app'), { replace: true });
    } catch (e) { if (e instanceof ApiError && e.code === 'TOTP_REQUIRED') { setNeedTotp(true); return; } setGlobal(applyServerErrors(e, setError)); }
  });
  return (
    <>
      <h1 className="font-display text-3xl font-bold">Bon retour</h1>
      <p className="mt-1.5 text-muted">Connectez-vous pour retrouver votre inbox et votre équipe.</p>
      <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
        {global && <p role="alert" className="rounded-ctl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{global}</p>}
        <Input label="Adresse email" type="email" autoComplete="email" autoFocus error={errors.email?.message} {...register('email')} />
        <PasswordInput label="Mot de passe" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
        {needTotp && <Input label="Code de double authentification" inputMode="numeric" autoComplete="one-time-code" autoFocus hint="Code à 6 chiffres de votre application, ou un code de secours." {...register('totp')} />}
        <div className="text-right text-sm"><Link to="/forgot-password" className="text-brand hover:underline">Mot de passe oublié ?</Link></div>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Se connecter</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">Pas encore d’agence ? <Link to={`/register${sp.get('next') ? `?next=${encodeURIComponent(sp.get('next')!)}` : ''}`} className="font-semibold text-brand hover:underline">Créer mon agence</Link></p>
    </>
  );
}
