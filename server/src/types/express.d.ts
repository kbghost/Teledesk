import type { ActorRole } from '@teledesk/shared';

export interface Actor {
  id: string;
  agencyId: string;
  role: ActorRole;
  /** Permissions ajoutées / retirées par rapport au rôle. */
  grant: string[];
  revoke: string[];
  /** Agences possédées (chef d'agence). */
  ownedAgencyIds: string[];
  platform: boolean;
  /** Comptes Telegram accessibles (le Super admin accède à tous les comptes de l'agence, voir access.service). */
  accountIds: string[];
  displayName: string;
  sessionId?: string;
}
declare global {
  namespace Express {
    interface Request {
      user?: Actor;
      rawBody?: Buffer;
    }
  }
}
