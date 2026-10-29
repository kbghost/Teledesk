export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details);
export const unauthorized = (msg = 'Authentification requise', code = 'UNAUTHORIZED') => new AppError(401, code, msg);
export const forbidden = (msg = 'Accès refusé', code = 'FORBIDDEN') => new AppError(403, code, msg);
export const notFound = (msg = 'Ressource introuvable', code = 'NOT_FOUND') => new AppError(404, code, msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
export const tooMany = (msg = 'Trop de requêtes') => new AppError(429, 'RATE_LIMITED', msg);
