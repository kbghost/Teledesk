import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema } from '@teledesk/shared';
import type { z } from 'zod';
import { authApi } from '../../api/auth';
import { useAuth } from '../../stores/auth';
import { toast } from '../../stores/ui';
import { Button, Input } from '../../components/ui';
import { applyServerErrors, safeNext } from '../../lib/forms';
import { useSeo } from '../../hooks/useSeo';
import { PasswordInput } from './PasswordInput';

type Form = z.input<typeof registerSchema>;
export default function RegisterPage() {
  useSeo({ title: 'Créer mon agence', description: 'Créez votre espace TeleDesk : essai gratuit de 7 jours, sans carte bancaire.' });
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const [global, setGlobal] = useState<string>();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(registerSchema) });
  const onSubmit = handleSubmit(async (v) => {
    setGlobal(undefined);
    try {
      const r = await authApi.register({ ...v, acceptTerms: true });
      useAuth.getState().setSession(r.accessToken, r.user);
      toast.success('Compte créé. Un email de vérification vous a été envoyé.');
      navigate(safeNext(sp.get('next'), '/app'), { replace: true });
    } catch (e) { setGlobal(applyServerErrors(e, setError)); }
  });
  return (
    <>
      <h1 className="font-display text-3xl font-bold">Créer votre agence</h1>
      <p className="mt-1.5 text-muted">Essai gratuit de 7 jours, sans carte bancaire. Vous serez le Super admin de l’agence.</p>
      <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
        {global && <p role="alert" className="rounded-ctl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{global}</p>}
        <Input label="Nom de l’agence" autoFocus error={errors.agencyName?.message} {...register('agencyName')} />
        <Input label="Votre nom" autoComplete="name" error={errors.displayName?.message} {...register('displayName')} />
        <Input label="Adresse email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <PasswordInput label="Mot de passe" autoComplete="new-password" hint="10 caractères minimum, avec lettres et chiffres." error={errors.password?.message} {...register('password')} />
        <div className="space-y-2.5 text-sm">
          <label className="flex items-start gap-2.5"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" {...register('acceptTerms')} /><span>J'accepte les <Link to="/terms" target="_blank" className="text-brand underline">conditions d'utilisation</Link> et la <Link to="/privacy" target="_blank" className="text-brand underline">politique de confidentialité</Link>.</span></label>
          {errors.acceptTerms && <p role="alert" className="text-xs text-danger">{errors.acceptTerms.message}</p>}
        </div>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Créer mon compte</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">Déjà inscrit ? <Link to="/login" className="font-semibold text-brand hover:underline">Se connecter</Link></p>
    </>
  );
}
