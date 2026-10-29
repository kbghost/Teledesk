import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icons } from '../../components/icons';
import { PAYOUT_STATUS_LABELS, PAYOUT_METHOD_LABELS } from '@teledesk/shared';
import { adminApi } from '../../api';
import { errMsg } from '../../api/http';
import { useSeo } from '../../hooks/useSeo';
import { toast } from '../../stores/ui';
import { Badge, Button, Card, EmptyState, ErrorState, Input, ListSkeleton, Modal, Page, PageHeader, Segmented, Textarea } from '../../components/ui';
import { dateFr, money } from '../../utils/format';
import type { Payout, PayoutStatus } from '../../types/api';

export const payoutTone = (s: PayoutStatus) => (s === 'PAID' ? 'ok' : s === 'REJECTED' ? 'danger' : s === 'APPROVED' ? 'brand' : 'gold') as 'ok' | 'danger' | 'brand' | 'gold';

/** Retraits demandés par les agences : le super admin valide, verse hors plateforme, puis marque « payé » avec une référence. */
export default function AdminPayouts() {
  useSeo({ title: 'Retraits', noindex: true });
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'ACTIVE' | PayoutStatus | 'ALL'>('ACTIVE');
  const q = useQuery({ queryKey: ['admin', 'payouts', 'ALL'], queryFn: () => adminApi.payouts(), refetchInterval: 30_000 });
  const rows = (q.data ?? []).filter((p) => (filter === 'ALL' ? true : filter === 'ACTIVE' ? p.status === 'PENDING' || p.status === 'APPROVED' : p.status === filter));
  const [pay, setPay] = useState<Payout | null>(null); const [ref, setRef] = useState('');
  const [rej, setRej] = useState<Payout | null>(null); const [reason, setReason] = useState('');
  const done = () => { void qc.invalidateQueries({ queryKey: ['admin'] }); };
  const decide = useMutation({
    mutationFn: (b: { id: string; decision: 'APPROVE' | 'PAID' | 'REJECT'; reference?: string; reason?: string }) => adminApi.decide(b.id, b),
    onSuccess: () => { done(); setPay(null); setRej(null); setRef(''); setReason(''); }, onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Page>
      <PageHeader title="Retraits" subtitle="Validez les demandes des agences, versez le montant net hors plateforme, puis marquez-les payées." actions={<Segmented label="Filtre" value={filter} onChange={setFilter} options={[{ value: 'ACTIVE', label: 'À traiter' }, { value: 'PAID', label: 'Payés' }, { value: 'REJECTED', label: 'Refusés' }, { value: 'ALL', label: 'Tous' }]} />} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <ListSkeleton rows={3} height="h-28" /> : !rows.length ? <EmptyState title="Rien à traiter" text="Les demandes de retrait des agences apparaissent ici." /> : (
        <ul className="space-y-3">{rows.map((p) => (
          <li key={p.id}><Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><p className="font-display text-2xl font-bold tabular-nums">{money(p.amountCents)}</p><p className="text-sm text-muted">{p.agencyName} · demandé par {p.requesterName} · {dateFr(p.createdAt, true)}</p></div>
              <Badge tone={payoutTone(p.status)}>{PAYOUT_STATUS_LABELS[p.status]}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-ctl bg-raised px-3 py-2 text-sm"><span className="font-medium">{PAYOUT_METHOD_LABELS[p.method]}</span><span className="min-w-0 flex-1 break-all text-muted">{p.destination}</span>
              <button aria-label="Copier la destination" onClick={() => { void navigator.clipboard?.writeText(p.destination); toast.success('Copié'); }} className="rounded-ctl p-1.5 text-muted hover:bg-ink/5"><Icons.Copy className="h-4 w-4" /></button></div>
            {p.note && <p className="mt-2 text-sm text-muted">Note : {p.note}</p>}
            {p.status === 'PAID' && <p className="mt-2 text-sm text-ok">Payé le {dateFr(p.paidAt, true)}{p.reference ? ` · réf. ${p.reference}` : ''}</p>}
            {p.status === 'REJECTED' && <p className="mt-2 text-sm text-danger">Refusé : {p.rejectReason}</p>}
            {(p.status === 'PENDING' || p.status === 'APPROVED') && (
              <div className="mt-3 flex flex-wrap gap-2">
                {p.status === 'PENDING' && <Button size="sm" variant="secondary" icon={<Icons.Check className="h-4 w-4" />} loading={decide.isPending && decide.variables?.id === p.id && decide.variables.decision === 'APPROVE'} onClick={() => decide.mutate({ id: p.id, decision: 'APPROVE' })}>Valider</Button>}
                <Button size="sm" onClick={() => setPay(p)}>Marquer comme payé</Button>
                <Button size="sm" variant="ghost" className="text-danger" icon={<Icons.Close className="h-4 w-4" />} onClick={() => setRej(p)}>Refuser</Button>
              </div>
            )}
          </Card></li>))}</ul>
      )}
      <Modal open={!!pay} onClose={() => setPay(null)} title="Confirmer le versement" size="sm" footer={<><Button variant="secondary" onClick={() => setPay(null)}>Annuler</Button><Button loading={decide.isPending} onClick={() => decide.mutate({ id: pay!.id, decision: 'PAID', reference: ref.trim() || undefined })}>Confirmer : {pay && money(pay.amountCents)} versés</Button></>}>
        <p className="mb-3 text-sm text-muted">À confirmer seulement après avoir réellement envoyé l’argent ({pay && PAYOUT_METHOD_LABELS[pay.method]} · {pay?.destination}).</p>
        <Input label="Référence du virement (optionnel)" value={ref} onChange={(e) => setRef(e.target.value)} />
      </Modal>
      <Modal open={!!rej} onClose={() => setRej(null)} title="Refuser la demande" size="sm" footer={<><Button variant="secondary" onClick={() => setRej(null)}>Annuler</Button><Button variant="danger" loading={decide.isPending} disabled={reason.trim().length < 3} onClick={() => decide.mutate({ id: rej!.id, decision: 'REJECT', reason: reason.trim() })}>Refuser</Button></>}>
        <Textarea label="Motif (visible par l’agence)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        <p className="mt-2 text-xs text-muted">Le montant redevient disponible dans le portefeuille de l’agence.</p>
      </Modal>
    </Page>
  );
}
