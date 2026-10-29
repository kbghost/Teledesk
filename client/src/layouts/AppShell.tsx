import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { FiLogOut } from 'react-icons/fi';
import type { Permission } from '@teledesk/shared';
import { adminApi } from '../api';
import { useAuth, useCan } from '../stores/auth';
import { useUi } from '../stores/ui';
import { authApi } from '../api/auth';
import { Logo, LogoMark } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { RealtimeBridge } from '../components/RealtimeBridge';
import { Avatar, Badge } from '../components/ui';
import { disconnectSocket } from '../services/socket';
import { queryClient } from '../lib/query';
import { setActiveAgency } from '../stores/agency';
import { cn } from '../utils/format';
import { AgencySwitcher } from './AgencySwitcher';
import { Icons, type IconType } from '../components/icons';

interface Item {
  to: string;
  label: string;
  icon: IconType;
  any?: Permission[];
  end?: boolean;
  badge?: number;
  group: string;
}

const AGENCY_ITEMS: Item[] = [
  { to: '/app', label: 'Tableau de bord', icon: Icons.Dashboard, any: ['analytics.team', 'analytics.me'], end: true, group: 'Pilotage' },
  { to: '/app/analytics', label: 'Performance', icon: Icons.Analytics, any: ['analytics.team', 'analytics.me'], group: 'Pilotage' },
  { to: '/app/sales', label: 'Ventes', icon: Icons.Sales, any: ['sales.record', 'analytics.team'], group: 'Pilotage' },
  { to: '/app/messages', label: 'Messages', icon: Icons.Messages, any: ['inbox.reply', 'inbox.supervise'], group: 'Activité' },
  { to: '/app/library', label: 'Médiathèque', icon: Icons.Library, any: ['library.read'], group: 'Activité' },
  { to: '/app/shifts', label: 'Shifts', icon: Icons.Shifts, any: ['shifts.manage', 'inbox.reply'], group: 'Activité' },
  { to: '/app/accounts', label: 'Comptes Telegram', icon: Icons.Accounts, any: ['accounts.manage', 'inbox.supervise', 'library.read'], group: 'Agence' },
  { to: '/app/team', label: 'Équipe', icon: Icons.Team, any: ['team.manage'], group: 'Agence' },
  { to: '/app/wallet', label: 'Portefeuille', icon: Icons.Wallet, any: ['wallet.view'], group: 'Agence' },
  { to: '/app/settings', label: 'Paramètres', icon: Icons.Settings, group: 'Agence' },
];

const ADMIN_ITEMS: Item[] = [
  { to: '/app', label: 'Vue d’ensemble', icon: Icons.Dashboard, end: true, group: 'Plateforme' },
  { to: '/app/admin/agencies', label: 'Agences', icon: Icons.Agencies, group: 'Plateforme' },
  { to: '/app/admin/payouts', label: 'Retraits', icon: Icons.Wallet, group: 'Plateforme' },
  { to: '/app/admin/messages', label: 'Voir les messages', icon: Icons.Eye, group: 'Supervision' },
  { to: '/app/settings', label: 'Paramètres', icon: Icons.Settings, group: 'Compte' },
];

export default function AppShell() {
  const user = useAuth((s) => s.user)!;
  const can = useCan();
  const { sidebarCollapsed: collapsed, toggleSidebar } = useUi();
  const navigate = useNavigate();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const pending = useQuery({
    queryKey: ['admin', 'payouts', 'PENDING'],
    queryFn: () => adminApi.payouts('PENDING'),
    enabled: user.platform,
    refetchInterval: 60_000,
  });

  const base = user.platform ? ADMIN_ITEMS : AGENCY_ITEMS;
  const items = base
    .filter((i) => !i.any || i.any.some(can))
    .map((i) => (i.to === '/app/admin/payouts' ? { ...i, badge: pending.data?.length ?? 0 } : i));

  const MAIN = 4;
  const primary = items.length > MAIN + 1 ? items.slice(0, MAIN) : items;
  const extra = items.length > MAIN + 1 ? items.slice(MAIN) : [];
  const extraActive = extra.some((i) => loc.pathname.startsWith(i.to) && i.to !== '/app');
  const groups = [...new Set(items.map((i) => i.group))];

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      /* session déjà expirée */
    }
    disconnectSocket();
    queryClient.clear();
    setActiveAgency(null);
    useAuth.getState().clear();
    navigate('/login', { replace: true });
  };

  const inbox = loc.pathname.startsWith('/app/messages');

  return (
    <div className="flex h-dvh flex-col md:flex-row bg-bg">
      <RealtimeBridge />

      {/* Barre latérale desktop / tablette avec transition fluide */}
      <motion.aside
        animate={{ width: collapsed ? 68 : 256 }}
        transition={{ type: 'spring', damping: 25, stiffness: 280 }}
        className="hidden shrink-0 flex-col border-r border-line bg-surface overflow-hidden md:flex shadow-xs"
      >
        <div className={cn('flex h-14 items-center shrink-0', collapsed ? 'justify-center' : 'justify-between px-4')}>
          {collapsed ? <LogoMark size={28} /> : <Logo />}
          {!collapsed && (
            <button
              onClick={toggleSidebar}
              aria-label="Masquer la barre latérale"
              title="Masquer la barre latérale"
              className="flex h-8 w-8 items-center justify-center rounded-ctl text-muted transition hover:bg-ink/5 hover:text-ink"
            >
              <Icons.SidebarCollapse className="h-5 w-5" />
            </button>
          )}
        </div>

        {!user.platform && (
          <div className="px-3 pb-2 shrink-0">
            <AgencySwitcher compact={collapsed} />
          </div>
        )}

        {user.platform && !collapsed && (
          <div className="mx-3 mb-2 rounded-ctl bg-gold/15 px-3 py-1.5 text-xs font-semibold text-ink">
            Console plateforme
          </div>
        )}

        <nav aria-label="Navigation principale" className="flex-1 space-y-3 overflow-y-auto px-2 py-2">
          {groups.map((g) => (
            <div key={g}>
              {!collapsed ? (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted/70">
                  {g}
                </p>
              ) : (
                <div className="mx-3 mb-1 border-t border-line first:hidden" />
              )}
              <div className="space-y-1">
                {items
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <NavLink
                      key={i.to}
                      to={i.to}
                      end={i.end}
                      title={collapsed ? i.label : undefined}
                      aria-label={collapsed ? i.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'relative flex items-center gap-3 rounded-ctl px-3 py-2 text-sm font-medium transition-colors',
                          collapsed && 'justify-center px-0 h-10',
                          isActive ? 'text-brand font-semibold' : 'text-muted hover:bg-ink/5 hover:text-ink',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <motion.span
                              layoutId="activeNavIndicator"
                              className="absolute inset-0 rounded-ctl bg-brand/10 border border-brand/20 z-0"
                              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
                            />
                          )}
                          <i.icon className="h-[19px] w-[19px] shrink-0 z-10" aria-hidden />
                          {!collapsed && <span className="truncate z-10">{i.label}</span>}
                          {!!i.badge && (
                            <span
                              className={cn(
                                'rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-bold text-gold-ink z-10',
                                collapsed ? 'absolute right-1 top-1' : 'ml-auto',
                              )}
                            >
                              {i.badge}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-3 shrink-0">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={toggleSidebar}
                aria-label="Afficher la barre latérale"
                title="Afficher la barre latérale"
                className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted transition hover:bg-ink/5 hover:text-ink"
              >
                <Icons.SidebarExpand className="h-5 w-5" />
              </button>
              <ThemeToggle />
              <button
                onClick={logout}
                aria-label="Se déconnecter"
                title="Se déconnecter"
                className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted transition hover:bg-danger/10 hover:text-danger"
              >
                <FiLogOut className="h-[18px] w-[18px]" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <Avatar name={user.displayName} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{user.displayName}</p>
                  <Badge tone="brand" className="mt-0.5 text-[10px]">
                    {user.roleLabel}
                  </Badge>
                </div>
                <ThemeToggle />
              </div>
              <button
                onClick={logout}
                className="mt-2.5 flex w-full items-center gap-2 rounded-ctl px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-danger/10 hover:text-danger"
              >
                <FiLogOut className="h-4 w-4" />
                Se déconnecter
              </button>
            </>
          )}
        </div>
      </motion.aside>

      {/* Header Mobile / Tablette */}
      <header className="flex h-13 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/90 backdrop-blur-md px-3 md:hidden z-20">
        <Logo />
        <div className="flex min-w-0 items-center gap-1.5">
          {!user.platform && user.agencies.length > 1 && (
            <div className="w-36">
              <AgencySwitcher />
            </div>
          )}
          <ThemeToggle />
          <button
            onClick={logout}
            aria-label="Se déconnecter"
            className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted hover:text-danger transition"
          >
            <FiLogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Contenu principal */}
      <main id="main" className={cn('min-h-0 min-w-0 flex-1', inbox ? 'overflow-hidden' : 'overflow-y-auto')}>
        <Outlet />
      </main>

      {/* Modal / Tiroir "Plus" Mobile avec Framer Motion */}
      <AnimatePresence>
        {more && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu supplémentaire">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink/40 backdrop-blur-xs"
              onClick={() => setMore(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
              className="safe-bottom absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-surface p-4 shadow-2xl"
            >
              <div className="mb-2 flex items-center justify-between px-2 pb-2 border-b border-line">
                <div>
                  <p className="text-sm font-semibold">{user.displayName}</p>
                  <p className="text-xs text-muted">{user.roleLabel}</p>
                </div>
                <button
                  aria-label="Fermer"
                  onClick={() => setMore(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-ctl text-muted hover:bg-ink/5"
                >
                  <Icons.Close className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-1 py-1">
                {extra.map((i) => (
                  <NavLink
                    key={i.to}
                    to={i.to}
                    onClick={() => setMore(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-ctl px-3 py-2.5 text-sm font-medium transition',
                        isActive ? 'bg-brand/10 text-brand font-semibold' : 'text-ink hover:bg-ink/5',
                      )
                    }
                  >
                    <i.icon className="h-5 w-5 text-muted" aria-hidden />
                    <span>{i.label}</span>
                    {!!i.badge && (
                      <span className="ml-auto rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-bold text-gold-ink">
                        {i.badge}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
              <button
                onClick={logout}
                className="mt-2 flex w-full items-center gap-3 rounded-ctl px-3 py-2.5 text-sm font-medium text-danger hover:bg-danger/10 transition"
              >
                <FiLogOut className="h-5 w-5" aria-hidden />
                <span>Se déconnecter</span>
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Barre de navigation mobile inférieure */}
      <nav
        aria-label="Navigation mobile"
        className="safe-bottom flex shrink-0 border-t border-line bg-surface/95 backdrop-blur-md md:hidden z-20"
      >
        {primary.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.end}
            className={({ isActive }) =>
              cn(
                'relative flex min-h-[3.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors',
                isActive ? 'text-brand font-semibold' : 'text-muted hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <i.icon className="h-5 w-5" aria-hidden />
                <span className="max-w-full truncate">{i.label.split(' ')[0]}</span>
                {isActive && (
                  <motion.div
                    layoutId="mobileNavDot"
                    className="absolute bottom-1 h-1 w-5 rounded-full bg-brand"
                    transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
        {extra.length > 0 && (
          <button
            onClick={() => setMore(true)}
            aria-haspopup="dialog"
            className={cn(
              'flex min-h-[3.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors',
              extraActive ? 'text-brand font-semibold' : 'text-muted hover:text-ink',
            )}
          >
            <Icons.MoreHorizontal className="h-5 w-5" aria-hidden />
            <span>Plus</span>
          </button>
        )}
      </nav>
    </div>
  );
}
