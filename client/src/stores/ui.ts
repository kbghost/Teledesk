import { create } from 'zustand';

export type ThemePref = 'light' | 'dark' | 'system';
const read = (): ThemePref => {
  try { return (localStorage.getItem('theme') as ThemePref) || 'light'; } catch { return 'light'; }
};
export const resolveTheme = (p: ThemePref): 'light' | 'dark' => (p === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : p);
function apply(p: ThemePref) { document.documentElement.dataset.theme = resolveTheme(p); }


const readCollapsed = () => { try { return localStorage.getItem('td_sidebar') === 'collapsed'; } catch { return false; } };
interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string }
interface UiState {
  /** Barre latérale du bureau : réduite (icônes seules) ou complète ; le choix est mémorisé. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  toasts: Toast[];
  toast: (kind: Toast['kind'], text: string) => void;
  dismiss: (id: number) => void;
}
let seq = 0;
export const useUi = create<UiState>((set, get) => ({
  sidebarCollapsed: readCollapsed(),
  toggleSidebar: () => {
    const v = !get().sidebarCollapsed;
    try { localStorage.setItem('td_sidebar', v ? 'collapsed' : 'open'); } catch { /* non mémorisé */ }
    set({ sidebarCollapsed: v });
  },
  theme: read(),
  setTheme: (t) => {
    try { localStorage.setItem('theme', t); } catch { /* stockage indisponible : le thème reste valable pour la session */ }
    apply(t);
    set({ theme: t });
  },
  toasts: [],
  toast: (kind, text) => {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-3), { id, kind, text }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
export const toast = {
  success: (t: string) => useUi.getState().toast('success', t),
  error: (t: string) => useUi.getState().toast('error', t),
  info: (t: string) => useUi.getState().toast('info', t),
};
// Suit le thème système tant que l'utilisateur n'a pas choisi explicitement.
if (typeof matchMedia !== 'undefined') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (useUi.getState().theme === 'system') apply('system'); });
}
