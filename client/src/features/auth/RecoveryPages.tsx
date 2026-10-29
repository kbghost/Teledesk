import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotSchema, resetSchema } from '@teledesk/shared';
import { Icons } from '../../components/icons';
import { authApi } from '../../api/auth';
import { useAuth } from '../../stores/auth';
import { Button, Input, Spinner } from '../../components/ui';
import { applyServerErrors } from '../../lib/forms';
import { toast } from '../../stores/ui';
import { useSeo } from '../../hooks/useSeo';
import { PasswordInput } from './PasswordInput';

export function ForgotPage() {
  useSeo({ title: 'Mot de passe oublié', noindex: true });
  const [sent, setSent] = useState(false);
  const [global, setGlobal] = useState<string>();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<{ email: string }>({ resolver: zodResolver(forgotSchema) });
  if (sent) return (
    <div className="text-center"><Icons.MailCheck className="mx-auto h-12 w-12 text-brand" /><h1 className="mt-4 font-display text-2xl font-bold">Vérifiez votre boîte mail</h1>
      <p className="mt-2 text-muted">Si un compte existe pour cette adresse, un lien de réinitialisation valable 1 heure vient d'être envoyé.</p>
      <Link to="/login" className="mt-6 inline-block font-semibold text-brand hover:underline">Retour à la connexion</Link></div>
  );
  return (
    <>
      <h1 className="font-display text-3xl font-bold">Mot de passe oublié</h1>
      <p className="mt-1.5 text-muted">Saisissez votre adresse : nous vous envoyons un lien pour en choisir un nouveau.</p>
      <form className="mt-7 space-y-4" noValidate onSubmit={handleSubmit(async (v) => { try { await authApi.forgot(v.email); setSent(true); } catch (e) { setGlobal(applyServerErrors(e, setError)); } })}>
        {global && <p role="alert" className="text-sm text-danger">{global}</p>}
        <Input label="Adresse email" type="email" autoComplete="email" autoFocus error={errors.email?.message} {...register('email')} />
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Envoyer le lien</Button>
      </form>
      <p className="mt-6 text-center text-sm"><Link to="/login" className="text-brand hover:underline">Retour à la connexion</Link></p>
    </>
  );
}

export function ResetPage() {
  useSeo({ title: 'Nouveau mot de passe', noindex: true });
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const token = sp.get('token') ?? '';
  const [global, setGlobal] = useState<string>();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<{ password: string }>({ resolver: zodResolver(resetSchema.pick({ password: true })) });
  return (
    <>
      <h1 className="font-display text-3xl font-bold">Nouveau mot de passe</h1>
      <p className="mt-1.5 text-muted">Toutes vos sessions seront déconnectées par sécurité.</p>
      <form className="mt-7 space-y-4" noValidate onSubmit={handleSubmit(async (v) => {
        try { await authApi.reset(token, v.password); useAuth.getState().clear(); toast.success('Mot de passe modifié. Connectez-vous.'); navigate('/login', { replace: true }); }
        catch (e) { setGlobal(applyServerErrors(e, setError)); }
      })}>
        {global && <p role="alert" className="rounded-ctl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{global}</p>}
        <PasswordInput label="Nouveau mot de passe" autoComplete="new-password" autoFocus error={errors.password?.message} {...register('password')} />
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting} disabled={!token}>Enregistrer</Button>
        {!token && <p className="text-sm text-danger">Lien invalide : ouvrez le lien reçu par email.</p>}
      </form>
    </>
  );
}

export function VerifyEmailPage() {
  useSeo({ title: "Vérification de l'email", noindex: true });
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(token ? 'loading' : 'error');
  const [msg, setMsg] = useState('');
  const done = useRef(false);
  useEffect(() => {
    if (!token || done.current) return;
    done.current = true; // le jeton est à usage unique : un seul appel
    authApi.verifyEmail(token).then(async () => {
      setState('ok');
      if (useAuth.getState().status === 'authed') { try { useAuth.getState().setUser((await authApi.me()).user); } catch { /* sans importance */ } }
    }).catch((e) => { setState('error'); setMsg(e instanceof Error ? e.message : ''); });
  }, [token]);
  return (
    <div className="text-center">
      {state === 'loading' && <Spinner className="mx-auto h-8 w-8" />}
      {state === 'ok' && <><Icons.CheckCircle className="mx-auto h-14 w-14 text-ok" /><h1 className="mt-4 font-display text-2xl font-bold">Email vérifié</h1><p className="mt-2 text-muted">Merci, votre adresse est confirmée.</p><Link to="/app" className="mt-6 inline-block font-semibold text-brand hover:underline">Continuer</Link></>}
      {state === 'error' && <><Icons.XCircle className="mx-auto h-14 w-14 text-danger" /><h1 className="mt-4 font-display text-2xl font-bold">Lien invalide ou expiré</h1><p className="mt-2 text-muted">{msg || "Ce lien n'est plus valable."}</p><Link to="/" className="mt-6 inline-block font-semibold text-brand hover:underline">Retour à l'accueil</Link></>}
    </div>
  );
}
