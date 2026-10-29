import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inboxApi, opsApi } from '../../api';
import { errMsg } from '../../api/http';
import { toast } from '../../stores/ui';
import { useAuth, useCan } from '../../stores/auth';
import { Avatar, Button, Input, Modal, Textarea, IconButton, Badge } from '../../components/ui';
import { useConfirm } from '../../components/ui';
import { cn, dateFr, money, relTime } from '../../utils/format';
import { Icons } from '../../components/icons';

export function SidePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user)!;
  const can = useCan();
  const confirm = useConfirm();
  const cur = user.agency?.currency;
  const conv = useQuery({ queryKey: ['conversation', id], queryFn: () => inboxApi.conversation(id) });
  const tags = useQuery({ queryKey: ['tags'], queryFn: inboxApi.tags });
  const notes = useQuery({ queryKey: ['notes', id], queryFn: () => inboxApi.notes(id), enabled: can('notes.write') || can('inbox.supervise') });
  const [note, setNote] = useState('');
  const [saleOpen, setSaleOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [saleNote, setSaleNote] = useState('');
  const c = conv.data;
  const setTags = useMutation({
    mutationFn: (tagIds: string[]) => inboxApi.patch(id, { tagIds }),
    onSuccess: (r) => { qc.setQueryData(['conversation', id], r); void qc.invalidateQueries({ queryKey: ['conversations'] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const addNote = useMutation({ mutationFn: () => inboxApi.addNote(id, note.trim()), onSuccess: () => { setNote(''); void qc.invalidateQueries({ queryKey: ['notes', id] }); }, onError: (e) => toast.error(errMsg(e)) });
  const delNote = useMutation({ mutationFn: inboxApi.deleteNote, onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', id] }), onError: (e) => toast.error(errMsg(e)) });
  const sale = useMutation({
    mutationFn: () => inboxApi.sale(id, { amountCents: Math.round(Number(amount.replace(',', '.')) * 100), note: saleNote.trim() || undefined }),
    onSuccess: () => { toast.success('Vente enregistrée'); setSaleOpen(false); setAmount(''); setSaleNote(''); void qc.invalidateQueries({ queryKey: ['conversation', id] }); void qc.invalidateQueries({ queryKey: ['sales'] }); void qc.invalidateQueries({ queryKey: ['analytics'] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const erase = async () => {
    if (!(await confirm({ title: 'Effacer ce contact ?', text: 'La conversation, ses messages et ses notes seront supprimés définitivement (droit à l’effacement). Les ventes restent dans les statistiques.', confirmLabel: 'Effacer', danger: true }))) return;
    try { await inboxApi.erase(id); toast.success('Contact effacé'); void qc.invalidateQueries({ queryKey: ['conversations'] }); onClose(); } catch (e) { toast.error(errMsg(e)); }
  };
  const salesQ = useQuery({ queryKey: ['sales', 'conv', id], queryFn: () => opsApi.sales({ range: '90d', limit: 100 }), enabled: !!c && c.salesCount > 0 });
  if (!c) return null;
  const sales = (salesQ.data?.items ?? []).filter((s) => s.conversationId === id);
  const valid = Number(amount.replace(',', '.')) > 0;
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="font-display font-semibold">Contact</h2><IconButton label="Fermer" onClick={onClose} className="xl:hidden"><Icons.Close className="h-5 w-5" /></IconButton></div>
      <div className="space-y-5 p-4">
        <div className="flex items-center gap-3"><Avatar name={c.contact.name} size={52} /><div className="min-w-0"><p className="truncate font-display text-lg font-semibold">{c.contact.name}</p>{c.contact.username && <p className="text-sm text-muted">@{c.contact.username}</p>}</div></div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted">Dépensé</dt><dd className="font-display text-lg font-bold text-ok">{money(c.totalSpentCents, cur)}</dd></div>
          <div><dt className="text-muted">Ventes</dt><dd className="font-display text-lg font-bold">{c.salesCount}</dd></div>
          <div><dt className="text-muted">Premier contact</dt><dd>{dateFr(c.firstContactAt)}</dd></div>
          <div><dt className="text-muted">Dernier message</dt><dd>{relTime(c.lastIncomingAt)}</dd></div>
        </dl>
        {can('sales.record') && <Button className="w-full" variant="gold" icon={<Icons.Plus className="h-4 w-4" />} onClick={() => setSaleOpen(true)}>Enregistrer une vente</Button>}

        {sales.length > 0 && <ul className="space-y-1 text-sm">{sales.map((s) => <li key={s.id} className="flex justify-between gap-2"><span className={cn('truncate', s.status === 'VOID' && 'text-muted line-through')}>{s.note || 'Vente'} · {s.recordedByName}</span><span className="tabular-nums">{money(s.amountCents, cur)}</span></li>)}</ul>}
        <section>
          <h3 className="mb-2 text-sm font-semibold">Étiquettes</h3>
          <div className="flex flex-wrap gap-1.5">
            {(tags.data ?? []).map((t) => {
              const on = c.tagIds.includes(t.id);
              return <button key={t.id} disabled={!can('tags.apply') || setTags.isPending} aria-pressed={on} onClick={() => setTags.mutate(on ? c.tagIds.filter((x) => x !== t.id) : [...c.tagIds, t.id])} className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition', on ? 'text-white' : 'text-muted hover:text-ink')} style={on ? { background: t.color, borderColor: t.color } : { borderColor: t.color }}>{t.name}</button>;
            })}
          </div>
        </section>
        {(can('notes.write') || can('inbox.supervise')) && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Notes internes <Badge className="ml-1">équipe seulement</Badge></h3>
            {can('notes.write') && <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }} className="mb-3 space-y-2"><Textarea aria-label="Nouvelle note" rows={2} placeholder="Ex. préfère les packs du week-end…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /><Button type="submit" size="sm" variant="secondary" disabled={!note.trim()} loading={addNote.isPending}>Ajouter la note</Button></form>}
            <ul className="space-y-2">
              {(notes.data ?? []).map((n) => (
                <li key={n.id} className="rounded-ctl bg-raised p-2.5 text-sm">
                  <p className="whitespace-pre-wrap break-words">{n.text}</p>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted"><span>{n.authorName} · {relTime(n.createdAt)}</span>{(n.authorId === user.id || can('inbox.supervise')) && <button aria-label="Supprimer la note" onClick={() => delNote.mutate(n.id)} className="hover:text-danger"><Icons.Trash className="h-3.5 w-3.5" /></button>}</div>

                </li>
              ))}
              {notes.data?.length === 0 && <li className="text-sm text-muted">Aucune note.</li>}
            </ul>
          </section>
        )}
        {can('export.contacts') && <Button variant="ghost" size="sm" className="text-danger" onClick={erase}>Effacer ce contact (RGPD)</Button>}
      </div>
      <Modal open={saleOpen} onClose={() => setSaleOpen(false)} title="Enregistrer une vente" size="sm" footer={<><Button variant="secondary" onClick={() => setSaleOpen(false)}>Annuler</Button><Button disabled={!valid} loading={sale.isPending} onClick={() => sale.mutate()}>Enregistrer</Button></>}>
        <p className="mb-3 text-sm text-muted">Le paiement se fait hors de TeleDesk (lien de paiement, crypto…). Enregistrez ici la vente conclue pour alimenter les métriques.</p>
        <Input label={`Montant (${cur ?? 'EUR'})`} inputMode="decimal" placeholder="25" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        <Input className="mt-3" label="Note (facultatif)" value={saleNote} maxLength={200} onChange={(e) => setSaleNote(e.target.value)} />
      </Modal>
    </div>
  );
}
