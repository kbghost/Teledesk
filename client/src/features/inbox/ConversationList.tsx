import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { inboxApi, accountsApi, teamApi } from '../../api';
import { flat, nextOf } from '../../hooks/useList';
import { useDebounce } from '../../hooks/useDebounce';
import { useAuth, useCan } from '../../stores/auth';
import { Avatar, Badge, EmptyState, ErrorState, ListSkeleton, Select } from '../../components/ui';
import { LoadMore } from '../../components/LoadMore';
import { cn, relTime, money } from '../../utils/format';
import { Icons } from '../../components/icons';
import type { Conversation } from '../../types/api';

export interface Filters {
  assigned: string;
  accountId: string;
  q: string;
  waiting: boolean;
  unread: boolean;
  status: 'OPEN' | 'ARCHIVED';
}

export const defaultFilters = (supervisor: boolean): Filters => ({
  assigned: supervisor ? 'any' : 'any',
  accountId: '',
  q: '',
  waiting: false,
  unread: false,
  status: 'OPEN',
});

export function ConversationList({
  filters,
  setFilters,
  selected,
  onSelect,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const can = useCan();
  const user = useAuth((s) => s.user)!;
  const supervisor = can('inbox.supervise');
  const q = useDebounce(filters.q, 300);
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list });
  const team = useQuery({ queryKey: ['assignable'], queryFn: teamApi.assignable, enabled: supervisor });
  const tagsQ = useQuery({ queryKey: ['tags'], queryFn: inboxApi.tags });
  const list = useInfiniteQuery({
    queryKey: ['conversations', { ...filters, q }],
    queryFn: ({ pageParam }) =>
      inboxApi.conversations({
        status: filters.status,
        assigned: filters.assigned,
        accountId: filters.accountId || undefined,
        q: q || undefined,
        waiting: filters.waiting ? '1' : undefined,
        unread: filters.unread ? '1' : undefined,
        cursor: pageParam,
        limit: 30,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextOf,
    staleTime: 5_000,
  });

  const items = flat(list.data);
  const label = new Map((accounts.data ?? []).map((a) => [a.id, a.label]));
  const names = new Map((team.data ?? []).map((m) => [m.id, m.displayName]));
  const tags = new Map((tagsQ.data ?? []).map((t) => [t.id, t]));
  const set = (p: Partial<Filters>) => setFilters({ ...filters, ...p });

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="space-y-2.5 border-b border-line p-3 shrink-0">
        <div className="relative">
          <Icons.Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" aria-hidden />
          <input
            aria-label="Rechercher une conversation"
            placeholder="Rechercher un contact, @username…"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            className="h-10 w-full rounded-ctl border border-line bg-surface pl-9 pr-3 text-xs focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Select
            aria-label="Assignation"
            value={filters.assigned}
            onChange={(e) => set({ assigned: e.target.value })}
            className="h-9 text-xs"
          >
            <option value="any">Toutes</option>
            <option value="me">Les miennes</option>
            <option value="none">Non assignées</option>
            {supervisor &&
              (team.data ?? [])
                .filter((m) => m.id !== user.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
          </Select>
          <Select
            aria-label="Compte Telegram"
            value={filters.accountId}
            onChange={(e) => set({ accountId: e.target.value })}
            className="h-9 text-xs"
          >
            <option value="">Tous les comptes</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs pt-0.5">
          {([
            ['waiting', 'À répondre'],
            ['unread', 'Non lues'],
          ] as const).map(([k, l]) => (
            <button
              key={k}
              aria-pressed={filters[k]}
              onClick={() => set({ [k]: !filters[k] })}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition',
                filters[k]
                  ? 'border-brand bg-brand text-brand-ink shadow-xs'
                  : 'border-line bg-surface text-muted hover:text-ink hover:bg-raised',
              )}
            >
              {l}
            </button>
          ))}
          <button
            aria-pressed={filters.status === 'ARCHIVED'}
            onClick={() => set({ status: filters.status === 'OPEN' ? 'ARCHIVED' : 'OPEN' })}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition',
              filters.status === 'ARCHIVED'
                ? 'border-brand bg-brand text-brand-ink shadow-xs'
                : 'border-line bg-surface text-muted hover:text-ink hover:bg-raised',
            )}
          >
            Archivées
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isLoading ? (
          <div className="p-3">
            <ListSkeleton rows={6} height="h-16" />
          </div>
        ) : list.isError ? (
          <div className="p-3">
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          </div>
        ) : !items.length ? (
          <div className="p-4">
            <EmptyState
              icon={<Icons.Inbox className="h-6 w-6" />}
              title="Aucune conversation"
              text="Les messages de vos contacts apparaîtront ici dès qu’ils écriront sur un compte connecté."
            />
          </div>
        ) : (
          <ul className="divide-y divide-line/60">
            {items.map((c) => (
              <Row
                key={c.id}
                c={c}
                active={c.id === selected}
                account={label.get(c.accountId)}
                owner={c.assignedTo ? (c.assignedTo === user.id ? 'Moi' : names.get(c.assignedTo) ?? 'Collègue') : null}
                tags={
                  c.tagIds
                    .map((t) => tags.get(t))
                    .filter(Boolean) as { id: string; name: string; color: string }[]
                }
                onClick={() => onSelect(c.id)}
                currency={user.agency?.currency}
              />
            ))}
          </ul>
        )}
        <LoadMore q={list} />
      </div>
    </div>
  );
}

function Row({
  c,
  active,
  account,
  owner,
  tags,
  onClick,
  currency,
}: {
  c: Conversation;
  active: boolean;
  account?: string;
  owner: string | null;
  tags: { id: string; name: string; color: string }[];
  onClick: () => void;
  currency?: string;
}) {
  const waiting = !!c.awaitingSince;
  return (
    <motion.li whileTap={{ scale: 0.99 }}>
      <button
        onClick={onClick}
        aria-current={active}
        className={cn(
          'flex w-full gap-3 px-3 py-3 text-left transition relative',
          active ? 'bg-brand/10 border-l-3 border-brand' : 'hover:bg-raised/70',
        )}
      >
        <Avatar name={c.contact.name} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-1.5">
            <p className={cn('truncate text-sm', c.unreadCount ? 'font-bold text-ink' : 'font-semibold text-ink')}>
              {c.contact.name}
            </p>
            <time className="shrink-0 text-[11px] text-muted">{relTime(c.lastMessageAt)}</time>
          </div>
          <p className={cn('mt-0.5 truncate text-xs', c.unreadCount ? 'text-ink font-medium' : 'text-muted')}>
            {c.lastMessageDirection === 'OUT' && <span className="text-muted">Vous : </span>}
            {c.lastMessagePreview || '—'}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {account && <Badge className="text-[10px]">{account}</Badge>}
            {owner ? (
              <Badge tone="brand" className="text-[10px]">
                {owner}
              </Badge>
            ) : (
              <Badge tone="gold" className="text-[10px]">
                Non assignée
              </Badge>
            )}
            {waiting && (
              <Badge tone="danger" className="text-[10px]">
                À répondre
              </Badge>
            )}
            {c.totalSpentCents > 0 && (
              <Badge tone="ok" className="text-[10px]">
                {money(c.totalSpentCents, currency)}
              </Badge>
            )}
            {tags.slice(0, 2).map((t) => (
              <span
                key={t.id}
                className="rounded-full px-1.5 py-0.2 text-[10px] font-medium text-white"
                style={{ background: t.color }}
              >
                {t.name}
              </span>
            ))}
            {c.unreadCount > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-ink">
                {c.unreadCount}
              </span>
            )}
          </div>
        </div>
      </button>
    </motion.li>
  );
}
