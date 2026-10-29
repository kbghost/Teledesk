/**
 * Horloge applicative injectable. En production c'est l'heure réelle ; les tests et le seed la remplacent pour
 * simuler le passage du temps (fenêtre de réponse de 24 h, historique de ventes) sans attendre ni tricher sur les règles.
 */
let source: () => number = () => Date.now();
export const now = () => source();
export const nowDate = () => new Date(source());
export const setClock = (fn?: () => number) => { source = fn ?? (() => Date.now()); };
