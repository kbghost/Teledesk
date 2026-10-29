import { create } from 'zustand';
import type { Permission } from '@teledesk/shared';
import type { Me } from '../types/api';

type Status = 'loading' | 'authed' | 'anon';
interface AuthState {
  /** Le jeton d'accès reste en mémoire uniquement (jamais en localStorage) ; le refresh est un cookie HttpOnly. */
  accessToken: string | null;
  user: Me | null;
  status: Status;
  setSession: (accessToken: string, user: Me) => void;
  setUser: (user: Me) => void;
  clear: () => void;
}
export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  status: 'loading',
  setSession: (accessToken, user) => set({ accessToken, user, status: 'authed' }),
  setUser: (user) => set({ user }),
  clear: () => set({ accessToken: null, user: null, status: 'anon' }),
}));
export const getToken = () => useAuth.getState().accessToken;
/** Permissions effectives calculées par le serveur (rôle + ajouts/retraits propres à chaque membre) : l'interface ne montre que ce que l'API acceptera. L'API revérifie toujours. */
export const useCan = () => {
  const perms = useAuth((s) => s.user?.permissions);
  return (p: Permission) => !!perms?.includes(p);
};
