import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountsApi, teamApi } from '../../api';
import { Icons } from '../../components/icons';

import { errMsg } from '../../api/http';
import { useSeo } from '../../hooks/useSeo';
import { toast } from '../../stores/ui';
import { useAuth, useCan } from '../../stores/auth';
import { Badge, Button, Card, EmptyState, Input, ListSkeleton, Modal, PageHeader, Select, Switch, Textarea, useConfirm } from '../../components/ui';
import { dateFr, relTime } from '../../utils/format';
import { ConnectGuide } from './ConnectGuide';
import type { Account, AccountCheck } from '../../types/api';

const STATUS: Record<Account['status'], { tone: 'ok' | 'gold' | 'danger' | 'neutral'; label: string }> = { CONNECTED: { tone: 'ok', label: 'Connecté' }, PENDING: { tone: 'gold', label: 'En attente' }, ERROR: { tone: 'danger', label: 'Erreur' }, DISCONNECTED: { tone: 'neutral', label: 'Déconnecté' } };

export default function AccountsPage() {
  useSeo({ title: 'Comptes Telegram', noindex: true });
  const user = useAuth((s) => s.user)!;
  const can = useCan();
  const owner = can('accounts.manage');
  const [add, setAdd] = useState(false);
  const q = useQuery({ queryKey: ['accounts', user.role === 'MODEL' ? 'mine' : 'all'], queryFn: user.role === 'MODEL' ? accountsApi.mine : accountsApi.list, refetchInterval: 15_000 });
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <PageHeader title={user.role === 'MODEL' ? 'Mon compte' : 'Comptes Telegram'} subtitle="Un compte = un modèle. Trois façons de le connecter : bot Business (officiel), bot classique, ou compte personnel par numéro (sans bot, sans Premium)."
        actions={owner ? <Button icon={<Icons.Plus className="h-4 w-4" />} onClick={() => setAdd(true)}>Connecter un compte</Button> : undefined} />
      {q.isLoading ? <ListSkeleton rows={2} height="h-40" /> : !q.data?.length ? <EmptyState title="Aucun compte" text={owner ? 'Connectez le premier compte Telegram d’un modèle en suivant le guide.' : 'Aucun compte ne vous est rattaché pour le moment.'} action={owner ? <Button onClick={() => setAdd(true)}>Connecter un compte</Button> : undefined} /> : q.data.map((a) => <AccountCard key={a.id} a={a} />)}
      {owner && <Card className="p-5"><h2 className="mb-3 font-display text-lg font-semibold">Comment connecter un compte</h2><ConnectGuide /></Card>}
      {owner && <AddModal open={add} onClose={() => setAdd(false)} />}
    </div>
  );
}

function AccountCard({ a }: { a: Account }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [check, setCheck] = useState<AccountCheck | null>(null);
  const [tok, setTok] = useState('');
  const [tokOpen, setTokOpen] = useState(false);
  const [verify, setVerify] = useState(false);
  const [fan, setFan] = useState({ name: 'Jean', text: 'Salut, tu es là ?' });
  const members = useQuery({ queryKey: ['team'], queryFn: teamApi.list, enabled: !!a.canManage });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['accounts'] }); };
  const run = <T,>(fn: () => Promise<T>, ok?: string) => async () => { try { const r = await fn(); if (ok) toast.success(ok); refresh(); return r; } catch (e) { toast.error(errMsg(e)); } };
  const decide = useMutation({ mutationFn: (d: 'APPROVE' | 'REJECT') => accountsApi.decide(a.id, d), onSuccess: (_r, d) => { toast.success(d === 'APPROVE' ? 'Connexion confirmée' : 'Connexion refusée'); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const st = STATUS[a.status];
  const models = (members.data?.members ?? []).filter((m) => m.role === 'MODEL' && m.status === 'ACTIVE');
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-xl font-semibold">{a.label}</h2><Badge tone={st.tone}>{st.label}</Badge><Badge>{a.modeLabel}</Badge></div>
          <p className="mt-1 text-sm text-muted">{a.mode === 'USER' && a.botName ? <>Compte personnel : {a.botName}{a.botUsername ? ` (@${a.botUsername})` : ''} · </> : a.botUsername ? <>Bot : {a.botLink ? <a className="text-brand underline" href={a.botLink} target="_blank" rel="noreferrer">@{a.botUsername}</a> : `@${a.botUsername}`} · </> : null}{a.business ? <>Titulaire : {a.business.userName || '—'} · </> : null}{a.lastEventAt ? `dernier évènement ${relTime(a.lastEventAt)}` : 'aucun évènement reçu'}</p>
          {a.statusDetail && <p className="mt-1 text-sm text-danger">{a.statusDetail}</p>}
          {a.business && !a.business.canReply && <p className="mt-1 text-sm text-danger">Le droit « Répondre aux messages » n’est pas accordé : les réponses seront refusées.</p>}
        </div>
        {a.canManage && <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Icons.RotateCcw className="h-4 w-4" />} onClick={async () => { const r = await run(() => accountsApi.check(a.id))(); if (r) setCheck(r); }}>Tester la connexion</Button>
          {a.mode !== 'USER' && a.mode !== 'SANDBOX' && <Button size="sm" variant="ghost" onClick={() => setTokOpen(true)}>Changer le jeton</Button>}
          {a.mode === 'USER' && a.status === 'PENDING' && <Button size="sm" onClick={() => setVerify(true)}>Saisir le code Telegram</Button>}
          <Button size="sm" variant="ghost" className="text-danger" onClick={async () => { if (await confirm({ title: `Déconnecter « ${a.label} » ?`, text: 'L’écoute s’arrête et le jeton est supprimé de TeleDesk. L’historique reste consultable.', confirmLabel: 'Déconnecter', danger: true })) void run(() => accountsApi.disconnect(a.id), 'Compte déconnecté')(); }}>Déconnecter</Button>
        </div>}
      </div>
      {a.pendingBusiness && (
        <div role="alert" className="rounded-card border border-gold/60 bg-gold/10 p-4">
          <p className="font-semibold">Une connexion Telegram Business attend votre confirmation</p>
          <p className="mt-1 text-sm">Compte Telegram : <strong>{a.pendingBusiness.userName || a.pendingBusiness.userUsername}</strong>{a.pendingBusiness.userUsername ? ` (@${a.pendingBusiness.userUsername})` : ''} · droit de répondre : {a.pendingBusiness.canReply ? 'oui' : 'non'} · reçue le {dateFr(a.pendingBusiness.receivedAt, true)}</p>
          <div className="mt-3 flex gap-2"><Button size="sm" loading={decide.isPending} onClick={() => decide.mutate('APPROVE')}>Confirmer</Button><Button size="sm" variant="secondary" onClick={() => decide.mutate('REJECT')}>Refuser</Button></div>
        </div>
      )}
      {check && <ul className="space-y-1.5 rounded-ctl bg-raised p-3 text-sm">{check.checks.map((c) => <li key={c.key} className="flex items-start gap-2">{c.ok ? <Icons.CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <Icons.Close className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}<span>{c.detail}</span></li>)}</ul>}

      {a.canManage && (
        <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <Select label="Modèle rattaché" value={a.modelUserId ?? ''} onChange={(e) => void run(() => accountsApi.update(a.id, { modelUserId: e.target.value || null }))()} hint="Le modèle voit sa médiathèque et peut y déposer des fichiers.">
            <option value="">Aucun</option>{models.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
          </Select>
          <div className="flex items-start gap-3 pt-6"><Switch checked={!!a.modelCanView} disabled={!a.modelUserId} onChange={(v) => void run(() => accountsApi.update(a.id, { modelCanView: v }))()} label="Le modèle peut consulter les conversations" /><div className="text-sm"><p className="font-medium">Lecture des conversations par le modèle</p><p className="text-muted">Lecture seule, sans notes ni ventes. Désactivé par défaut.</p></div></div>
        </div>
      )}
      {a.mode === 'SANDBOX' && a.canManage && (
        <div className="space-y-3 rounded-card border border-dashed border-line p-4">
          <p className="text-sm font-semibold">Bac à sable — Telegram simulé (démo et tests)</p>
          <p className="text-sm text-muted">Reproduit le parcours réel sans compte Telegram : le message simulé traverse le même chemin que s’il venait de Telegram.</p>
          {!a.business && !a.pendingBusiness && <Button size="sm" variant="secondary" onClick={run(() => accountsApi.sandboxConnect(a.id, { canReply: true, canRead: true }), 'Connexion Business simulée : confirmez-la ci-dessus')}>1. Simuler la connexion du modèle (Business → Chatbots)</Button>}
          {a.business && (
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
              <Input aria-label="Nom du contact" value={fan.name} onChange={(e) => setFan({ ...fan, name: e.target.value })} />
              <Input aria-label="Message du contact" value={fan.text} onChange={(e) => setFan({ ...fan, text: e.target.value })} />
              <Button disabled={!fan.name.trim() || !fan.text.trim()} onClick={run(() => accountsApi.sandboxIncoming(a.id, { fanName: fan.name.trim(), text: fan.text.trim() }), 'Message simulé reçu — voir l’inbox')}>Simuler un message</Button>
            </div>
          )}
        </div>
      )}
      {a.mode === 'USER' && <VerifyModal account={a} open={verify} onClose={() => setVerify(false)} />}
      <Modal open={tokOpen} onClose={() => setTokOpen(false)} title="Changer le jeton du bot" size="sm" footer={<><Button variant="secondary" onClick={() => setTokOpen(false)}>Annuler</Button><Button disabled={!tok.trim()} onClick={async () => { await run(() => accountsApi.replaceToken(a.id, tok.trim()), 'Jeton remplacé')(); setTok(''); setTokOpen(false); }}>Remplacer</Button></>}>
        <p className="mb-3 text-sm text-muted">Le nouveau jeton doit appartenir au même bot (régénération depuis @BotFather). L’ancien est effacé.</p>
        <Textarea label="Nouveau jeton" rows={2} value={tok} onChange={(e) => setTok(e.target.value)} autoComplete="off" spellCheck={false} />
      </Modal>
    </Card>
  );
}

function AddModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'BUSINESS' | 'BOT' | 'USER' | 'SANDBOX'>('BUSINESS');
  const [phone, setPhone] = useState('');
  const [verifyFor, setVerifyFor] = useState<Account | null>(null);
  const [label, setLabel] = useState('');
  const [token, setToken] = useState('');
  const add = useMutation({
    mutationFn: () => accountsApi.connect({ label: label.trim(), mode, token: mode === 'SANDBOX' || mode === 'USER' ? undefined : token.trim(), phone: mode === 'USER' ? phone.replace(/[\s.-]/g, '') : undefined }),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      setLabel(''); setToken(''); setPhone(''); onClose();
      if (mode === 'USER') { toast.success('Code envoyé dans Telegram'); setVerifyFor(a); } else toast.success(mode === 'BUSINESS' ? 'Bot enregistré. Étape suivante : le modèle le connecte dans Telegram Business.' : 'Compte connecté');
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const ok = label.trim().length >= 2 && (mode === 'SANDBOX' || (mode === 'USER' ? phone.replace(/[\s.-]/g, '').length >= 9 : token.trim().length > 20));
  return (
    <>
    {verifyFor && <VerifyModal account={verifyFor} open onClose={() => setVerifyFor(null)} />}
    <Modal open={open} onClose={onClose} title="Connecter un compte Telegram" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={!ok} loading={add.isPending} onClick={() => add.mutate()}>Connecter</Button></>}>
      <div className="space-y-4">
        <Select label="Type de connexion" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="BUSINESS">Compte du modèle via Telegram Business (recommandé)</option>
          <option value="BOT">Bot Telegram classique (les contacts écrivent au bot)</option>
          <option value="USER">Compte personnel par numéro — sans bot, sans Premium (expérimental)</option>
          <option value="SANDBOX">Bac à sable (démo, sans Telegram)</option>
        </Select>
        <Input label="Nom du compte (ex. le prénom du modèle)" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} autoFocus />
        {mode === 'USER' && <Input label="Numéro du compte Telegram" type="tel" inputMode="tel" placeholder="+22991234567" value={phone} onChange={(e) => setPhone(e.target.value)} hint="Format international. Telegram enverra un code de connexion dans l’application du modèle." />}
        {mode !== 'SANDBOX' && mode !== 'USER' && <Textarea label="Jeton du bot (fourni par @BotFather)" rows={2} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder="123456789:AAE…" hint="Chiffré immédiatement ; jamais ré-affiché." />}
        {mode === 'USER' ? <UserWarning /> : mode === 'BUSINESS' ? <ConnectGuide /> : mode === 'BOT' ? <p className="text-sm text-muted">Les contacts doivent d’abord écrire (« /start ») au bot : Telegram interdit à un bot d’écrire le premier. Pas de fenêtre de 24 h dans ce mode.</p> : <p className="text-sm text-muted">Un faux Telegram intégré simule le bot, la connexion Business et les messages des contacts. Idéal pour essayer ou former l’équipe.</p>}
      </div>
    </Modal>
    </>
  );
}

function UserWarning() {
  return (
    <div className="space-y-2 rounded-card border border-gold/60 bg-gold/10 p-4 text-sm">
      <p className="font-semibold">Compte personnel : à connaître avant de continuer</p>
      <ul className="list-disc space-y-1 pl-5 text-muted">
        <li>Les fans écrivent au <strong className="text-ink">vrai compte</strong> du modèle ; ils ne parlent à aucun bot, et aucun abonnement Premium n’est requis.</li>
        <li>La connexion donne à TeleDesk l’<strong className="text-ink">accès complet</strong> au compte (comme une appli Telegram supplémentaire). La session est chiffrée ; le modèle peut la révoquer à tout moment dans Telegram › Appareils.</li>
        <li>Telegram peut restreindre un compte qui se comporte comme un robot : TeleDesk ne répond qu’aux personnes qui ont écrit en premier et limite le débit d’envoi.</li>
        <li>Mode expérimental : à tester d’abord sur un compte secondaire.</li>
      </ul>
    </div>
  );
}

/** Étape 2 de la connexion par numéro : code reçu dans Telegram, puis mot de passe de double authentification si le compte en a un. */
function VerifyModal({ account, open, onClose }: { account: Account; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [needPwd, setNeedPwd] = useState(false);
  const verify = useMutation({
    mutationFn: () => accountsApi.userVerify(account.id, { code: code.trim(), password: needPwd ? password : undefined }),
    onSuccess: (r) => {
      if (r.state === 'PASSWORD_NEEDED') { setNeedPwd(true); toast.info('Ce compte a une double authentification : saisissez son mot de passe'); return; }
      toast.success('Compte connecté : les messages arrivent dans l’inbox'); void qc.invalidateQueries({ queryKey: ['accounts'] }); onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const resend = useMutation({ mutationFn: () => accountsApi.userCode(account.id), onSuccess: () => toast.success('Nouveau code envoyé'), onError: (e) => toast.error(errMsg(e)) });
  return (
    <Modal open={open} onClose={onClose} title={`Connexion de « ${account.label} »`} size="sm" footer={<><Button variant="ghost" loading={resend.isPending} onClick={() => resend.mutate()}>Renvoyer le code</Button><Button loading={verify.isPending} disabled={code.trim().length < 4 || (needPwd && !password)} onClick={() => verify.mutate()}>Valider</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Telegram vient d’envoyer un code <strong className="text-ink">dans l’application Telegram</strong> du compte (message de « Telegram »), pas par SMS dans la plupart des cas.</p>
        <Input label="Code reçu" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus maxLength={8} />
        {needPwd && <Input label="Mot de passe de double authentification" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />}
      </div>
    </Modal>
  );
}
