import clsx, { type ClassValue } from 'clsx';

export const cn = (...v: ClassValue[]) => clsx(v);

const nf = new Intl.NumberFormat('fr-FR');
export const num = (n: number) => nf.format(n).replace(/[\u202f\u00a0]/g, ' ');
export const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.0', '')} M` : n >= 10_000 ? `${Math.round(n / 1000)} k` : num(n));
/** Montants stockés en centimes. */
export const money = (cents: number, currency = 'EUR') => new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100).replace(/[\u202f\u00a0]/g, ' ');
/** Durée lisible (ms → « 3 min 20 s »). */
export function duration(ms: number | null | undefined) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`;
  return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
}
export const pct = (r: number | null | undefined) => (r == null ? '—' : `${Math.round(r * 100)} %`);
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
export function relTime(iso?: string | null) {
  if (!iso) return '';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "à l'instant";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const dateFr = (iso?: string | null, withTime = false) =>
  iso ? new Date(iso).toLocaleString('fr-FR', withTime ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const timeFr = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
export const initials = (name: string) => name.replace(/\([^)]*\)/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
