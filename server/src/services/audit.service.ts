import type { Request } from 'express';
import { AuditLog } from '../models';
import { logger } from '../config/logger';
import { getIp } from '../utils/helpers';

export async function audit(req: Request | null, agencyId: string | null, actorId: string | null, action: string, targetType?: string, targetId?: string, metadata: Record<string, unknown> = {}) {
  try {
    await AuditLog.create({
      agencyId: agencyId ?? undefined, actorId: actorId ?? undefined, action, targetType, targetId, metadata,
      ip: req ? getIp(req) : undefined, userAgent: req?.get('user-agent')?.slice(0, 200),
    });
  } catch (err) {
    logger.error({ err }, 'audit failed');
  }
}
