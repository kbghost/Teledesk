import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { inboxApi, teamApi } from '../../api';
import { errMsg } from '../../api/http';
import { flat } from '../../hooks/useList';
import { toast } from '../../stores/ui';
import { useAuth, useCan } from '../../stores/auth';
import { Avatar, Button, EmptyState, ErrorState, PageSpinner, Select, useConfirm } from '../../components/ui';
import { cn, timeFr, dateFr, money } from '../../utils/format';
import { Composer } from './Composer';
import { Icons } from '../../components/icons';
import type { Conversation, Message } from '../../types/api';

export function Bubble({
  m,
  who,
  onRetry,
  onUnlock,
  canUnlock,
  currency,
}: {
  m: Message;
  who?: string;
  onRetry: () => void;
  onUnlock: () => void;
  canUnlock: boolean;
  currency?: string;
}) {
  const out = m.direction === 'OUT';
  const a = m.attachment;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={cn('flex', out ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[85%] sm:max-w-[78%] rounded-bubble px-3.5 py-2.5 text-sm shadow-xs transition-shadow',
          out
            ? 'rounded-br-xs bg-brand text-brand-ink'
            : 'rounded-bl-xs border border-line bg-surface text-ink',
        )}
      >
        {out && who && (
          <p className="mb-1 text-[11px] font-semibold opacity-85">
            {who}
            {m.source === 'TELEGRAM_APP' ? ' · appli Telegram' : ''}
          </p>
        )}

        {a && (
          <div className="mb-2 overflow-hidden rounded-ctl border border-black/10">
            {a.thumbUrl || (a.kind === 'IMAGE' && a.url) ? (
              <a href={a.url ?? undefined} target="_blank" rel="noreferrer">
                <img
                  src={a.thumbUrl ?? a.url!}
                  alt={a.name ?? 'Image'}
                  loading="lazy"
                  className="max-h-72 w-full object-cover transition hover:opacity-95"
                />
              </a>
            ) : a.kind === 'VIDEO' && a.url ? (
              <video src={a.url} controls preload="metadata" className="max-h-72 w-full rounded-ctl" />
            ) : a.kind === 'AUDIO' && a.url ? (
              <audio src={a.url} controls className="w-64 max-w-full" />
            ) : a.url ? (
              <a href={a.url} className="flex items-center gap-2 underline p-2 font-medium">
                <Icons.File className="h-4 w-4" />
                {a.name ?? 'Fichier'}
              </a>
            ) : (
              <p className="flex items-center gap-2 p-2 text-xs opacity-80">
                {a.pending ? (
                  <>
                    <Icons.Loader className="h-3.5 w-3.5 animate-spin" />
                    Téléchargement du fichier…
                  </>
                ) : (
                  `Fichier indisponible${a.unavailable === 'TOO_LARGE' ? ' (trop volumineux)' : ''}`
                )}
              </p>
            )}
          </div>
        )}

        {m.ppv && (
          <div
            className={cn(
              'mb-2 rounded-ctl border px-3 py-2 text-xs shadow-xs',
              m.ppv.state === 'UNLOCKED'
                ? 'border-ok/40 bg-ok/15 text-ok dark:text-ok'
                : 'border-gold/60 bg-gold/15 text-ink',
            )}
          >
            {m.ppv.state === 'UNLOCKED' ? (
              <p className="flex items-center gap-1.5 font-semibold">
                <Icons.LockOpen className="h-4 w-4" aria-hidden />
                Débloqué · {money(m.ppv.priceCents, currency)} encaissé
              </p>
            ) : (
              <>
                <p className="flex items-center gap-1.5 font-semibold">
                  <Icons.Lock className="h-4 w-4" aria-hidden />
                  PPV {money(m.ppv.priceCents, currency)} —{' '}
                  {m.ppv.state === 'UNLOCKING'
                    ? 'déblocage en cours…'
                    : 'le contact ne voit qu’un aperçu flouté'}
                </p>
                {m.status === 'SENT' && m.ppv.state === 'LOCKED' && canUnlock && (
                  <button
                    onClick={onUnlock}
                    className="mt-1.5 inline-flex items-center gap-1.5 rounded-ctl bg-ink px-2.5 py-1 text-xs font-semibold text-bg transition hover:opacity-90 active:scale-95"
                  >
                    <Icons.LockOpen className="h-3.5 w-3.5" aria-hidden />
                    Paiement reçu : débloquer
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {m.text && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>}

        {m.deletedByContactAt && (
          <p className="mt-1 text-xs italic opacity-75">Supprimé par le contact dans Telegram</p>
        )}

        <div
          className={cn(
            'mt-1 flex items-center justify-end gap-1.5 text-[11px]',
            out ? 'opacity-80' : 'text-muted',
          )}
        >
          {m.editedAt && <span>modifié</span>}
          <time>{timeFr(m.createdAt)}</time>
          {out &&
            (m.status === 'QUEUED' || m.status === 'SENDING' ? (
              <Icons.Clock className="h-3 w-3" aria-label="Envoi en cours" />
            ) : m.status === 'SENT' ? (
              <Icons.CheckDouble className="h-3.5 w-3.5" aria-label="Envoyé" />
            ) : m.status === 'FAILED' ? (
              <Icons.AlertCircle className="h-3.5 w-3.5 text-danger" aria-label="Échec" />
            ) : (
              <Icons.Check className="h-3 w-3" />
            ))}
        </div>

        {m.status === 'FAILED' && (
          <div className="mt-2 rounded-ctl bg-danger/15 p-2 text-xs text-ink">
            <p>{m.error ?? 'Échec de l’envoi'}</p>
            <button
              onClick={onRetry}
              className="mt-1 inline-flex items-center gap-1 font-semibold text-danger hover:underline"
            >
              <Icons.RotateCcw className="h-3 w-3" />
              Renvoyer
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function Thread({
  id,
  onBack,
  onTogglePanel,
}: {
  id: string;
  onBack: () => void;
  onTogglePanel: () => void;
}) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user)!;
  const can = useCan();
  const supervisor = can('inbox.supervise');
  const conv = useQuery({ queryKey: ['conversation', id], queryFn: () => inboxApi.conversation(id), staleTime: 10_000 });
  const team = useQuery({ queryKey: ['assignable'], queryFn: teamApi.assignable, enabled: can('conversation.assign') });
  const msgs = useInfiniteQuery({
    queryKey: ['messages', id],
    queryFn: ({ pageParam }) => inboxApi.messages(id, { cursor: pageParam, limit: 40 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    staleTime: 3 * 60_000,
  });

  const ordered = useMemo(() => [...flat(msgs.data)].reverse(), [msgs.data]);
  const names = new Map((team.data ?? []).map((m) => [m.id, m.displayName]));
  names.set(user.id, 'Vous');
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [ordered.length, id]);

  useEffect(() => {
    stick.current = true;
  }, [id]);

  const unread = conv.data?.unreadCount ?? 0;
  useEffect(() => {
    if (unread > 0 && can('inbox.reply'))
      void inboxApi
        .read(id)
        .then(() => qc.invalidateQueries({ queryKey: ['conversations'] }))
        .catch(() => undefined);
  }, [id, unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = useMutation({
    mutationFn: (b: Parameters<typeof inboxApi.patch>[1]) => inboxApi.patch(id, b),
    onSuccess: (c) => {
      qc.setQueryData(['conversation', id], c);
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const confirm = useConfirm();
  const unlock = useMutation({
    mutationFn: inboxApi.unlock,
    onSuccess: () => {
      toast.success('Original envoyé, vente enregistrée');
      void qc.invalidateQueries({ queryKey: ['messages', id] });
      void qc.invalidateQueries({ queryKey: ['conversation', id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const askUnlock = async (m: Message) => {
    if (
      m.ppv &&
      (await confirm({
        title: `Débloquer pour ${money(m.ppv.priceCents, user.agency?.currency)} ?`,
        text: 'À faire seulement une fois le paiement reçu. L’original est envoyé au contact et la vente est enregistrée à votre nom.',
        confirmLabel: 'Paiement reçu, débloquer',
      }))
    )
      unlock.mutate(m.id);
  };

  const retry = useMutation({
    mutationFn: inboxApi.retry,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', id] }),
    onError: (e) => toast.error(errMsg(e)),
  });

  if (conv.isLoading) return <PageSpinner />;
  if (conv.isError)
    return (
      <div className="p-6">
        <ErrorState error={conv.error} title="Conversation introuvable" onRetry={onBack} />
      </div>
    );

  const c = conv.data as Conversation;
  const mine = c.assignedTo === user.id;
  let lastDay = '';

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/90 backdrop-blur-md px-3.5 py-2.5 z-10 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onBack}
            aria-label="Retour à la liste"
            className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted transition hover:bg-ink/5 hover:text-ink lg:hidden shrink-0"
          >
            <Icons.ArrowLeft className="h-5 w-5" />
          </button>
          <button
            onClick={onTogglePanel}
            className="flex min-w-0 items-center gap-2.5 text-left transition hover:opacity-90"
            aria-label="Détails du contact"
          >
            <Avatar name={c.contact.name} size={36} />
            <div className="min-w-0">
              <p className="truncate font-semibold text-sm leading-tight text-ink">{c.contact.name}</p>
              <p className="truncate text-xs text-muted">
                {c.contact.username ? `@${c.contact.username} · ` : ''}
                {c.channel === 'BUSINESS' ? 'Telegram Business' : 'Bot'}
                {c.blocked ? ' · a bloqué le compte' : ''}
              </p>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {can('conversation.assign') ? (
            <Select
              aria-label="Assigner à"
              value={c.assignedTo ?? ''}
              onChange={(e) => patch.mutate({ assignedTo: e.target.value || null })}
              className="h-8 text-xs min-w-28 sm:w-36"
            >
              <option value="">Non assignée</option>
              {(team.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </Select>
          ) : can('inbox.reply') ? (
            mine ? (
              <Button size="sm" variant="secondary" onClick={() => patch.mutate({ assignedTo: null })} loading={patch.isPending}>
                Libérer
              </Button>
            ) : !c.assignedTo ? (
              <Button size="sm" onClick={() => patch.mutate({ assignedTo: user.id })} loading={patch.isPending}>
                Prendre
              </Button>
            ) : null
          ) : null}

          {supervisor || can('inbox.reply') ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => patch.mutate({ status: c.status === 'OPEN' ? 'ARCHIVED' : 'OPEN' })}
            >
              {c.status === 'OPEN' ? 'Archiver' : 'Rouvrir'}
            </Button>
          ) : null}
        </div>
      </header>

      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-bg/60 px-3.5 py-4"
        aria-live="polite"
        aria-label="Messages"
      >
        {msgs.hasNextPage && (
          <div className="text-center pb-2">
            <Button
              variant="secondary"
              size="sm"
              loading={msgs.isFetchingNextPage}
              onClick={() => void msgs.fetchNextPage()}
            >
              Messages précédents
            </Button>
          </div>
        )}

        {msgs.isLoading ? (
          <PageSpinner />
        ) : !ordered.length ? (
          <EmptyState title="Aucun message" text="Envoyez le premier message au contact" />
        ) : (
          ordered.map((m) => {
            const day = dateFr(m.createdAt);
            const sep = day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id}>
                {sep && (
                  <p className="my-3.5 text-center text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {day}
                  </p>
                )}
                <Bubble
                  m={m}
                  who={m.sentBy ? names.get(m.sentBy) ?? 'Équipe' : undefined}
                  onRetry={() => retry.mutate(m.id)}
                  onUnlock={() => void askUnlock(m)}
                  canUnlock={can('inbox.reply')}
                  currency={user.agency?.currency}
                />
              </div>
            );
          })
        )}
      </div>

      {can('inbox.reply') ? (
        <Composer conv={c} currency={user.agency?.currency} />
      ) : (
        <div className="border-t border-line p-3 text-center text-xs text-muted">Lecture seule</div>
      )}
    </div>
  );
}
