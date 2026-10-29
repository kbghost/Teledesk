import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icons } from '../../components/icons';
import { adminApi } from '../../api';
import { errMsg } from '../../api/http';
import { useSeo } from '../../hooks/useSeo';
import { useDebounce } from '../../hooks/useDebounce';
import { toast } from '../../stores/ui';
import { Badge, Button, Card, EmptyState, ErrorState, Input, ListSkeleton, Modal, Page, PageHeader, Textarea } from '../../components/ui';
import { dateFr, money } from '../../utils/format';
import type { AdminAgency } from '../../types/api';

export default function AdminAgencies() {
  useSeo({ title: 'Agences', noindex: true });
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const ds = useDebounce(search, 250);
  const q = useQuery({ queryKey: ['admin', 'agencies', ds], queryFn: () => adminApi.agencies(ds || undefined) });
  const [ban, setBan] = useState<AdminAgency | null>(null);
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState<AdminAgency | null>(null);
  const [pct, setPct] = useState('15');
  const done = () => { void qc.invalidateQueries({ queryKey: ['admin'] }); };
  const banM = useMutation({ mutationFn: () => adminApi.ban(ban!.id, reason.trim()), onSuccess: () => { toast.success('Agence bannie : ses membres sont déconnectés de l’outil'); setBan(null); setReason(''); done(); }, onError: (e) => toast.error(errMsg(e)) });
  const unban = useMutation({ mutationFn: (id: string) => adminApi.unban(id), onSuccess: () => { toast.success('Agence rétablie'); done(); }, onError: (e) => toast.error(errMsg(e)) });
  const feeM = useMutation({ mutationFn: () => adminApi.setFee(fee!.id, Math.round(Number(pct.replace(',', '.')) * 100)), onSuccess: () => { toast.success('Commission mise à jour (ventes à venir)'); setFee(null); done(); }, onError: (e) => toast.error(errMsg(e)) });
  return (
    <Page wide>
      <PageHeader title="Agences" subtitle="Toutes les agences inscrites : activité, argent, et actions de modération." actions={<Input aria-label="Rechercher une agence" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <ListSkeleton rows={4} height="h-20" /> : !q.data?.length ? <EmptyState title="Aucune agence" text="Les agences apparaissent ici dès qu’un chef d’agence s’inscrit." /> : (
        <>
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[60rem] text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="px-4 py-3 font-medium">Agence</th><th className="px-3 font-medium">Chef d’agence</th><th className="px-3 text-right font-medium">Équipe</th><th className="px-3 text-right font-medium">Brut</th><th className="px-3 text-right font-medium">Commission</th><th className="px-3 text-right font-medium">Net</th><th className="px-3 text-right font-medium">Disponible</th><th className="px-3 font-medium">Statut</th><th className="px-4" /></tr></thead>
              <tbody>{q.data.map((a) => (
                <tr key={a.id} className="border-t border-line align-middle">
                  <td className="px-4 py-3"><p className="font-semibold">{a.name}</p><p className="text-xs text-muted">créée le {dateFr(a.createdAt)}</p></td>
                  <td className="px-3"><p>{a.owner?.name ?? '—'}</p><p className="text-xs text-muted">{a.owner?.email}</p></td>
                  <td className="px-3 text-right tabular-nums">{a.members} · {a.accounts} cpt</td>
                  <td className="px-3 text-right tabular-nums">{money(a.grossCents)}</td>
                  <td className="px-3 text-right tabular-nums text-ok">{money(a.feeCents)} <span className="text-xs text-muted">({a.feeBps / 100} %)</span></td>
                  <td className="px-3 text-right tabular-nums">{money(a.netCents)}</td>
                  <td className="px-3 text-right tabular-nums font-semibold">{money(a.availableCents)}</td>
                  <td className="px-3">{a.status === 'BANNED' ? <Badge tone="danger">Bannie</Badge> : <Badge tone="ok">Active</Badge>}</td>
                  <td className="px-4"><Actions a={a} onBan={() => setBan(a)} onUnban={() => unban.mutate(a.id)} onFee={() => { setFee(a); setPct(String(a.feeBps / 100)); }} /></td>
                </tr>))}</tbody>
            </table>
          </Card>
          <ul className="space-y-3 md:hidden">{q.data.map((a) => (
            <li key={a.id}><Card className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{a.name}</p><p className="text-xs text-muted">{a.owner?.email}</p></div>{a.status === 'BANNED' ? <Badge tone="danger">Bannie</Badge> : <Badge tone="ok">Active</Badge>}</div>
              <dl className="grid grid-cols-3 gap-2 text-sm"><div><dt className="text-xs text-muted">Brut</dt><dd className="font-semibold tabular-nums">{money(a.grossCents)}</dd></div><div><dt className="text-xs text-muted">Commission</dt><dd className="font-semibold tabular-nums text-ok">{money(a.feeCents)}</dd></div><div><dt className="text-xs text-muted">Disponible</dt><dd className="font-semibold tabular-nums">{money(a.availableCents)}</dd></div></dl>
              <Actions a={a} onBan={() => setBan(a)} onUnban={() => unban.mutate(a.id)} onFee={() => { setFee(a); setPct(String(a.feeBps / 100)); }} />
            </Card></li>))}</ul>
        </>
      )}
      <Modal open={!!ban} onClose={() => setBan(null)} title={`Bannir « ${ban?.name ?? ''} »`} size="sm" footer={<><Button variant="secondary" onClick={() => setBan(null)}>Annuler</Button><Button variant="danger" loading={banM.isPending} disabled={reason.trim().length < 3} onClick={() => banM.mutate()}>Bannir l’agence</Button></>}>
        <p className="mb-3 text-sm text-muted">Tous les membres de l’agence perdent l’accès et l’écoute des comptes Telegram s’arrête. Les données sont conservées ; vous pouvez rétablir l’agence à tout moment.</p>
        <Textarea label="Motif (conservé dans le journal)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Modal>
      <Modal open={!!fee} onClose={() => setFee(null)} title={`Commission de « ${fee?.name ?? ''} »`} size="sm" footer={<><Button variant="secondary" onClick={() => setFee(null)}>Annuler</Button><Button loading={feeM.isPending} onClick={() => feeM.mutate()}>Enregistrer</Button></>}>
        <Input label="Commission de la plateforme (%)" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} hint="Appliquée aux prochaines ventes ; les ventes passées gardent leur taux d’origine. Maximum 50 %." />
      </Modal>
    </Page>
  );
}

function Actions({ a, onBan, onUnban, onFee }: { a: AdminAgency; onBan: () => void; onUnban: () => void; onFee: () => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Link to={`/app/admin/messages?agency=${a.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-line px-2.5 text-sm font-semibold hover:bg-raised"><Icons.Eye className="h-3.5 w-3.5" aria-hidden />Messages</Link>
      <Button size="sm" variant="secondary" icon={<Icons.Percent className="h-3.5 w-3.5" />} onClick={onFee}>Taux</Button>
      {a.status === 'BANNED' ? <Button size="sm" variant="secondary" icon={<Icons.ShieldCheck className="h-3.5 w-3.5" />} onClick={onUnban}>Rétablir</Button> : <Button size="sm" variant="danger" icon={<Icons.Ban className="h-3.5 w-3.5" />} onClick={onBan}>Bannir</Button>}
    </div>
  );
}
