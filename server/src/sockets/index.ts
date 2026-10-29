import type http from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { User } from '../models';
import { agencySupervisorIds } from '../services/access.service';
import { loadActor } from '../middleware';
import { emitToUsers, setIo } from './io';
import { connect, disconnect } from './presence';

/**
 * Temps réel : chaque utilisateur authentifié rejoint UNIQUEMENT sa salle privée `user:{id}`. Les clients ne peuvent rejoindre
 * aucune autre salle : c'est le serveur qui décide qui reçoit quoi (voir services/telegram/audience.ts).
 */
export function initSockets(server: http.Server) {
  const io = new Server(server, { cors: { origin: env.CLIENT_URL, credentials: true }, maxHttpBufferSize: 64 * 1024 });
  setIo(io);

  io.use(async (socket, next) => {
    try {
      const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
      const hint = typeof socket.handshake.auth?.agencyId === 'string' ? socket.handshake.auth.agencyId : undefined;
      const actor = await loadActor(token ? `Bearer ${token}` : undefined, hint);
      if (!actor) return next(new Error('UNAUTHORIZED'));
      socket.data.actor = actor;
      next();
    } catch { next(new Error('UNAUTHORIZED')); }
  });

  /** Les superviseurs voient qui est en ligne. */
  const announce = async (agencyId: string, userId: string, online: boolean) => {
    if (!agencyId) return;
    const sup = await agencySupervisorIds(agencyId);
    const tls = await User.find({ agencyId, agencyRole: 'TEAM_LEADER', status: 'ACTIVE', deletedAt: null }).select('_id').lean();
    emitToUsers([...sup, ...tls.map((u) => String(u._id))], 'presence:update', { userId, online });
  };

  io.on('connection', (socket) => {
    const a = socket.data.actor as { id: string; agencyId: string };
    void socket.join(`user:${a.id}`);
    if (connect(a.id)) void announce(a.agencyId, a.id, true).catch((err) => logger.warn({ err }, 'presence announce failed'));
    socket.on('disconnect', () => {
      if (disconnect(a.id)) {
        void User.updateOne({ _id: a.id }, { $set: { lastSeenAt: new Date() } }).catch(() => undefined);
        void announce(a.agencyId, a.id, false).catch(() => undefined);
      }
    });
  });
  return io;
}
