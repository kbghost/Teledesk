import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { HiOutlineChevronUpDown } from 'react-icons/hi2';
import { agencyApi } from '../api';
import { authApi } from '../api/auth';
import { errMsg } from '../api/http';
import { Menu, menuItem } from '../components/Menu';
import { Button, Input, Modal } from '../components/ui';
import { queryClient } from '../lib/query';
import { disconnectSocket, connectSocket } from '../services/socket';
import { setActiveAgency } from '../stores/agency';
import { useAuth, useCan } from '../stores/auth';
import { toast } from '../stores/ui';
import { cn } from '../utils/format';
import { Icons } from '../components/icons';

/** Sélecteur d'agence du chef d'agence : chaque agence a ses propres comptes, médias, équipe, ventes et retraits. */
export function AgencySwitcher({ compact }: { compact?: boolean }) {
  const user = useAuth((s) => s.user)!;
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const switchTo = async (id: string) => {
    if (id === user.agencyId) return;
    setActiveAgency(id);
    disconnectSocket();
    queryClient.clear();
    try {
      useAuth.getState().setUser((await authApi.me()).user);
    } catch {
      /* la session sera rafraîchie */
    }
    connectSocket();
  };
  const create = useMutation({
    mutationFn: () => agencyApi.create(name.trim()),
    onSuccess: async (a) => {
      setCreating(false);
      setName('');
      toast.success(`Agence « ${a.name} » créée`);
      await switchTo(a.id);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const list = user.agencies;
  if (!user.agency) return null;
  const canCreate = can('agency.create');
  return (
    <>
      <Menu
        label="Changer d’agence"
        align="left"
        trigger={({ toggle }) => (
          <button
            onClick={toggle}
            aria-haspopup="menu"
            title={user.agency!.name}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-ctl border border-line bg-raised/70 px-2.5 py-2 text-left transition hover:border-brand/40',
              compact && 'justify-center px-0',
            )}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
              <Icons.Agencies className="h-4 w-4" aria-hidden />
            </span>
            {!compact && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-ink">{user.agency!.name}</span>
                  <span className="block text-[10px] text-muted leading-tight">
                    {list.length > 1 ? `${list.length} agences` : 'Mon agence'}
                  </span>
                </span>
                <HiOutlineChevronUpDown className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              </>
            )}
          </button>
        )}
      >
        {(close) => (
          <>
            {list.map((a) => (
              <button
                key={a.id}
                role="menuitem"
                className={menuItem}
                onClick={() => {
                  close();
                  void switchTo(a.id);
                }}
              >
                <Icons.Check
                  className={cn('h-4 w-4', a.id === user.agencyId ? 'text-brand' : 'opacity-0')}
                  aria-hidden
                />
                <span className="truncate text-xs font-medium">{a.name}</span>
                {a.status === 'BANNED' && <span className="ml-auto text-[10px] text-danger">suspendue</span>}
              </button>
            ))}
            {canCreate && (
              <button
                role="menuitem"
                className={cn(menuItem, 'border-t border-line text-brand font-semibold')}
                onClick={() => {
                  close();
                  setCreating(true);
                }}
              >
                <Icons.Plus className="h-4 w-4" aria-hidden />
                Nouvelle agence
              </button>
            )}
          </>
        )}
      </Menu>
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Créer une agence"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button loading={create.isPending} disabled={name.trim().length < 2} onClick={() => create.mutate()}>
              Créer l’agence
            </Button>
          </>
        }
      >
        <Input
          label="Nom de l’agence"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          hint="Chaque agence a ses propres modèles (comptes Telegram), médias, équipe et portefeuille."
        />
      </Modal>
    </>
  );
}
