import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYOUT_METHODS, PAYOUT_METHOD_LABELS, PAYOUT_STATUS_LABELS } from '@teledesk/shared';
import { walletApi } from '../../api';
import { errMsg } from '../../api/http';
import { useSeo } from '../../hooks/useSeo';
import { useAuth } from '../../stores/auth';
import { toast } from '../../stores/ui';
import { Badge, Button, Card, ErrorState, Input, Kpi, ListSkeleton, Modal, Page, PageHeader, Section, Select } from '../../components/ui';
import { dateFr, money } from '../../utils/format';
import { payoutTone } from '../admin/AdminPayouts';
import { Icons } from '../../components/icons';

/** Portefeuille de l'agence : brut → commission de la plateforme → net, et demandes de retrait. */
export default function WalletPage() {
  useSeo({ title: 'Portefeuille', noindex: true });
  const qc = useQueryClient();
  const user = useAuth((s) => s.user)!;
  const cur = user.agency?.currency;
  const q = useQuery({ queryKey: ['wallet'], queryFn: walletApi.get, refetchInterval: 60_000 });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: '', method: 'BANK', destination: '', note: '' });
  const w = q.data?.wallet;
  const cents = Math.round(Number(f.amount.replace(',', '.')) * 100);
  const err = !f.amount ? undefined : !Number.isFinite(cents) ? 'Montant invalide' : w && cents < w.minPayoutCents ? `Minimum ${money(w.minPayoutCents, cur)}` : w && cents > w.availableCents ? 'Supérieur au solde disponible' : undefined;
  const request = useMutation({
    mutationFn: () => walletApi.request({ amountCents: cents, method: f.method, destination: f.destination.trim(), note: f.note.trim() || undefined }),
    onSuccess: () => { toast.success('Demande envoyée : elle sera examinée par la plateforme'); setOpen(false); setF({ amount: '', method: 'BANK', destination: '', note: '' }); void qc.invalidateQueries({ queryKey: ['wallet'] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const cancel = useMutation({ mutationFn: walletApi.cancel, onSuccess: () => void qc.invalidateQueries({ queryKey: ['wallet'] }), onError: (e) => toast.error(errMsg(e)) });
  const fee = (user.agency?.feeBps ?? 1500) / 100;
  return (
    <Page>
      <PageHeader title="Portefeuille" subtitle="Ce que vos ventes rapportent, après la commission de la plateforme." actions={<Button icon={<Icons.Wallet className="h-4 w-4" />} disabled={!w || w.availableCents < w.minPayoutCents} onClick={() => { setF({ ...f, amount: w ? String(w.availableCents / 100) : '' }); setOpen(true); }}>Demander un retrait</Button>} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !w ? <ListSkeleton rows={2} height="h-28" /> : (<>
        <Card className="overflow-hidden">
          <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="p-5"><p className="text-sm text-muted">Ventes brutes</p><p className="mt-1 font-display text-3xl font-bold tabular-nums">{money(w.grossCents, cur)}</p><p className="mt-0.5 text-xs text-muted">Prix payés par vos contacts</p></div>
            <div className="p-5"><p className="text-sm text-muted">Commission plateforme ({fee} %)</p><p className="mt-1 font-display text-3xl font-bold tabular-nums text-muted">− {money(w.feeCents, cur)}</p><p className="mt-0.5 text-xs text-muted">Retenue sur chaque vente</p></div>
            <div className="p-5"><p className="text-sm text-muted">Net total</p><p className="mt-1 font-display text-3xl font-bold tabular-nums text-ok">{money(w.netCents, cur)}</p><p className="mt-0.5 text-xs text-muted">Ce qui revient à l’agence</p></div>
          </div>
        </Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="Disponible" value={money(w.availableCents, cur)} hint={`Retrait minimum : ${money(w.minPayoutCents, cur)}`} icon={<Icons.Wallet className="h-5 w-5" />} tone="gold" />
          <Kpi label="En cours de traitement" value={money(w.reservedCents, cur)} hint="Demandes en attente ou validées" icon={<Icons.Clock className="h-5 w-5" />} tone="neutral" />
          <Kpi label="Déjà versé" value={money(w.paidCents, cur)} icon={<Icons.CheckCircle className="h-5 w-5" />} tone="ok" />
        </div>

        <Section title="Demandes de retrait" flush>
          {!q.data!.payouts.length ? <p className="px-5 py-8 text-center text-sm text-muted">Aucune demande pour l’instant.</p> : (
            <ul className="divide-y divide-line">{q.data!.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 text-sm">
                <div className="min-w-0 flex-1"><p className="font-semibold tabular-nums">{money(p.amountCents, cur)} <span className="font-normal text-muted">· {PAYOUT_METHOD_LABELS[p.method]}</span></p><p className="truncate text-muted">{p.destination} · {dateFr(p.createdAt, true)}{p.reference ? ` · réf. ${p.reference}` : ''}{p.status === 'REJECTED' && p.rejectReason ? ` · ${p.rejectReason}` : ''}</p></div>
                <Badge tone={payoutTone(p.status)}>{PAYOUT_STATUS_LABELS[p.status]}</Badge>
                {p.status === 'PENDING' && <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === p.id} onClick={() => cancel.mutate(p.id)}>Annuler</Button>}
              </li>))}</ul>
          )}
        </Section>
      </>)}
      <Modal open={open} onClose={() => setOpen(false)} title="Demander un retrait" size="sm" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Annuler</Button><Button loading={request.isPending} disabled={!f.amount || !!err || f.destination.trim().length < 4} onClick={() => request.mutate()}>Envoyer la demande</Button></>}>
        <div className="space-y-3">
          <Input label={`Montant (${cur ?? 'EUR'})`} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} error={err} hint={w ? `Disponible : ${money(w.availableCents, cur)}` : undefined} />
          <Select label="Méthode" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{PAYOUT_METHODS.map((m) => <option key={m} value={m}>{PAYOUT_METHOD_LABELS[m]}</option>)}</Select>
          <Input label="Où envoyer l’argent ?" placeholder="IBAN, numéro mobile money, adresse crypto…" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} />
          <Input label="Note (optionnel)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
      </Modal>
    </Page>
  );
}
