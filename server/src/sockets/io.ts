import type { Server } from 'socket.io';

/** Point d'accès unique au serveur Socket.IO pour les services (évite les imports circulaires). */
let io: Server | undefined;
export const setIo = (server: Server | undefined) => { io = server; };
export const getIo = () => io;

/** Diffuse un évènement identique à des utilisateurs précis (chacun est dans sa salle privée `user:{id}`). */
export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  if (!io) return;
  for (const id of new Set(userIds)) io.to(`user:${id}`).emit(event, payload);
}
/** Variante où le contenu est construit PAR destinataire : il peut dépendre de ses droits (URLs de médias signées pour lui). */
export function emitToEach(userIds: string[], event: string, build: (userId: string) => unknown) {
  if (!io) return;
  for (const id of new Set(userIds)) io.to(`user:${id}`).emit(event, build(id));
}
/** Coupe toutes les connexions temps réel d'un utilisateur (suspension, retrait de l'équipe). */
export function disconnectUser(userId: string) {
  io?.in(`user:${userId}`).disconnectSockets(true);
}
