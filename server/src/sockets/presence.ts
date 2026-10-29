/** Présence en ligne des membres de l'équipe (en mémoire, par serveur). Un membre peut avoir plusieurs onglets ouverts : on compte les connexions. */
const sockets = new Map<string, number>();
export const isOnline = (userId: string) => (sockets.get(userId) ?? 0) > 0;
/** Retourne true si la personne vient de passer en ligne (première connexion). */
export function connect(userId: string): boolean { const n = (sockets.get(userId) ?? 0) + 1; sockets.set(userId, n); return n === 1; }
/** Retourne true si la personne vient de passer hors ligne (dernière connexion fermée). */
export function disconnect(userId: string): boolean {
  const n = (sockets.get(userId) ?? 0) - 1;
  if (n <= 0) { sockets.delete(userId); return true; }
  sockets.set(userId, n);
  return false;
}
export const onlineCount = () => sockets.size;
