import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authApi } from '../../api/auth';
import { errMsg } from '../../api/http';
import { useAuth } from '../../stores/auth';
import { Button, ErrorState, PageSpinner } from '../../components/ui';
import { useSeo } from '../../hooks/useSeo';
import { PasswordInput } from './PasswordInput';

export default function InvitePage() {
  useSeo({ title: 'Invitation', noindex: true });
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => authApi.invite(token), retry: false });
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  if (info.isLoading) return <PageSpinner />;
  if (info.isError) return <ErrorState error={info.error} title="Invitation invalide ou expirée" />;
  const i = info.data!;
  return (
    <>
      <h1 className="font-display text-3xl font-bold">Rejoindre {i.agencyName}</h1>
      <p className="mt-1.5 text-muted">Vous êtes invité(e) comme <strong>{i.roleLabel}</strong> ({i.email}). Choisissez votre mot de passe pour activer le compte.</p>
      <form className="mt-7 space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(undefined); try { const r = await authApi.acceptInvite({ token, password: pw }); useAuth.getState().setSession(r.accessToken, r.user); navigate('/app', { replace: true }); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } }}>
        {err && <p role="alert" className="rounded-ctl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p>}
        <PasswordInput label="Mot de passe" autoComplete="new-password" hint="10 caractères minimum, avec lettres et chiffres." value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={pw.length < 10}>Activer mon compte</Button>
      </form>
    </>
  );
}
