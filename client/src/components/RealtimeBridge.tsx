import { useEffect } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { connectSocket, disconnectSocket, getSocket } from '../services/socket';
import { useAuth } from '../stores/auth';
import { getActiveAgency } from '../stores/agency';
import type { Message, Page } from '../types/api';

type Msgs = InfiniteData<Page<Message>>;

/** Relie les évènements temps réel du serveur aux caches de requêtes : l'inbox se met à jour sans recharger. */
export function RealtimeBridge() {
  const qc = useQueryClient();
  const status = useAuth((s) => s.status);
  useEffect(() => {
    if (status !== 'authed') { disconnectSocket(); return; }
    const s = getSocket();
    const putMessage = (m: Message) => {
      qc.setQueryData<Msgs>(['messages', m.conversationId], (old) => {
        if (!old) return old;
        const exists = old.pages.some((p) => p.items.some((x) => x.id === m.id));
        if (exists) return { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === m.id ? m : x)) })) };
        const [first, ...rest] = old.pages;
        return { ...old, pages: [{ ...first!, items: [m, ...first!.items] }, ...rest] };
      });
    };
    // un chef d'agence possédant plusieurs agences reçoit les évènements de toutes ; on ignore ceux d'une autre agence que l'agence affichée
    const other = (c: { agencyId?: string }) => { const me = useAuth.getState().user?.agencyId; return !!c.agencyId && !!me && c.agencyId !== me; };
    void getActiveAgency;
    const onMsg = (p: { conversation: { id: string; agencyId?: string }; message: Message }) => {
      if (other(p.conversation)) return;
      putMessage(p.message);
      qc.setQueryData(['conversation', p.conversation.id], p.conversation);
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    };
    const onConv = (c: { id: string; agencyId?: string }) => { if (other(c)) return; qc.setQueryData(['conversation', c.id], c); void qc.invalidateQueries({ queryKey: ['conversations'] }); };
    s.on('message:new', onMsg);
    s.on('message:updated', onMsg);
    s.on('conversation:updated', onConv as never);
    s.on('conversation:removed', (p) => { qc.removeQueries({ queryKey: ['conversation', p.id] }); void qc.invalidateQueries({ queryKey: ['conversations'] }); });
    s.on('note:new', (n) => void qc.invalidateQueries({ queryKey: ['notes', n.conversationId] }));
    s.on('note:removed', (n) => void qc.invalidateQueries({ queryKey: ['notes', n.conversationId] }));
    s.on('inbox:refresh', () => { void qc.invalidateQueries({ queryKey: ['conversations'] }); void qc.invalidateQueries({ queryKey: ['conversation'] }); });
    s.on('presence:update', () => void qc.invalidateQueries({ queryKey: ['team'] }));
    connectSocket();
    return () => { s.removeAllListeners('message:new'); s.removeAllListeners('message:updated'); s.removeAllListeners('conversation:updated'); s.removeAllListeners('conversation:removed'); s.removeAllListeners('note:new'); s.removeAllListeners('note:removed'); s.removeAllListeners('inbox:refresh'); s.removeAllListeners('presence:update'); };
  }, [status, qc]);
  return null;
}
