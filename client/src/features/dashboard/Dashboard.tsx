import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { accountsApi, opsApi, walletApi } from '../../api';
import { useSeo } from '../../hooks/useSeo';
import { useAuth, useCan } from '../../stores/auth';
import { Badge, ButtonLink, ErrorState, Kpi, ListSkeleton, Page, PageHeader, Section, Segmented } from '../../components/ui';
import { ChartCard, dayLabel } from '../../components/Charts';
import { duration, money, num, pct } from '../../utils/format';
import { Icons } from '../../components/icons';
import type { AnalyticsRange } from '../../types/api';

const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: 'today', label: 'Aujourd’hui' },
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
];

/** Premier écran du chef d'agence / sous-chef : rendement de l'équipe et revenus réels. */
export default function Dashboard() {
  useSeo({ title: 'Tableau de bord', noindex: true });
  const user = useAuth((s) => s.user)!;
  const can = useCan();
  const cur = user.agency?.currency;
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const q = useQuery({
    queryKey: ['analytics', 'overview', range, ''],
    queryFn: () => opsApi.overview(range),
    refetchInterval: 60_000,
  });
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: walletApi.get, enabled: can('wallet.view') });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list });
  const d = q.data;
  const pendingBiz = (accounts.data ?? []).filter((a) => a.pendingBusiness).length;
  const failing = (accounts.data ?? []).filter((a) => a.status === 'ERROR').length;
  const best = Math.max(1, ...(d?.perChatter ?? []).map((c) => c.salesCents));
  const fee = (user.agency?.feeBps ?? 1500) / 100;

  return (
    <Page wide>
      <PageHeader
        title={`Bonjour ${user.displayName.split(' ')[0]}`}
        subtitle={`${user.agency?.name} — rendement de l’équipe et encaissements.`}
        actions={<Segmented label="Période" value={range} onChange={setRange} options={RANGES} />}
      />

      {(pendingBiz > 0 || failing > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-gold/60 bg-gold/15 px-4 py-3 text-sm shadow-xs">
          <p>
            {pendingBiz > 0 && (
              <>
                <strong>{pendingBiz} compte(s) Telegram</strong> attendent votre confirmation.{' '}
              </>
            )}
            {failing > 0 && (
              <>
                <strong>{failing} compte(s)</strong> en erreur.
              </>
            )}
          </p>
          <ButtonLink to="/app/accounts" variant="gold" size="sm">
            Voir les comptes
          </ButtonLink>
        </div>
      )}

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <ListSkeleton rows={3} height="h-28" />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* Grille des KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <Kpi
              label="Ventes brutes"
              value={money(d.totals.salesCents, cur)}
              hint={`${d.totals.salesCount} vente(s) · panier moyen ${
                d.totals.salesCount ? money(Math.round(d.totals.salesCents / d.totals.salesCount), cur) : '—'
              }`}
              icon={<Icons.Analytics className="h-5 w-5" />}
            />
            <Kpi
              label={`Commission (${fee} %)`}
              value={`− ${money(d.totals.feeCents, cur)}`}
              hint="Prélevée sur chaque vente"
              icon={<Icons.Dollar className="h-5 w-5" />}
              tone="neutral"
            />
            <Kpi
              label="Net agence"
              value={money(d.totals.netCents, cur)}
              hint="Ce qui vous revient"
              icon={<Icons.Wallet className="h-5 w-5" />}
              tone="ok"
            />
            <Kpi
              label="Disponible à retirer"
              value={wallet.data ? money(wallet.data.wallet.availableCents, cur) : can('wallet.view') ? '…' : '—'}
              hint={
                can('wallet.view') ? (
                  <Link to="/app/wallet" className="font-semibold text-brand hover:underline">
                    Demander un retrait
                  </Link>
                ) : (
                  'Réservé au chef d’agence'
                )
              }
              icon={<Icons.Wallet className="h-5 w-5" />}
              tone="gold"
            />
          </div>

          {/* Graphique et Direct */}
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              className="lg:col-span-2 shadow-xs"
              title="Ventes par jour (brut)"
              kind="bar"
              data={d.series.map((p) => ({ label: dayLabel(p.day), value: p.salesCents / 100 }))}
              format={(n) => money(Math.round(n * 100), cur)}
              headline={money(d.totals.salesCents, cur)}
            />
            <Section title="En direct" description="Ce qui attend vos chatters" className="shadow-xs">
              <dl className="space-y-3.5 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted">En attente de réponse</dt>
                  <dd className="font-display text-xl font-bold tabular-nums text-danger">{d.live.waiting}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Non assignées</dt>
                  <dd className="font-display text-xl font-bold tabular-nums text-gold">{d.live.unassigned}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Réponse moyenne</dt>
                  <dd className="flex items-center gap-1.5 font-display text-xl font-bold tabular-nums text-ink">
                    <Icons.Clock className="h-4 w-4 text-muted" aria-hidden />
                    {duration(d.totals.avgResponseMs)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Messages reçus / envoyés</dt>
                  <dd className="font-semibold tabular-nums text-ink">
                    {num(d.totals.messagesIn)} / {num(d.totals.messagesOut)}
                  </dd>
                </div>
              </dl>
              <ButtonLink to="/app/messages" variant="secondary" className="mt-4 w-full">
                Ouvrir les messages
              </ButtonLink>
            </Section>
          </div>

          {/* Tableau Rendement des Chatters avec Overflow Scroll fluide */}
          <Section
            title="Rendement des chatters"
            description="Classés par montant brut sur la période"
            flush
            className="shadow-xs"
            actions={
              <Link to="/app/analytics" className="text-xs font-semibold text-brand hover:underline">
                Détail des performances
              </Link>
            }
          >
            {!d.perChatter.length ? (
              <p className="px-5 py-8 text-center text-sm text-muted">Aucune activité sur la période.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead className="text-left text-xs text-muted border-b border-line bg-raised/30">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Chatter</th>
                      <th className="px-3 font-semibold">Ventes (brut)</th>
                      <th className="px-3 text-right font-semibold">Net</th>
                      <th className="px-3 text-right font-semibold">Messages</th>
                      <th className="px-3 text-right font-semibold">Réponse</th>
                      <th className="px-5 text-right font-semibold">Conversion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {d.perChatter.map((c, i) => (
                      <tr key={c.userId} className="hover:bg-raised/40 transition">
                        <td className="px-5 py-3.5">
                          <span className="mr-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink/8 text-xs font-bold text-ink">
                            {i + 1}
                          </span>
                          <span className="font-medium text-ink">{c.name}</span>
                        </td>
                        <td className="px-3">
                          <div className="flex items-center gap-3">
                            <div className="h-2 w-28 overflow-hidden rounded-full bg-line">
                              <div
                                className="h-full rounded-full bg-brand"
                                style={{ width: `${Math.max(3, (c.salesCents / best) * 100)}%` }}
                              />
                            </div>
                            <span className="tabular-nums font-semibold text-ink">{money(c.salesCents, cur)}</span>
                            <span className="text-xs text-muted">({c.salesCount} v.)</span>
                          </div>
                        </td>
                        <td className="px-3 text-right tabular-nums font-semibold text-ok">
                          {money(c.netCents ?? c.salesCents, cur)}
                        </td>
                        <td className="px-3 text-right tabular-nums text-muted">{c.messagesOut}</td>
                        <td className="px-3 text-right tabular-nums text-muted">{duration(c.avgResponseMs)}</td>
                        <td className="px-5 text-right tabular-nums font-medium text-ink">{pct(c.conversionRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Modèles & Paramètres rapides */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Section
              title="Modèles & comptes actifs"
              flush
              className="shadow-xs"
              actions={
                <Link to="/app/accounts" className="text-xs font-semibold text-brand hover:underline">
                  Gérer
                </Link>
              }
            >
              <ul className="divide-y divide-line/60">
                {d.perAccount.map((a) => (
                  <li key={a.accountId} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-raised/30 transition">
                    <span className="font-medium text-ink">{a.label}</span>
                    <span className="tabular-nums text-xs text-muted">{a.messagesIn} reçus</span>
                    <span className="tabular-nums font-semibold text-ink">{money(a.salesCents, cur)}</span>
                  </li>
                ))}
                {!d.perAccount.length && (
                  <li className="px-5 py-8 text-center text-sm text-muted">Aucun compte actif.</li>
                )}
              </ul>
            </Section>

            <Section title="Paramètres essentiels" description="Accès direct aux modules clés" className="shadow-xs">
              <ul className="space-y-2 text-sm">
                {[
                  ['/app/team', 'Équipe, rôles et permissions', can('team.manage')],
                  ['/app/accounts', 'Comptes Telegram des modèles', true],
                  ['/app/library', 'Médiathèque et prix des médias PPV', can('library.read')],
                  ['/app/settings', 'Devise, scripts de vente, sécurité', true],
                ]
                  .filter((x) => x[2])
                  .map(([to, label]) => (
                    <li key={String(to)}>
                      <Link
                        to={String(to)}
                        className="flex items-center justify-between rounded-ctl border border-line px-3.5 py-2.5 hover:border-brand/40 hover:bg-raised transition"
                      >
                        <span className="font-medium text-ink">{label}</span>
                        <Badge tone="brand">Ouvrir</Badge>
                      </Link>
                    </li>
                  ))}
              </ul>
            </Section>
          </div>
        </motion.div>
      )}
    </Page>
  );
}
