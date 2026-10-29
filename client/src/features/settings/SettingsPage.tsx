import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agencyApi, inboxApi } from '../../api';
import { authApi } from '../../api/auth';
import { errMsg } from '../../api/http';
import { useSeo } from '../../hooks/useSeo';
import { toast } from '../../stores/ui';
import { useAuth, useCan } from '../../stores/auth';
import { Badge, Button, Card, Input, PageHeader, Select, Switch, Textarea } from '../../components/ui';
import { PasswordInput } from '../auth/PasswordInput';
import { dateFr, relTime } from '../../utils/format';

export default function SettingsPage() {
  useSeo({ title: 'Paramètres', noindex: true });
  const user = useAuth((s) => s.user)!;
  const can = useCan();
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <PageHeader title="Paramètres" />
      <Profile />
      <Security />
      {can('agency.settings') && <AgencyCard />}
      {can('tags.manage') && <Tags />}
      {can('scripts.manage') && <Quick />}
      {can('audit.view') && <AuditCard />}
      {can('export.contacts') && <Card className="p-5"><h2 className="font-display text-lg font-semibold">Export des contacts</h2><p className="mt-1 text-sm text-muted">CSV complet de vos contacts (réservé au Super admin, chaque export est journalisé).</p><a className="mt-3 inline-flex h-10 items-center rounded-ctl border border-line px-4 text-sm font-semibold hover:bg-raised" href={agencyApi.exportUrl} onClick={(e) => { e.preventDefault(); void fetch(agencyApi.exportUrl, { headers: { authorization: `Bearer ${useAuth.getState().accessToken}` } }).then(async (r) => { if (!r.ok) return toast.error('Export refusé'); const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'contacts.csv'; a.click(); URL.revokeObjectURL(a.href); }); }}>Télécharger le CSV</a></Card>}
      <p className="text-center text-xs text-muted">Connecté en tant que {user.email} · {user.roleLabel}</p>
    </div>
  );
}

function Profile() {
  const user = useAuth((s) => s.user)!;
  const [name, setName] = useState(user.displayName);
  const m = useMutation({ mutationFn: () => authApi.updateMe(name.trim()), onSuccess: (r) => { useAuth.getState().setUser(r.user); toast.success('Profil mis à jour'); }, onError: (e) => toast.error(errMsg(e)) });
  return <Card className="space-y-3 p-5"><h2 className="font-display text-lg font-semibold">Profil</h2><Input label="Nom affiché" value={name} onChange={(e) => setName(e.target.value)} /><Input label="Adresse e-mail" value={user.email} disabled /><Button loading={m.isPending} disabled={name.trim().length < 2 || name === user.displayName} onClick={() => m.mutate()}>Enregistrer</Button></Card>;
}

function Security() {
  const user = useAuth((s) => s.user)!;
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: authApi.sessions });
  const [cur, setCur] = useState(''); const [next, setNext] = useState('');
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState(''); const [recovery, setRecovery] = useState<string[] | null>(null); const [pwd, setPwd] = useState('');
  const refreshMe = async () => useAuth.getState().setUser((await authApi.me()).user);
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <Card className="space-y-5 p-5">
      <h2 className="font-display text-lg font-semibold">Sécurité</h2>
      <div className="space-y-3"><PasswordInput label="Mot de passe actuel" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /><PasswordInput label="Nouveau mot de passe" autoComplete="new-password" hint="10 caractères minimum, avec lettres et chiffres. Vos autres sessions seront déconnectées." value={next} onChange={(e) => setNext(e.target.value)} /><Button variant="secondary" disabled={!cur || next.length < 10} onClick={() => run(async () => { await authApi.changePassword({ currentPassword: cur, newPassword: next }); setCur(''); setNext(''); void qc.invalidateQueries({ queryKey: ['sessions'] }); }, 'Mot de passe modifié')}>Changer le mot de passe</Button></div>
      <div className="border-t border-line pt-4">
        <div className="flex items-center justify-between gap-3"><div><p className="font-medium">Double authentification (TOTP)</p><p className="text-sm text-muted">Application d’authentification (Google Authenticator, Authy, 1Password…).</p></div>{user.totpEnabled ? <Badge tone="ok">Activée</Badge> : !setup && <Button variant="secondary" onClick={async () => { try { setSetup(await authApi.totpSetup()); } catch (e) { toast.error(errMsg(e)); } }}>Activer</Button>}</div>
        {setup && !recovery && <div className="mt-3 space-y-3 rounded-card bg-raised p-4 text-sm"><p>Ajoutez ce compte dans votre application avec la clé ci-dessous (ou ouvrez le lien sur mobile), puis saisissez le code à 6 chiffres.</p><p className="break-all rounded-ctl bg-surface p-2 font-mono">{setup.secret}</p><a className="text-brand underline" href={setup.otpauthUrl}>Ouvrir dans l’application</a><Input label="Code à 6 chiffres" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /><Button disabled={code.length < 6} onClick={() => run(async () => { setRecovery((await authApi.totpEnable(code)).recoveryCodes); await refreshMe(); }, 'Double authentification activée')}>Valider</Button></div>}
        {recovery && <div className="mt-3 rounded-card border border-gold/60 bg-gold/10 p-4 text-sm"><p className="font-semibold">Codes de secours — notez-les maintenant, ils ne seront plus affichés</p><ul className="mt-2 grid grid-cols-2 gap-1 font-mono">{recovery.map((c) => <li key={c}>{c}</li>)}</ul><Button className="mt-3" size="sm" variant="secondary" onClick={() => { setRecovery(null); setSetup(null); }}>J’ai noté mes codes</Button></div>}
        {user.totpEnabled && !setup && <div className="mt-3 flex flex-wrap items-end gap-2"><PasswordInput label="Mot de passe pour désactiver" autoComplete="current-password" value={pwd} onChange={(e) => setPwd(e.target.value)} /><Button variant="ghost" className="text-danger" disabled={!pwd} onClick={() => run(async () => { await authApi.totpDisable(pwd); setPwd(''); await refreshMe(); }, 'Double authentification désactivée')}>Désactiver</Button></div>}
      </div>
      <div className="border-t border-line pt-4"><p className="mb-2 font-medium">Sessions actives</p><ul className="space-y-2 text-sm">{sessions.data?.map((s) => <li key={s.id} className="flex items-center justify-between gap-3"><span>{s.device} <span className="text-muted">· {s.ip} · {relTime(s.lastUsedAt)}</span> {s.current && <Badge tone="ok">cette session</Badge>}</span>{!s.current && <Button size="sm" variant="ghost" onClick={() => run(async () => { await authApi.revokeSession(s.id); void qc.invalidateQueries({ queryKey: ['sessions'] }); }, 'Session révoquée')}>Révoquer</Button>}</li>)}</ul></div>
    </Card>
  );
}

function AgencyCard() {
  const user = useAuth((s) => s.user)!;
  const [name, setName] = useState(user.agency?.name ?? ''); const [cur, setCur] = useState(user.agency?.currency ?? 'EUR'); const [view, setView] = useState(!!user.agency?.settings.modelCanViewDefault);
  const m = useMutation({ mutationFn: () => agencyApi.update({ name: name.trim(), currency: cur, modelCanViewDefault: view }), onSuccess: async () => { useAuth.getState().setUser((await authApi.me()).user); toast.success('Agence mise à jour'); }, onError: (e) => toast.error(errMsg(e)) });
  return <Card className="space-y-3 p-5"><h2 className="font-display text-lg font-semibold">Agence</h2><Input label="Nom de l’agence" value={name} onChange={(e) => setName(e.target.value)} /><Select label="Devise d’affichage des ventes" value={cur} onChange={(e) => setCur(e.target.value)}>{['EUR', 'USD', 'GBP', 'CAD', 'CHF', 'XOF'].map((c) => <option key={c}>{c}</option>)}</Select><label className="flex items-center gap-3 text-sm"><Switch checked={view} onChange={setView} label="Lecture des conversations par défaut" />Autoriser par défaut les modèles à lire leurs conversations</label><Button loading={m.isPending} onClick={() => m.mutate()}>Enregistrer</Button></Card>;
}

function Tags() {
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ['tags'], queryFn: inboxApi.tags });
  const [n, setN] = useState(''); const [c, setC] = useState('#6B7280');
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); void qc.invalidateQueries({ queryKey: ['tags'] }); } catch (e) { toast.error(errMsg(e)); } };
  return <Card className="space-y-3 p-5"><h2 className="font-display text-lg font-semibold">Étiquettes</h2><div className="flex flex-wrap gap-2">{tags.data?.map((t) => <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium text-white" style={{ background: t.color }}>{t.name}<button aria-label={`Supprimer ${t.name}`} onClick={() => run(() => inboxApi.deleteTag(t.id))}>×</button></span>)}</div><div className="flex items-end gap-2"><Input label="Nouvelle étiquette" value={n} maxLength={24} onChange={(e) => setN(e.target.value)} className="flex-1" /><input aria-label="Couleur" type="color" value={c} onChange={(e) => setC(e.target.value)} className="h-10 w-12 rounded-ctl border border-line" /><Button disabled={!n.trim()} onClick={() => run(async () => { await inboxApi.createTag({ name: n.trim(), color: c }); setN(''); })}>Ajouter</Button></div></Card>;
}

function Quick() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['quick-replies'], queryFn: inboxApi.quickReplies });
  const [f, setF] = useState({ title: '', shortcut: '', text: '' });
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); void qc.invalidateQueries({ queryKey: ['quick-replies'] }); } catch (e) { toast.error(errMsg(e)); } };
  return <Card className="space-y-3 p-5"><h2 className="font-display text-lg font-semibold">Scripts</h2><p className="text-sm text-muted">Messages pré-faits : dans une conversation, ouvrez l’onglet « Scripts » du bouton médias, ou tapez <code>/raccourci</code> pour insérer le texte.</p><ul className="space-y-1.5 text-sm">{q.data?.map((r) => <li key={r.id} className="flex items-start justify-between gap-3 rounded-ctl bg-raised p-2.5"><span><span className="font-mono text-brand">/{r.shortcut}</span> <strong>{r.title}</strong><br /><span className="text-muted">{r.text}</span></span><button aria-label="Supprimer" className="text-muted hover:text-danger" onClick={() => run(() => inboxApi.deleteQuickReply(r.id))}>×</button></li>)}</ul><div className="grid gap-2 sm:grid-cols-2"><Input label="Titre" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /><Input label="Raccourci" value={f.shortcut} placeholder="bienvenue" onChange={(e) => setF({ ...f, shortcut: e.target.value.toLowerCase() })} /></div><Textarea label="Texte" rows={3} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /><Button disabled={!f.title.trim() || !f.shortcut || !f.text.trim()} onClick={() => run(async () => { await inboxApi.createQuickReply({ title: f.title.trim(), shortcut: f.shortcut, text: f.text.trim() }); setF({ title: '', shortcut: '', text: '' }); })}>Ajouter</Button></Card>;
}

function AuditCard() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => agencyApi.audit({ limit: 30 }) });
  return <Card className="p-5"><h2 className="font-display text-lg font-semibold">Journal d’audit</h2><p className="text-sm text-muted">Actions sensibles : connexions de comptes, invitations, exports, annulations de vente…</p><ul className="mt-3 divide-y divide-line text-sm">{q.data?.items.map((a) => <li key={a.id} className="flex justify-between gap-3 py-1.5"><span className="font-mono text-xs">{a.action}</span><span className="text-muted">{dateFr(a.at, true)}</span></li>)}</ul></Card>;
}
