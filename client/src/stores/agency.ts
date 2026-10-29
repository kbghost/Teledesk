/** Agence active d'un chef d'agence possédant plusieurs agences : envoyée au serveur dans l'en-tête x-agency-id (le serveur re-vérifie qu'elle lui appartient). */
const KEY = 'td_agency';
export const getActiveAgency = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setActiveAgency = (id: string | null) => { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* stockage indisponible */ } };
