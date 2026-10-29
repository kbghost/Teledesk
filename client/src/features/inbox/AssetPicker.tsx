import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FiImage, FiVideo, FiMusic, FiFileText, FiMessageSquare } from 'react-icons/fi';
import { inboxApi, libraryApi } from '../../api';
import { flat, nextOf } from '../../hooks/useList';
import { useDebounce } from '../../hooks/useDebounce';
import { Input, Modal, EmptyState, ListSkeleton, Segmented } from '../../components/ui';
import { LoadMore } from '../../components/LoadMore';
import { money } from '../../utils/format';
import type { Asset } from '../../types/api';

type Tab = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'SCRIPTS';
const TABS: { value: Tab; label: string }[] = [
  { value: 'IMAGE', label: 'Images' },
  { value: 'VIDEO', label: 'Vidéos' },
  { value: 'AUDIO', label: 'Audio' },
  { value: 'SCRIPTS', label: 'Scripts' },
];

export function AssetThumb({ a, className = 'h-full w-full' }: { a: Asset; className?: string }) {
  if (a.thumbUrl) return <img src={a.thumbUrl} alt={a.name} loading="lazy" className={`${className} object-cover`} />;
  const Icon = a.kind === 'VIDEO' ? FiVideo : a.kind === 'AUDIO' ? FiMusic : FiFileText;
  return (
    <div className={`${className} flex items-center justify-center bg-raised text-muted`}>
      <Icon className="h-8 w-8" />
    </div>
  );
}

/** Partage : onglets Images / Vidéos / Audio (médiathèque du compte) et Scripts (messages pré-faits). */
export function AssetPicker({
  open,
  onClose,
  accountId,
  currency,
  onPick,
  onScript,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  currency?: string;
  onPick: (a: Asset) => void;
  onScript: (text: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('IMAGE');
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 250);
  const scripts = tab === 'SCRIPTS';
  const list = useInfiniteQuery({
    queryKey: ['assets', 'picker', accountId, tab, dq],
    enabled: open && !scripts,
    queryFn: ({ pageParam }) =>
      libraryApi.assets({ accountId, kind: tab as 'IMAGE', q: dq || undefined, cursor: pageParam, limit: 24 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextOf,
    staleTime: 60_000,
  });
  const quick = useQuery({ queryKey: ['quick-replies'], queryFn: inboxApi.quickReplies, enabled: open && scripts, staleTime: 60_000 });
  const items = flat(list.data);
  const scriptRows = (quick.data ?? []).filter(
    (r) => !dq || `${r.title} ${r.text} ${r.shortcut}`.toLowerCase().includes(dq.toLowerCase()),
  );
  const Icon = tab === 'IMAGE' ? FiImage : tab === 'VIDEO' ? FiVideo : FiMusic;

  return (
    <Modal open={open} onClose={onClose} title="Partager dans la conversation" size="lg">
      <div className="space-y-3">
        <Segmented label="Type de contenu" value={tab} onChange={setTab} options={TABS} />
        <Input
          aria-label="Rechercher"
          placeholder={scripts ? 'Rechercher un script…' : 'Nom ou étiquette…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="mt-4">
        {scripts ? (
          quick.isLoading ? (
            <ListSkeleton rows={3} height="h-16" />
          ) : !scriptRows.length ? (
            <EmptyState
              icon={<FiMessageSquare className="h-6 w-6" />}
              title="Aucun script"
              text="Créez vos messages pré-faits dans Paramètres › Scripts (chef d’agence, sous-chef ou team leader)."
            />
          ) : (
            <ul className="space-y-2">
              {scriptRows.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => onScript(r.text)}
                    className="w-full rounded-card border border-line bg-surface p-3 text-left transition hover:border-brand/40 hover:bg-raised"
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                      {r.title}
                      <span className="font-mono text-xs font-normal text-brand">/{r.shortcut}</span>
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{r.text}</p>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : list.isLoading ? (
          <ListSkeleton rows={2} height="h-32" />
        ) : !items.length ? (
          <EmptyState
            icon={<Icon className="h-6 w-6" />}
            title={`Aucun${tab === 'IMAGE' ? 'e image' : tab === 'VIDEO' ? 'e vidéo' : ' audio'}`}
            text="Ajoutez des fichiers dans la médiathèque (chef d’agence, sous-chef, team leader ou modèle)."
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => onPick(a)}
                  className="group w-full overflow-hidden rounded-card border border-line bg-surface text-left transition hover:border-brand/40 hover:shadow-md"
                >
                  <div className="aspect-[4/5] overflow-hidden bg-bg">
                    <AssetThumb a={a} />
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-xs font-semibold text-ink">{a.name}</p>
                    <p className="text-[11px] text-muted mt-0.5">
                      {a.priceCents ? `🔒 ${money(a.priceCents, currency)} (flouté)` : 'Gratuit'} · envoyé {a.usedCount}×
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
