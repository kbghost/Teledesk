import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Icons } from '../../components/icons';
import { adminApi } from '../../api';
import { flat, nextOf } from '../../hooks/useList';
import { useSeo } from '../../hooks/useSeo';
import { Badge, EmptyState, ErrorState, ListSkeleton, Select } from '../../components/ui';
import { LoadMore } from '../../components/LoadMore';
import { Avatar } from '../../components/ui';
import { Bubble } from '../inbox/Thread';
import { cn, relTime } from '../../utils/format';

/** « Voir les messages » : lecture seule des conversations d'une agence ; chaque ouverture est journalisée dans l'audit de l'agence. */
export default function AdminMessages() {
  useSeo({ title: 'Voir les messages', noindex: true });
  const [sp, setSp] = useSearchParams();
  const agency = sp.get('agency') ?? '';
  const conv = sp.get('c');
  const agencies = useQuery({ queryKey: ['admin', 'agencies', ''], queryFn: () => adminApi.agencies() });
  const list = useInfiniteQuery({
    queryKey: ['admin', 'convs', agency], enabled: !!agency,
    queryFn: ({ pageParam }) => adminApi.conversations(agency, { cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined, getNextPageParam: nextOf,
  });
  const msgs = useInfiniteQuery({
    queryKey: ['admin', 'msgs', conv], enabled: !!conv,
    queryFn: ({ pageParam }) => adminApi.messages(conv!, { cursor: pageParam, limit: 40 }),
    initialPageParam: undefined as string | undefined, getNextPageParam: nextOf,
  });
  const items = flat(list.data); const messages = [...flat(msgs.data)].reverse();
  const head = msgs.data?.pages[0]?.conversation;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [conv, messages.length]);
  const set = (p: Record<string, string>) => setSp(p, { replace: false });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <Icons.Eye className="h-5 w-5 text-muted" aria-hidden />
        <h1 className="font-display text-lg font-semibold">Voir les messages</h1>
        <Select aria-label="Agence" value={agency} onChange={(e) => set(e.target.value ? { agency: e.target.value } : {})} className="min-w-56">
          <option value="">Choisir une agence…</option>{(agencies.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Badge tone="gold" className="ml-auto">Lecture seule · consultation journalisée</Badge>
      </div>
      {!agency ? <div className="p-6"><EmptyState icon={<Icons.Eye />} title="Choisissez une agence" text="Vous pouvez lire les conversations de n’importe quelle agence. L’agence voit ces consultations dans son journal d’audit." /></div> : (
        <div className="flex min-h-0 flex-1">
          <section aria-label="Conversations" className={cn('w-full shrink-0 overflow-y-auto border-r border-line bg-surface lg:block lg:w-80', conv && 'hidden')}>
            {list.isError ? <div className="p-4"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div> : list.isLoading ? <div className="p-3"><ListSkeleton rows={6} height="h-16" /></div> : !items.length ? <p className="p-6 text-center text-sm text-muted">Aucune conversation dans cette agence.</p> : (
              <ul>{items.map((c) => (
                <li key={c.id}><button onClick={() => set({ agency, c: c.id })} className={cn('flex w-full items-center gap-3 border-b border-line px-3 py-3 text-left hover:bg-ink/5', conv === c.id && 'bg-brand/8')}>
                  <Avatar name={c.contact.name} size={38} />
                  <span className="min-w-0 flex-1"><span className="flex items-baseline justify-between gap-2"><span className="truncate font-semibold">{c.contact.name}</span><span className="shrink-0 text-xs text-muted">{relTime(c.lastMessageAt)}</span></span><span className="block truncate text-sm text-muted">{c.lastMessagePreview}</span></span>
                </button></li>))}</ul>
            )}
            <LoadMore q={list} auto={false} />
          </section>
          <section aria-label="Messages" className={cn('min-w-0 flex-1 flex-col bg-bg', conv ? 'flex' : 'hidden lg:flex')}>
            {!conv ? <div className="flex h-full items-center justify-center text-sm text-muted">Sélectionnez une conversation.</div> : (<>
              <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5"><button aria-label="Retour" onClick={() => set({ agency })} className="flex h-9 w-9 items-center justify-center rounded-ctl hover:bg-ink/5 lg:hidden"><Icons.ArrowLeft className="h-5 w-5" /></button>{head && <><Avatar name={head.contact.name} size={34} /><div><p className="font-semibold leading-tight">{head.contact.name}</p><p className="text-xs text-muted">{head.messagesCount} message(s) · {head.salesCount} vente(s)</p></div></>}</div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                {msgs.hasNextPage && <button onClick={() => void msgs.fetchNextPage()} className="mx-auto block text-sm font-semibold text-brand hover:underline">Messages plus anciens</button>}
                {msgs.isLoading ? <ListSkeleton rows={4} height="h-12" /> : messages.map((m) => <Bubble key={m.id} m={m} who={m.sentBy ? 'Chatter' : undefined} onRetry={() => undefined} onUnlock={() => undefined} canUnlock={false} />)}
                <div ref={end} />
              </div>
            </>)}
          </section>
        </div>
      )}
    </div>
  );
}
