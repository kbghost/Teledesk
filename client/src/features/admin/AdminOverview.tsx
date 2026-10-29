import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Icons } from '../../components/icons';
import { adminApi } from '../../api';
import { useSeo } from '../../hooks/useSeo';
import { Badge, ButtonLink, ErrorState, Kpi, ListSkeleton, Page, PageHeader, Section, Segmented } from '../../components/ui';
import { ChartCard, dayLabel } from '../../components/Charts';
import { money, num } from '../../utils/format';

const RANGES = [{ value: '7', label: '7 jours' }, { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' }];

/** Premier écran du super admin : comment la plateforme évolue (pas les messages). */
export default function AdminOverview() {
  useSeo({ title: 'Vue d’ensemble', noindex: true });
  const [days, setDays] = useState('30');
  const q = useQuery({ queryKey: ['admin', 'overview', days], queryFn: () => adminApi.overview(Number(days)), refetchInterval: 60_000 });
  const d = q.data;
  return (
    <Page wide>
      <PageHeader title="Vue d’ensemble" subtitle="L’évolution de la plateforme : volume, commission, agences et retraits à valider." actions={<Segmented label="Période" value={days} onChange={setDays} options={RANGES} />} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d ? <ListSkeleton rows={3} height="h-28" /> : (<>
        {d.pendingPayouts.count > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-gold/60 bg-gold/15 px-4 py-3">
            <p className="text-sm"><strong>{d.pendingPayouts.count} demande(s) de retrait</strong> à traiter — {money(d.pendingPayouts.amountCents)} au total.</p>
            <ButtonLink to="/app/admin/payouts" variant="gold" size="sm">Traiter les retraits</ButtonLink>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Volume brut" value={money(d.totals.grossCents)} hint={`${num(d.totals.sales)} vente(s) sur ${d.days} j`} icon={<Icons.Analytics />} />
          <Kpi label="Commission plateforme" value={money(d.totals.commissionCents)} hint="Votre revenu (15 % par défaut)" icon={<Icons.Coins />} tone="ok" />
          <Kpi label="Agences" value={num(d.totals.agencies)} hint={`${d.totals.newAgencies} nouvelle(s) · ${d.totals.bannedAgencies} bannie(s)`} icon={<Icons.Building />} />
          <Kpi label="Retraits en attente" value={money(d.pendingPayouts.amountCents)} hint={`${d.pendingPayouts.count} demande(s)`} icon={<Icons.Banknote />} tone={d.pendingPayouts.count ? 'gold' : 'neutral'} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Volume brut par jour" kind="bar" data={d.series.map((p) => ({ label: dayLabel(p.day), value: p.grossCents / 100 }))} format={(n) => money(Math.round(n * 100))} headline={money(d.totals.grossCents)} />
          <ChartCard title="Commission par jour" data={d.series.map((p) => ({ label: dayLabel(p.day), value: p.feeCents / 100 }))} format={(n) => money(Math.round(n * 100))} headline={money(d.totals.commissionCents)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Nouvelles agences par jour" kind="bar" data={d.series.map((p) => ({ label: dayLabel(p.day), value: p.newAgencies }))} format={num} headline={num(d.totals.newAgencies)} />
          <Section title="Agences les plus actives" description={`Sur ${d.days} jours`} flush actions={<Link to="/app/admin/agencies" className="text-sm font-semibold text-brand hover:underline">Toutes les agences</Link>}>
            <table className="w-full text-sm"><tbody>
              {d.topAgencies.map((a, i) => (
                <tr key={a.id} className="border-t border-line first:border-0"><td className="w-10 px-4 py-2.5 text-muted">{i + 1}</td><td className="py-2.5 font-medium">{a.name}</td><td className="px-3 text-right tabular-nums">{money(a.grossCents)}</td><td className="px-4 text-right"><Badge tone="ok">+{money(a.commissionCents)}</Badge></td></tr>
              ))}
              {!d.topAgencies.length && <tr><td className="px-4 py-8 text-center text-muted">Pas encore de vente sur la période.</td></tr>}
            </tbody></table>
          </Section>
        </div>
      </>)}
    </Page>
  );
}
