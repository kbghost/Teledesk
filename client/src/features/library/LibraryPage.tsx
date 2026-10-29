import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { accountsApi, libraryApi } from '../../api';
import { errMsg } from '../../api/http';
import { flat, nextOf } from '../../hooks/useList';
import { useDebounce } from '../../hooks/useDebounce';
import { useSeo } from '../../hooks/useSeo';
import { toast } from '../../stores/ui';
import { useAuth, useCan } from '../../stores/auth';
import { Button, EmptyState, Input, ListSkeleton, Modal, PageHeader, Select, useConfirm } from '../../components/ui';
import { LoadMore } from '../../components/LoadMore';
import { AssetThumb } from '../inbox/AssetPicker';
import { cn, money } from '../../utils/format';
import { Icons } from '../../components/icons';
import type { Asset } from '../../types/api';

export default function LibraryPage() {
  useSeo({ title: 'Médiathèque', noindex: true });
  const qc = useQueryClient();
  const can = useCan();
  const confirm = useConfirm();
  const user = useAuth((s) => s.user)!;
  const cur = user.agency?.currency;
  const [folder, setFolder] = useState<string>('all');
  const [account, setAccount] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 250);
  const [edit, setEdit] = useState<Asset | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const folders = useQuery({ queryKey: ['folders'], queryFn: libraryApi.folders });
  const accounts = useQuery({
    queryKey: ['accounts', 'lib'],
    queryFn: () => (user.role === 'MODEL' ? accountsApi.mine() : accountsApi.list()),
  });
  const list = useInfiniteQuery({
    queryKey: ['assets', 'lib', folder, account, dq],
    queryFn: ({ pageParam }) =>
      libraryApi.assets({
        folderId: folder === 'all' ? undefined : folder,
        accountId: account || undefined,
        q: dq || undefined,
        cursor: pageParam,
        limit: 40,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextOf,
  });

  const items = flat(list.data);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['assets'] });
    void qc.invalidateQueries({ queryKey: ['folders'] });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      const form = new FormData();
      if (account) form.set('accountId', account);
      if (folder !== 'all') form.set('folderId', folder);
      form.set('file', f);
      try {
        setProgress(0);
        await libraryApi.upload(form, setProgress);
        toast.success(`« ${f.name} » ajouté`);
      } catch (e) {
        toast.error(`${f.name} : ${errMsg(e)}`);
      }
    }
    setProgress(null);
    refresh();
    if (file.current) file.current.value = '';
  };

  const newFolder = async () => {
    const name = window.prompt('Nom du nouveau dossier');
    if (!name?.trim()) return;
    try {
      await libraryApi.createFolder({ name: name.trim(), accountId: account || null });
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const del = async (a: Asset) => {
    if (
      !(await confirm({
        title: `Supprimer « ${a.name} » ?`,
        text: 'Les messages déjà envoyés restent dans les conversations.',
        confirmLabel: 'Supprimer',
        danger: true,
      }))
    )
      return;
    try {
      await libraryApi.remove(a.id);
      setEdit(null);
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const upMut = useMutation({
    mutationFn: (b: { name: string; price: string; folderId: string }) =>
      libraryApi.patch(edit!.id, {
        name: b.name,
        priceCents: Math.round(Number(b.price.replace(',', '.')) * 100) || 0,
        folderId: b.folderId || null,
      }),
    onSuccess: () => {
      setEdit(null);
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const [form, setForm] = useState({ name: '', price: '', folderId: '' });
  const open = (a: Asset) => {
    setEdit(a);
    setForm({ name: a.name, price: String(a.priceCents / 100), folderId: a.folderId ?? '' });
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Médiathèque PPV"
        subtitle="Vos médias prêts à être envoyés en direct. Aperçu flouté généré à la volée avec cadenas sécurisé."
        actions={
          <div className="flex items-center gap-2">
            {can('library.manage') && (
              <Button variant="secondary" icon={<Icons.Folder className="h-4 w-4" />} onClick={newFolder}>
                Nouveau dossier
              </Button>
            )}
            {can('library.upload') && (
              <Button
                icon={<Icons.Upload className="h-4 w-4" />}
                loading={progress !== null}
                onClick={() => file.current?.click()}
              >
                {progress !== null ? `${progress} %` : 'Ajouter un média'}
              </Button>
            )}
            <input
              ref={file}
              type="file"
              multiple
              hidden
              accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,audio/mpeg,audio/mp4,audio/ogg,audio/wav,application/pdf"
              onChange={(e) => void onFiles(e.target.files)}
            />
          </div>
        }
      />

      {user.role === 'MODEL' && (
        <p className="rounded-card border border-line bg-raised px-4 py-3 text-sm text-muted">
          Vous déposez ici les contenus de votre compte. Votre équipe fixe les tarifs et les envoie avec cadenas à vos contacts.
        </p>
      )}

      {/* Barre de recherche et filtres */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <Input aria-label="Rechercher" placeholder="Rechercher un média…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Compte" value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">Tous les comptes</option>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Dossier" value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="all">Tous les dossiers</option>
          <option value="root">Sans dossier</option>
          {(folders.data ?? []).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.assetCount})
            </option>
          ))}
        </Select>
      </div>

      {/* Grille des médias */}
      {list.isLoading ? (
        <ListSkeleton rows={2} height="h-48" />
      ) : !items.length ? (
        <EmptyState
          icon={<Icons.Library className="h-6 w-6" />}
          title="Aucun média trouvé"
          text="Ajoutez photos, vidéos ou audios (50 Mo max). Le cadenas de floutage sera généré automatiquement dès qu'un prix est défini."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((a) => (
            <motion.li
              key={a.id}
              whileHover={{ y: -3 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            >
              <button
                onClick={() => (can('library.manage') ? open(a) : undefined)}
                className={cn(
                  'w-full overflow-hidden rounded-card border border-line bg-surface text-left shadow-xs transition',
                  can('library.manage') && 'hover:border-brand/40 hover:shadow-md cursor-pointer',
                )}
              >
                <div className="relative aspect-[4/5] overflow-hidden bg-bg">
                  <AssetThumb a={a} />
                  {a.priceCents > 0 && (
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-ink/80 px-2.5 py-0.5 text-[11px] font-semibold text-bg backdrop-blur-md shadow-xs">
                      <Icons.Lock className="h-3 w-3 text-gold" aria-hidden />
                      PPV {money(a.priceCents, cur)}
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-xs font-semibold text-ink">{a.name}</p>
                  <p className="text-[11px] text-muted mt-0.5">
                    {a.priceCents ? 'Verrouillé (flouté)' : 'Gratuit'} · {a.usedCount} envoi(s)
                  </p>
                </div>
              </button>
            </motion.li>
          ))}
        </ul>
      )}

      <LoadMore q={list} />

      {/* Modale d'édition */}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Paramètres du média PPV"
        size="sm"
        footer={
          edit && (
            <>
              <Button
                variant="danger"
                icon={<Icons.Trash className="h-4 w-4" />}
                onClick={() => del(edit)}
              >
                Supprimer
              </Button>
              <Button loading={upMut.isPending} onClick={() => upMut.mutate(form)}>
                Enregistrer
              </Button>
            </>
          )
        }
      >
        {edit && (
          <div className="space-y-4">
            <div className="mx-auto aspect-[4/5] w-40 overflow-hidden rounded-xl border border-line shadow-xs">
              <AssetThumb a={edit} />
            </div>
            <Input
              label="Nom du média"
              value={form.name}
              maxLength={100}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              label={`Prix de déblocage PPV (${cur ?? 'EUR'})`}
              inputMode="decimal"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              hint="Si supérieur à 0 : envoyé avec cadenas flouté. Le média original est livré automatiquement au fan dès paiement."
            />
            <Select
              label="Dossier"
              value={form.folderId}
              onChange={(e) => setForm({ ...form, folderId: e.target.value })}
            >
              <option value="">Sans dossier</option>
              {(folders.data ?? [])
                .filter((f) => !f.accountId || f.accountId === edit.accountId)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </Select>
          </div>
        )}
      </Modal>
    </div>
  );
}
