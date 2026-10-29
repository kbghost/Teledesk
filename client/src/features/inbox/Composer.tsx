import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CAPTION_MAX, SEND_ERROR_LABELS, TEXT_MAX } from '@teledesk/shared';
import { inboxApi } from '../../api';
import { errMsg } from '../../api/http';
import { toast } from '../../stores/ui';
import { Button, IconButton } from '../../components/ui';
import { AssetPicker, AssetThumb } from './AssetPicker';
import { money } from '../../utils/format';
import { Icons } from '../../components/icons';
import type { Asset, Conversation } from '../../types/api';

export function Composer({ conv, currency }: { conv: Conversation; currency?: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [asset, setAsset] = useState<Asset | null>(null);
  const [picker, setPicker] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const quick = useQuery({ queryKey: ['quick-replies'], queryFn: inboxApi.quickReplies, staleTime: 120_000 });
  const allowed = conv.reply?.allowed ?? false;
  const limit = asset ? CAPTION_MAX : TEXT_MAX;

  const suggestions = useMemo(() => {
    const m = /^\/([a-z0-9_-]*)$/.exec(text);
    return m ? (quick.data ?? []).filter((r) => r.shortcut.startsWith(m[1]!)).slice(0, 5) : [];
  }, [text, quick.data]);

  const send = useMutation({
    mutationFn: () => inboxApi.send(conv.id, { text: text.trim() || undefined, assetId: asset?.id }),
    onSuccess: () => {
      setText('');
      setAsset(null);
      void qc.invalidateQueries({ queryKey: ['messages', conv.id] });
      ta.current?.focus();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const canSend = allowed && (text.trim() || asset) && text.length <= limit && !send.isPending;

  if (conv.status === 'ARCHIVED')
    return (
      <div className="border-t border-line p-3 text-center text-xs text-muted">
        Conversation archivée — désarchivez-la pour répondre.
      </div>
    );

  return (
    <div className="border-t border-line bg-surface p-3 shrink-0">
      {!allowed && (
        <p role="status" className="mb-2 rounded-ctl border border-gold/50 bg-gold/10 px-3 py-2 text-xs">
          {conv.reply?.error ? SEND_ERROR_LABELS[conv.reply.error] : 'Envoi impossible pour le moment'}
        </p>
      )}

      {allowed && conv.reply?.windowEndsAt && conv.channel === 'BUSINESS' && (
        <WindowHint endsAt={conv.reply.windowEndsAt} />
      )}

      {asset && (
        <div className="mb-2 flex items-center gap-3 rounded-ctl border border-line bg-raised/50 p-2">
          <div className="h-12 w-12 overflow-hidden rounded-ctl shrink-0">
            <AssetThumb a={asset} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{asset.name}</p>
            <p className="text-[11px] text-muted">
              {asset.priceCents ? (
                <span className="inline-flex items-center gap-1 font-semibold text-gold">
                  <Icons.Lock className="h-3 w-3" aria-hidden />
                  Verrouillé (aperçu flouté) · {money(asset.priceCents, currency)} — déblocage après paiement
                </span>
              ) : (
                'Gratuit : envoyé en clair'
              )}
            </p>
          </div>
          <IconButton label="Retirer le média" onClick={() => setAsset(null)}>
            <Icons.Close className="h-4 w-4" />
          </IconButton>
        </div>
      )}

      {suggestions.length > 0 && (
        <ul className="mb-2 overflow-hidden rounded-ctl border border-line bg-surface shadow-md" role="listbox" aria-label="Scripts">
          {suggestions.map((r) => (
            <li key={r.id}>
              <button
                role="option"
                aria-selected={false}
                onClick={() => {
                  setText(r.text);
                  ta.current?.focus();
                }}
                className="flex w-full gap-2 px-3 py-2 text-left text-xs hover:bg-ink/5 transition"
              >
                <span className="font-mono text-brand font-semibold">/{r.shortcut}</span>
                <span className="truncate text-muted">{r.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <IconButton
          label="Partager : images, vidéos, audio, scripts"
          disabled={!allowed}
          onClick={() => setPicker(true)}
          className="shrink-0 text-muted hover:text-brand"
        >
          <Icons.Library className="h-5 w-5" />
        </IconButton>

        <textarea
          ref={ta}
          aria-label="Votre message"
          rows={1}
          value={text}
          disabled={!allowed}
          maxLength={limit + 200}
          placeholder={allowed ? 'Écrire un message…' : 'Envoi indisponible'}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) send.mutate();
            }
          }}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-ctl border border-line bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60 transition"
        />

        <Button
          onClick={() => send.mutate()}
          disabled={!canSend}
          loading={send.isPending}
          icon={<Icons.Send className="h-4 w-4" />}
          aria-label="Envoyer"
          className="shrink-0"
        >
          Envoyer
        </Button>
      </div>

      {text.length > limit * 0.9 && (
        <p className="mt-1 text-right text-[11px] text-muted">
          {text.length}/{limit}
        </p>
      )}

      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
        <Icons.Zap className="h-3 w-3 text-gold" aria-hidden />
        Entrée = envoyer · / = scripts · Envoi Telegram officiel chiffré
      </div>

      <AssetPicker
        open={picker}
        onClose={() => setPicker(false)}
        accountId={conv.accountId}
        currency={currency}
        onPick={(a) => {
          setAsset(a);
          setPicker(false);
          ta.current?.focus();
        }}
        onScript={(t) => {
          setText((cur) => (cur ? `${cur}\n${t}` : t));
          setPicker(false);
          ta.current?.focus();
        }}
      />
    </div>
  );
}

function WindowHint({ endsAt }: { endsAt: string }) {
  const ms = new Date(endsAt).getTime() - Date.now();
  const h = Math.max(0, Math.floor(ms / 3_600_000));
  const m = Math.max(0, Math.floor((ms % 3_600_000) / 60_000));
  return (
    <p className={`mb-2 text-xs ${ms < 2 * 3_600_000 ? 'font-semibold text-danger' : 'text-muted'}`}>
      Fenêtre de réponse Telegram : encore {h} h {m} min
    </p>
  );
}
