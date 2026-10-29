import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icons } from '../../components/icons';
import { ALL_PERMISSIONS, INVITABLE_ROLES, PERMISSION_LABELS, ROLE_DESCRIPTIONS, ROLE_LABELS, can, type Permission } from '@teledesk/shared';
import { accountsApi, inboxApi, teamApi } from '../../api';
import { errMsg } from '../../api/http';
import { useSeo } from '../../hooks/useSeo';
import { toast } from '../../stores/ui';
import { Avatar, Badge, Button, Card, Input, ListSkeleton, Modal, PageHeader, Select, useConfirm } from '../../components/ui';
import { relTime } from '../../utils/format';
import type { Member } from '../../types/api';

type Role = (typeof INVITABLE_ROLES)[number];
const EDITABLE = ALL_PERMISSIONS.filter((p) => p !== 'agency.create');

/** Permissions d'un membre : on part des droits de son rôle, on coche/décoche ; seules les différences sont enregistrées (permGrant / permRevoke). */
function PermissionEditor({ role, grant, revoke, onChange }: { role: Role; grant: string[]; revoke: string[]; onChange: (g: string[], r: string[]) => void }) {
  const has = (p: Permission) => can({ role, grant, revoke }, p);
  const toggle = (p: Permission) => {
    const base = can(role, p);
    const on = !has(p);
    const g = grant.filter((x) => x !== p); const r = revoke.filter((x) => x !== p);
    if (on && !base) g.push(p);
    if (!on && base) r.push(p);
    onChange(g, r);
  };
  return (
    <details className="rounded-card border border-line">
      <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium">Permissions détaillées <span className="font-normal text-muted">({grant.length + revoke.length ? `${grant.length} ajoutée(s), ${revoke.length} retirée(s)` : 'celles du rôle'})</span></summary>
      <ul className="grid gap-0.5 border-t border-line p-2 sm:grid-cols-2">{EDITABLE.map((p) => <li key={p}><label className="flex cursor-pointer items-start gap-2 rounded-ctl px-2 py-1.5 text-sm hover:bg-ink/5"><input type="checkbox" className="mt-0.5" checked={has(p)} onChange={() => toggle(p)} /><span>{PERMISSION_LABELS[p]}{(grant.includes(p) || revoke.includes(p)) && <span className="ml-1 text-xs text-brand">• modifié</span>}</span></label></li>)}</ul>
    </details>
  );
}

export default function TeamPage() {
  useSeo({ title: 'Équipe', noindex: true });
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['team'], queryFn: teamApi.list, refetchInterval: 30_000 });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list });
  const [inv, setInv] = useState(false);
  const [edit, setEdit] = useState<Member | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [f, setF] = useState({ email: '', displayName: '', role: 'CHATTER' as Role, accountIds: [] as string[], permGrant: [] as string[], permRevoke: [] as string[] });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['team'] }); void qc.invalidateQueries({ queryKey: ['assignable'] }); };
  const invite = useMutation({ mutationFn: () => teamApi.invite(f), onSuccess: (r) => { setInv(false); setLink(r.inviteUrl); setF({ ...f, email: '', displayName: '', permGrant: [], permRevoke: [] }); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const revoke = useMutation({ mutationFn: teamApi.revokeInvite, onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) });
  const update = useMutation({ mutationFn: (b: { id: string; patch: Parameters<typeof teamApi.update>[1] }) => teamApi.update(b.id, b.patch), onSuccess: () => { refresh(); void qc.invalidateQueries({ queryKey: ['conversations'] }); }, onError: (e) => toast.error(errMsg(e)) });
  const [bulk, setBulk] = useState<Member | null>(null);
  const [to, setTo] = useState('');
  const toggle = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const labels = new Map((accounts.data ?? []).map((a) => [a.id, a.label]));
  const AccountPick = ({ ids, set }: { ids: string[]; set: (v: string[]) => void }) => (
    <fieldset><legend className="mb-1.5 text-sm font-medium">Comptes Telegram accessibles</legend><div className="flex flex-wrap gap-2">{(accounts.data ?? []).map((a) => <label key={a.id} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm"><input type="checkbox" checked={ids.includes(a.id)} onChange={() => set(toggle(ids, a.id))} />{a.label}</label>)}{!accounts.data?.length && <p className="text-sm text-muted">Connectez d’abord un compte.</p>}</div></fieldset>
  );
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <PageHeader title="Équipe" subtitle="Sous-chef, team leaders, chatters et modèles : rôles, comptes accessibles et permissions de chacun." actions={<Button icon={<Icons.Plus className="h-4 w-4" />} onClick={() => setInv(true)}>Inviter</Button>} />
      {link && <Card className="border-ok/40 bg-ok/5 p-4"><p className="text-sm font-semibold">Invitation créée — lien à transmettre (affiché une seule fois)</p><div className="mt-2 flex gap-2"><input readOnly aria-label="Lien d’invitation" value={link} className="h-10 min-w-0 flex-1 rounded-ctl border border-line bg-surface px-3 text-sm" onFocus={(e) => e.currentTarget.select()} /><Button variant="secondary" icon={<Icons.Copy className="h-4 w-4" />} onClick={() => { void navigator.clipboard?.writeText(link); toast.success('Lien copié'); }}>Copier</Button></div><p className="mt-2 text-xs text-muted">Un e-mail est aussi envoyé si le service d’e-mail est configuré. Valable 7 jours.</p></Card>}
      {q.isLoading ? <ListSkeleton rows={4} height="h-16" /> : (<>
        <Card className="divide-y divide-line">{q.data?.members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar name={m.displayName} size={38} />
            <div className="min-w-0 flex-1"><p className="truncate font-semibold">{m.displayName} {m.online && <span className="ml-1 inline-block h-2 w-2 rounded-full bg-ok" title="En ligne" />}</p><p className="truncate text-sm text-muted">{m.email} · {m.online ? 'en ligne' : m.lastSeenAt ? `vu ${relTime(m.lastSeenAt)}` : 'jamais connecté'}</p></div>
            <div className="flex flex-wrap items-center gap-1.5"><Badge tone="brand">{m.roleLabel}</Badge>{m.status === 'SUSPENDED' && <Badge tone="danger">Suspendu</Badge>}{m.totpEnabled && <Badge tone="ok">2FA</Badge>}{m.accountIds.map((id) => <Badge key={id}>{labels.get(id) ?? '…'}</Badge>)}</div>
            {m.role !== 'OWNER' && <Button size="sm" variant="secondary" onClick={() => setEdit(m)}>Gérer</Button>}
          </div>))}</Card>
        {!!q.data?.invites.length && <Card className="divide-y divide-line"><h2 className="px-4 pt-3 font-display font-semibold">Invitations en attente</h2>{q.data.invites.map((i) => <div key={i.id} className="flex items-center gap-3 px-4 py-3 text-sm"><div className="min-w-0 flex-1"><p className="font-medium">{i.displayName} · {i.email}</p><p className="text-muted">{ROLE_LABELS[i.role]} — expire {relTime(i.expiresAt)}</p></div><Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Révoquer</Button></div>)}</Card>}
      </>)}
      <Modal open={inv} onClose={() => setInv(false)} title="Inviter un membre" footer={<><Button variant="secondary" onClick={() => setInv(false)}>Annuler</Button><Button loading={invite.isPending} disabled={!f.email || f.displayName.length < 2} onClick={() => invite.mutate()}>Créer l’invitation</Button></>}>
        <div className="space-y-3">
          <Input label="Nom affiché" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} autoFocus />
          <Input label="Adresse e-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Select label="Rôle" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role, permGrant: [], permRevoke: [] })}>{INVITABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>
          <p className="text-xs text-muted">{ROLE_DESCRIPTIONS[f.role]}</p>
          {f.role !== 'MANAGER' && <AccountPick ids={f.accountIds} set={(v) => setF({ ...f, accountIds: v })} />}
          {f.role === 'MANAGER' && <p className="rounded-ctl bg-brand/8 px-3 py-2 text-xs">Un sous-chef voit tous les comptes et toutes les discussions de l’agence.</p>}
          <PermissionEditor role={f.role} grant={f.permGrant} revoke={f.permRevoke} onChange={(g, r) => setF({ ...f, permGrant: g, permRevoke: r })} />
        </div>
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Gérer ${edit.displayName}` : ''} footer={edit && <><Button variant="danger" onClick={async () => { if (await confirm({ title: `Retirer ${edit.displayName} ?`, text: 'Son accès est coupé immédiatement et ses conversations retournent dans la file. Son historique reste attribué à son nom.', confirmLabel: 'Retirer', danger: true })) { try { await teamApi.remove(edit.id); setEdit(null); refresh(); void qc.invalidateQueries({ queryKey: ['conversations'] }); } catch (e) { toast.error(errMsg(e)); } } }}>Retirer</Button><Button variant="secondary" onClick={() => update.mutate({ id: edit.id, patch: { status: edit.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' } })}>{edit.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}</Button></>}>
        {edit && <div className="space-y-4">
          <Select label="Rôle" value={edit.role} onChange={(e) => { const role = e.target.value as Member['role']; setEdit({ ...edit, role, permGrant: [], permRevoke: [] }); update.mutate({ id: edit.id, patch: { role, permGrant: [], permRevoke: [] } }); }}>{INVITABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>
          {edit.role !== 'MANAGER' && <AccountPick ids={edit.accountIds} set={(v) => { setEdit({ ...edit, accountIds: v }); update.mutate({ id: edit.id, patch: { accountIds: v } }); }} />}
          <PermissionEditor key={edit.id + edit.role} role={edit.role as Role} grant={edit.permGrant} revoke={edit.permRevoke} onChange={(g, r) => { setEdit({ ...edit, permGrant: g as Permission[], permRevoke: r as Permission[] }); update.mutate({ id: edit.id, patch: { permGrant: g, permRevoke: r } }); }} />
          {(edit.role === 'CHATTER' || edit.role === 'TEAM_LEADER') && <Button variant="secondary" onClick={() => { setBulk(edit); setEdit(null); }}>Réassigner toutes ses conversations…</Button>}
        </div>}
      </Modal>
      <Modal open={!!bulk} onClose={() => setBulk(null)} title="Réassigner les conversations" size="sm" footer={<><Button variant="secondary" onClick={() => setBulk(null)}>Annuler</Button><Button onClick={async () => { try { const r = await inboxApi.bulkReassign({ fromUserId: bulk!.id, toUserId: to || null }); toast.success(`${r.moved} conversation(s) réassignée(s)`); setBulk(null); void qc.invalidateQueries({ queryKey: ['conversations'] }); } catch (e) { toast.error(errMsg(e)); } }}>Réassigner</Button></>}>
        <Select label={`Conversations de ${bulk?.displayName ?? ''} vers…`} value={to} onChange={(e) => setTo(e.target.value)}><option value="">La file (non assignées)</option>{(q.data?.members ?? []).filter((m) => m.id !== bulk?.id && (m.role === 'CHATTER' || m.role === 'TEAM_LEADER' || m.role === 'MANAGER') && m.status === 'ACTIVE').map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</Select>
      </Modal>
    </div>
  );
}
