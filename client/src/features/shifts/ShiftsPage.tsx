import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountsApi, opsApi, teamApi } from '../../api';
import { Icons } from '../../components/icons';

import { errMsg } from '../../api/http';
import { useSeo } from '../../hooks/useSeo';
import { toast } from '../../stores/ui';
import { useCan } from '../../stores/auth';
import { Button, Card, EmptyState, IconButton, Input, ListSkeleton, Modal, PageHeader, Select } from '../../components/ui';
import { cn, dateFr, timeFr } from '../../utils/format';

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function ShiftsPage() {
  useSeo({ title: 'Shifts', noindex: true });
  const qc = useQueryClient();
  const can = useCan();
  const manage = can('shifts.manage');
  const from = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const q = useQuery({ queryKey: ['shifts'], queryFn: () => opsApi.shifts({ from: from.toISOString(), to: new Date(from.getTime() + 14 * 864e5).toISOString() }) });
  const team = useQuery({ queryKey: ['assignable'], queryFn: teamApi.assignable, enabled: manage });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list, enabled: manage });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ userId: '', accountId: '', start: localInput(new Date(Date.now() + 3600_000)), hours: '6' });
  const create = useMutation({
    mutationFn: () => { const s = new Date(f.start); return opsApi.createShift({ userId: f.userId, accountId: f.accountId, startsAt: s.toISOString(), endsAt: new Date(s.getTime() + Number(f.hours) * 3600_000).toISOString() }); },
    onSuccess: () => { setOpen(false); void qc.invalidateQueries({ queryKey: ['shifts'] }); toast.success('Shift créé'); }, onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({ mutationFn: opsApi.deleteShift, onSuccess: () => qc.invalidateQueries({ queryKey: ['shifts'] }), onError: (e) => toast.error(errMsg(e)) });
  const byDay = useMemo(() => { const m = new Map<string, NonNullable<typeof q.data>>(); for (const s of q.data ?? []) { const k = dateFr(s.startsAt); m.set(k, [...(m.get(k) ?? []), s]); } return [...m.entries()]; }, [q.data]);
  const operators = (team.data ?? []).filter((m) => m.role === 'CHATTER' || m.role === 'TEAM_LEADER');
  const chosen = operators.find((m) => m.id === f.userId);
  const accOpts = (accounts.data ?? []).filter((a) => !chosen || chosen.accountIds.includes(a.id));
  const valid = f.userId && f.accountId && Number(f.hours) > 0 && Number(f.hours) <= 24;
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader title="Shifts" subtitle={manage ? 'Planning des 14 prochains jours. Les ventes enregistrées pendant un shift lui sont rattachées.' : 'Vos prochains shifts.'} actions={manage ? <Button icon={<Icons.Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Nouveau shift</Button> : undefined} />
      {q.isLoading ? <ListSkeleton rows={4} height="h-14" /> : !byDay.length ? <EmptyState title="Aucun shift planifié" text={manage ? 'Créez des créneaux pour suivre les ventes par shift.' : undefined} /> : (
        <div className="space-y-4">{byDay.map(([day, list]) => (
          <section key={day}><h2 className="mb-1.5 text-sm font-semibold text-muted">{day}</h2>
            <Card className="divide-y divide-line">{list.map((s) => {
              const live = new Date(s.startsAt).getTime() <= Date.now() && new Date(s.endsAt).getTime() >= Date.now();
              return <div key={s.id} className={cn('flex items-center gap-3 px-4 py-3', live && 'bg-ok/5')}>
                <div className="min-w-0 flex-1"><p className="font-medium">{s.userName} <span className="text-muted">· {s.accountLabel}</span></p><p className="text-sm text-muted">{timeFr(s.startsAt)} – {timeFr(s.endsAt)}{live && <span className="ml-2 font-semibold text-ok">en cours</span>}</p></div>
                {manage && <IconButton label="Supprimer le shift" onClick={() => del.mutate(s.id)}><Icons.Trash className="h-4 w-4" /></IconButton>}
              </div>; })}</Card></section>))}</div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau shift" size="sm" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Annuler</Button><Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>Créer</Button></>}>
        <div className="space-y-3">
          <Select label="Opérateur" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value, accountId: '' })}><option value="">Choisir…</option>{operators.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</Select>
          <Select label="Compte Telegram" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">Choisir…</option>{accOpts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select>
          <Input label="Début" type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
          <Input label="Durée (heures, 24 max)" type="number" min={1} max={24} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
