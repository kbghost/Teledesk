import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icons } from './icons';
import { cn } from '../utils/format';
import { Card } from './ui';

export interface Pt { label: string; value: number }
const niceMax = (v: number) => {
  if (v <= 0) return 4;
  const e = 10 ** Math.floor(Math.log10(v));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
};
const tick = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)} k` : String(+n.toFixed(1)));
export const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

function useWidth(ref: React.RefObject<HTMLElement>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

interface PlotProps { data: Pt[]; kind: 'area' | 'bar'; format: (n: number) => string; height?: number; name: string }
/** Série unique : pas de légende (le titre nomme la série). Marques fines, grille en filet, survol + clavier, valeur en tête du tooltip. */
function Plot({ data, kind, format, height = 220, name }: PlotProps) {
  const host = useRef<HTMLDivElement>(null);
  const w = useWidth(host);
  const [hi, setHi] = useState<number | null>(null);
  const m = { t: 14, r: 14, b: 26, l: 42 };
  const iw = Math.max(w - m.l - m.r, 10), ih = height - m.t - m.b, n = data.length;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const y = (v: number) => ih - (v / max) * ih;
  const band = iw / Math.max(n, 1);
  const x = (i: number) => (kind === 'bar' ? (i + 0.5) * band : n < 2 ? iw / 2 : (i * iw) / (n - 1));
  const idxAt = (clientX: number) => {
    const r = host.current!.getBoundingClientRect();
    const px = clientX - r.left - m.l;
    return Math.min(n - 1, Math.max(0, kind === 'bar' ? Math.floor(px / band) : Math.round((px / iw) * (n - 1))));
  };
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join('');
  const bw = Math.min(24, Math.max(band - 4, 2));
  const xl = n < 3 ? data.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const ticks = [0, max / 2, max];
  const cur = hi != null ? data[hi] : null;
  const tipLeft = hi != null ? Math.min(Math.max(m.l + x(hi), 60), Math.max(w - 60, 60)) : 0;

  return (
    <div ref={host} className="relative select-none" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={`Graphique : ${name}`} tabIndex={0}
          onPointerMove={(e) => setHi(idxAt(e.clientX))} onPointerLeave={() => setHi(null)} onBlur={() => setHi(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); setHi((h) => Math.min(n - 1, (h ?? -1) + 1)); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); setHi((h) => Math.max(0, (h ?? n) - 1)); }
            if (e.key === 'Escape') setHi(null);
          }} className="touch-pan-y rounded-ctl">
          <g transform={`translate(${m.l},${m.t})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke="rgb(var(--line))" strokeWidth={1} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="rgb(var(--muted))">{tick(t)}</text>
              </g>
            ))}
            {xl.map((i, k) => (
              <text key={i} x={x(i)} y={ih + 18} fontSize={11} fill="rgb(var(--muted))" textAnchor={k === 0 && n > 2 ? 'start' : k === xl.length - 1 && n > 2 ? 'end' : 'middle'}>{data[i]!.label}</text>
            ))}
            {kind === 'area' && n > 0 && (
              <>
                <path d={`${line}L${x(n - 1)},${ih}L${x(0)},${ih}Z`} fill="rgb(var(--brand))" opacity={0.1} />
                <path d={line} fill="none" stroke="rgb(var(--brand))" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={x(n - 1)} cy={y(data[n - 1]!.value)} r={4} fill="rgb(var(--brand))" stroke="rgb(var(--surface))" strokeWidth={2} />
              </>
            )}
            {kind === 'bar' && data.map((d, i) => {
              const h = Math.max((d.value / max) * ih, d.value > 0 ? 2 : 0), r = Math.min(4, bw / 2, h);
              const bx = x(i) - bw / 2, by = ih - h;
              return h > 0 ? <path key={i} d={`M${bx},${ih}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + bw - r}Q${bx + bw},${by} ${bx + bw},${by + r}V${ih}Z`} fill="rgb(var(--brand))" opacity={hi == null || hi === i ? 1 : 0.55} /> : null;
            })}
            {hi != null && (
              <>
                {kind === 'area' && <line x1={x(hi)} x2={x(hi)} y1={0} y2={ih} stroke="rgb(var(--muted))" strokeWidth={1} opacity={0.5} />}
                {kind === 'area' && <circle cx={x(hi)} cy={y(data[hi]!.value)} r={5} fill="rgb(var(--brand))" stroke="rgb(var(--surface))" strokeWidth={2} />}
              </>
            )}
          </g>
        </svg>
      )}
      {cur && (
        <div role="status" className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-ctl border border-line bg-surface px-2.5 py-1.5 shadow-pop" style={{ left: tipLeft }}>
          <p className="flex items-center gap-1.5 font-display text-sm font-bold tabular-nums"><span className="h-0.5 w-3 rounded bg-brand" aria-hidden />{format(cur.value)}</p>
          <p className="text-xs text-muted">{cur.label}</p>
        </div>
      )}
    </div>
  );
}

/** Carte de graphique : titre, chiffre clé, vue graphique ↔ tableau (accès sans survol), cadre conservé pendant le rechargement. */
export function ChartCard({ title, headline, hint, data, kind = 'area', format, loading, height, className, children }: {
  title: string; headline?: ReactNode; hint?: string; data: Pt[]; kind?: 'area' | 'bar'; format: (n: number) => string; loading?: boolean; height?: number; className?: string; children?: ReactNode;
}) {
  const [table, setTable] = useState(false);
  const empty = data.every((d) => d.value === 0);
  return (
    <Card className={cn('p-4 sm:p-5', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-muted">{title}</h3>
          {headline != null && <p className="mt-0.5 font-display text-2xl font-bold tabular-nums">{headline}</p>}
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        <button onClick={() => setTable((t) => !t)} aria-pressed={table} aria-label={table ? 'Afficher le graphique' : 'Afficher le tableau'} className="rounded-ctl p-2 text-muted hover:bg-ink/5 hover:text-ink">
          {table ? <Icons.BarChart className="h-4 w-4" /> : <Icons.Table className="h-4 w-4" />}
        </button>
      </div>
      <div className={cn('transition-opacity', loading && 'opacity-50')}>
        {table ? (
          <div className="max-h-56 overflow-auto rounded-ctl border border-line">
            <table className="w-full text-sm">
              <caption className="sr-only">{title}</caption>
              <thead className="sticky top-0 bg-raised text-left text-xs text-muted"><tr><th className="px-3 py-1.5 font-medium">Date</th><th className="px-3 py-1.5 text-right font-medium">Valeur</th></tr></thead>
              <tbody>{data.map((d, i) => <tr key={i} className="border-t border-line"><td className="px-3 py-1.5">{d.label}</td><td className="px-3 py-1.5 text-right tabular-nums">{format(d.value)}</td></tr>)}</tbody>
            </table>
          </div>
        ) : (
          <div className="relative">
            <Plot data={data} kind={kind} format={format} name={title} height={height} />
            {empty && !loading && <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-muted">Pas encore de données sur la période</p>}
          </div>
        )}
      </div>
      {children}
    </Card>
  );
}
