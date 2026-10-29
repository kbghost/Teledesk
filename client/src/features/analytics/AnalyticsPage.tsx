import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { opsApi, accountsApi } from '../../api';
import { useSeo } from '../../hooks/useSeo';
import { useAuth, useCan } from '../../stores/auth';
import { Badge, Card, ErrorState, ListSkeleton, PageHeader, Segmented, Select, Stat } from '../../components/ui';
import { ChartCard, dayLabel } from '../../components/Charts';
import { duration, money, num, pct, timeFr, dateFr } from '../../utils/format';
import type { AnalyticsRange } from '../../types/api';

const RANGES: { value: AnalyticsRange; label: string }[] = [{ value: 'today', label: 'Aujourd’hui' }, { value: '7d', label: '7 jours' }, { value: '30d', label: '30 jours' }, { value: '90d', label: '90 jours' }];

export default function AnalyticsPage() {
  useSeo({ title: 'Métriques', noindex: true });
  const can = useCan();
  return can('analytics.team') ? <TeamView /> : <MyView />;
}

function TeamView() {
  const cur = useAuth((s) => s.user?.agency?.currency);
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const [account, setAccount] = useState('');
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list });
  const q = useQuery({ queryKey: ['analytics', 'overview', range, account], queryFn: () => opsApi.overview(range, account || undefined), refetchInterval: 60_000 });
  const d = q.data;
  const sales = (d?.series ?? []).map((p) => ({ label: dayLabel(p.day), value: p.salesCents / 100 }));
  const msgs = (d?.series ?? []).map((p) => ({ label: dayLabel(p.day), value: p.messagesIn + p.messagesOut }));
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <PageHeader title="Métriques" subtitle="Calculées à partir d’évènements réels (messages reçus et envoyés, ventes enregistrées). Jours en UTC."
        actions={<><Select aria-label="Compte" value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Tous les comptes</option>{(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select><Segmented label="Période" value={range} onChange={setRange} options={RANGES} /></>} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d ? <ListSkeleton rows={3} height="h-28" /> : (<>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Ventes" value={money(d.totals.salesCents, cur)} hint={`${d.totals.salesCount} vente(s)`} tone="ok" />
          <Stat label="Temps de réponse moyen" value={duration(d.totals.avgResponseMs)} />
          <Stat label="Messages reçus / envoyés" value={`${num(d.totals.messagesIn)} / ${num(d.totals.messagesOut)}`} />
          <Stat label="Nouveaux contacts" value={num(d.totals.newConversations)} />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="En attente de réponse" value={d.live.waiting} hint={d.live.oldestWaitingSince ? `la plus ancienne : ${dateFr(d.live.oldestWaitingSince, true)}` : 'rien en attente'} />
          <Stat label="Non assignées" value={d.live.unassigned} />
          <Stat label="Panier moyen" value={d.totals.salesCount ? money(Math.round(d.totals.salesCents / d.totals.salesCount), cur) : '—'} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Ventes par jour" kind="bar" data={sales} format={(n) => money(Math.round(n * 100), cur)} headline={money(d.totals.salesCents, cur)} />
          <ChartCard title="Messages par jour" data={msgs} format={num} headline={num(d.totals.messagesIn + d.totals.messagesOut)} />
        </div>
        <Card className="overflow-x-auto">
          <h2 className="px-4 pt-4 font-display font-semibold">Par chatter</h2>
          <table className="mt-2 w-full min-w-[40rem] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="px-4 py-2 font-medium">Chatter</th><th className="px-3 py-2 text-right font-medium">Ventes</th><th className="px-3 py-2 text-right font-medium">Montant</th><th className="px-3 py-2 text-right font-medium">Msg envoyés</th><th className="px-3 py-2 text-right font-medium">Réponse moy.</th><th className="px-3 py-2 text-right font-medium">Conversion</th></tr></thead>
            <tbody>{d.perChatter.map((c) => <tr key={c.userId} className="border-t border-line"><td className="px-4 py-2.5 font-medium">{c.name}</td><td className="px-3 text-right tabular-nums">{c.salesCount}</td><td className="px-3 text-right tabular-nums">{money(c.salesCents, cur)}</td><td className="px-3 text-right tabular-nums">{c.messagesOut}</td><td className="px-3 text-right tabular-nums">{duration(c.avgResponseMs)}</td><td className="px-3 text-right tabular-nums" title={`${c.conversationsAnswered} conversation(s) traitée(s)`}>{pct(c.conversionRate)}</td></tr>)}
              {!d.perChatter.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">Aucune activité sur la période.</td></tr>}</tbody>
          </table>
          <p className="px-4 pb-3 text-xs text-muted">Conversion = conversations avec au moins une vente ÷ conversations auxquelles le chatter a répondu.</p>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="overflow-x-auto"><h2 className="px-4 pt-4 font-display font-semibold">Par compte / modèle</h2>
            <table className="mt-2 w-full text-sm"><tbody>{d.perAccount.map((a) => <tr key={a.accountId} className="border-t border-line"><td className="px-4 py-2.5 font-medium">{a.label}</td><td className="px-3 text-right tabular-nums">{money(a.salesCents, cur)}</td><td className="px-3 text-right text-muted tabular-nums">{a.messagesIn} reçus</td></tr>)}</tbody></table></Card>
          <Card className="overflow-x-auto"><h2 className="px-4 pt-4 font-display font-semibold">Meilleurs contacts</h2>
            <table className="mt-2 w-full text-sm"><tbody>{d.topFans.map((f) => <tr key={f.conversationId} className="border-t border-line"><td className="px-4 py-2.5 font-medium">{f.name} <Badge>{f.accountLabel}</Badge></td><td className="px-3 text-right tabular-nums">{money(f.totalSpentCents, cur)}</td></tr>)}{!d.topFans.length && <tr><td className="px-4 py-6 text-center text-muted">Pas encore de vente.</td></tr>}</tbody></table></Card>
        </div>
        <Card className="overflow-x-auto"><h2 className="px-4 pt-4 font-display font-semibold">Ventes par shift</h2>
          <table className="mt-2 w-full min-w-[34rem] text-sm"><thead className="text-left text-xs text-muted"><tr><th className="px-4 py-2 font-medium">Chatter</th><th className="px-3 py-2 font-medium">Compte</th><th className="px-3 py-2 font-medium">Créneau</th><th className="px-3 py-2 text-right font-medium">Ventes</th><th className="px-3 py-2 text-right font-medium">Montant</th></tr></thead>
            <tbody>{d.shifts.map((s) => <tr key={s.id} className="border-t border-line"><td className="px-4 py-2.5 font-medium">{s.userName}</td><td className="px-3">{s.accountLabel}</td><td className="px-3 text-muted">{dateFr(s.startsAt)} {timeFr(s.startsAt)}–{timeFr(s.endsAt)}</td><td className="px-3 text-right tabular-nums">{s.salesCount}</td><td className="px-3 text-right tabular-nums">{money(s.salesCents, cur)}</td></tr>)}{!d.shifts.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">Aucun shift sur la période.</td></tr>}</tbody></table></Card>
      </>)}
    </div>
  );
}

function MyView() {
  const cur = useAuth((s) => s.user?.agency?.currency);
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const q = useQuery({ queryKey: ['analytics', 'me', range], queryFn: () => opsApi.myStats(range), refetchInterval: 60_000 });
  const d = q.data;
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <PageHeader title="Mes statistiques" subtitle="Votre activité uniquement." actions={<Segmented label="Période" value={range} onChange={setRange} options={RANGES} />} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d ? <ListSkeleton rows={2} height="h-28" /> : (<>
        {d.currentShift && <Card className="border-ok/40 bg-ok/5 p-4 text-sm">Shift en cours sur <strong>{d.currentShift.accountLabel}</strong> jusqu’à {timeFr(d.currentShift.endsAt)}.</Card>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Ventes" value={money(d.totals.salesCents, cur)} hint={`${d.totals.salesCount} vente(s)`} tone="ok" />
          <Stat label="Messages envoyés" value={num(d.totals.messagesOut)} />
          <Stat label="Temps de réponse moyen" value={duration(d.totals.avgResponseMs)} />
        </div>
        <ChartCard title="Mes ventes par jour" kind="bar" data={d.series.map((p) => ({ label: dayLabel(p.day), value: p.salesCents / 100 }))} format={(n) => money(Math.round(n * 100), cur)} />
        <ChartCard title="Mes messages envoyés" data={d.series.map((p) => ({ label: dayLabel(p.day), value: p.messagesOut }))} format={num} />
      </>)}
    </div>
  );
}
