import { io, type Socket } from 'socket.io-client';
import { getActiveAgency } from '../stores/agency';
import { getToken, useAuth } from '../stores/auth';
import { refreshSession } from '../api/http';
import type { ClientToServerEvents, ServerToClientEvents } from '../types/api';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
let socket: AppSocket | null = null;

/** Socket unique, authentifié par le jeton lu à chaque (re)connexion ; sur UNAUTHORIZED on rafraîchit puis on retente. */
export function getSocket(): AppSocket {
  if (socket) return socket;
  socket = io('/', { autoConnect: false, transports: ['websocket'], withCredentials: true, auth: (cb) => cb({ token: getToken(), agencyId: getActiveAgency() ?? undefined }) }) as AppSocket;
  socket.on('connect_error', async (err) => {
    if (err.message === 'UNAUTHORIZED' && (await refreshSession())) socket?.connect();
  });
  return socket;
}
export function connectSocket() {
  if (useAuth.getState().status !== 'authed') return;
  const s = getSocket();
  if (!s.connected && !s.active) s.connect();
  else if (!s.connected) s.connect();
}
export function disconnectSocket() { socket?.disconnect(); }
