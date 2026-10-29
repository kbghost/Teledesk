import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { opsApi } from '../../api';
import { errMsg } from '../../api/http';
import { flat, nextOf } from '../../hooks/useList';
import { useSeo } from '../../hooks/useSeo';
import { toast } from '../../stores/ui';
import { useAuth, useCan } from '../../stores/auth';
import { Badge, Button, Card, EmptyState, ListSkeleton, PageHeader, Segmented, useConfirm } from '../../components/ui';
import { LoadMore } from '../../components/LoadMore';
import { dateFr, money, timeFr } from '../../utils/format';
import type { AnalyticsRange } from '../../types/api';

export default function SalesPage() {
  useSeo({ title: 'Ventes', noindex: true });
  const qc = useQueryClient();
  const can = useCan();
  const confirm = useConfirm();
  const cur = useAuth((s) => s.user?.agency?.currency);
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const list = useInfiniteQuery({ queryKey: ['sales', range], queryFn: ({ pageParam }) => opsApi.sales({ range, cursor: pageParam, limit: 40 }), initialPageParam: undefined as string | undefined, getNextPageParam: nextOf });
  const items = flat(list.data);
  const voidSale = useMutation({ mutationFn: opsApi.voidSale, onSuccess: () => { toast.success('Vente annulée'); void qc.invalidateQueries({ queryKey: ['sales'] }); void qc.invalidateQueries({ queryKey: ['analytics'] }); }, onError: (e) => toast.error(errMsg(e)) });
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader title="Ventes" subtitle={can('analytics.team') ? 'Toutes les ventes de vos comptes.' : 'Vos ventes enregistrées.'} actions={<Segmented label="Période" value={range} onChange={setRange} options={[{ value: '7d', label: '7 jours' }, { value: '30d', label: '30 jours' }, { value: '90d', label: '90 jours' }]} />} />
      {list.isLoading ? <ListSkeleton rows={5} height="h-14" /> : !items.length ? <EmptyState title="Aucune vente" text="Les ventes s’enregistrent depuis une conversation (« Enregistrer une vente »)." /> : (
        <>
        <ul className="space-y-2 sm:hidden">{items.map((s) => (
          <li key={s.id}><Card className="p-3">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{s.contactName}</p><p className="text-xs text-muted">{s.recordedByName} · {dateFr(s.createdAt)} {timeFr(s.createdAt)}</p></div>
              <div className="shrink-0 text-right tabular-nums">{s.status === 'VOID' ? <><Badge tone="danger">annulée</Badge> <s className="text-muted">{money(s.grossCents, cur)}</s></> : <><p className="font-semibold">{money(s.grossCents, cur)}</p><p className="text-xs text-muted">net <span className="font-semibold text-ok">{money(s.netCents, cur)}</span> · com. {money(s.feeCents, cur)}</p></>}</div></div>
            {s.note && <p className="mt-1 truncate text-sm text-muted">{s.note}</p>}
            {s.status === 'CONFIRMED' && can('sales.void') && <Button size="sm" variant="ghost" className="mt-1 -ml-2 text-danger" onClick={async () => { if (await confirm({ title: 'Annuler cette vente ?', text: 'Le total du contact et les métriques seront corrigés. Action irréversible.', confirmLabel: 'Annuler la vente', danger: true })) voidSale.mutate(s.id); }}>Annuler</Button>}
          </Card></li>))}</ul>
        <Card className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[48rem] text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="px-4 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Contact</th><th className="px-3 py-2 font-medium">Chatter</th><th className="px-3 py-2 font-medium">Note</th><th className="px-3 py-2 text-right font-medium">Brut</th><th className="px-3 py-2 text-right font-medium">Commission</th><th className="px-3 py-2 text-right font-medium">Net</th><th /></tr></thead>
          <tbody>{items.map((s) => (
            <tr key={s.id} className="border-t border-line">
              <td className="px-4 py-2.5 text-muted">{dateFr(s.createdAt)} {timeFr(s.createdAt)}</td><td className="px-3 font-medium">{s.contactName}</td><td className="px-3">{s.recordedByName}</td><td className="max-w-[12rem] truncate px-3 text-muted">{s.note}</td>
              <td className="px-3 text-right tabular-nums">{s.status === 'VOID' ? <><Badge tone="danger">annulée</Badge> <s className="text-muted">{money(s.grossCents, cur)}</s></> : <>{money(s.grossCents, cur)}{s.source === 'PPV_PAID' && <Badge tone="gold" className="ml-1.5">payé en ligne</Badge>}</>}</td>
              <td className="px-3 text-right tabular-nums text-muted">{s.status === 'VOID' ? '—' : `− ${money(s.feeCents, cur)}`}</td>
              <td className="px-3 text-right font-semibold tabular-nums text-ok">{s.status === 'VOID' ? '—' : money(s.netCents, cur)}</td>
              <td className="px-3 text-right">{s.status === 'CONFIRMED' && can('sales.void') && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Annuler cette vente ?', text: 'Le total du contact et les métriques seront corrigés. Action irréversible.', confirmLabel: 'Annuler la vente', danger: true })) voidSale.mutate(s.id); }}>Annuler</Button>}</td>
            </tr>))}</tbody></table></Card></>
      )}
      <LoadMore q={list} />
    </div>
  );
}
