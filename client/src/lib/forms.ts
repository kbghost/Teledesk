import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, errMsg } from '../api/http';

/** Reporte les erreurs de validation du serveur (zod.flatten) sur les champs ; renvoie un message global sinon. */
export function applyServerErrors<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>): string | undefined {
  if (e instanceof ApiError && e.details?.fieldErrors && Object.keys(e.details.fieldErrors).length) {
    for (const [k, v] of Object.entries(e.details.fieldErrors)) setError(k as Path<T>, { message: v[0] });
    return undefined;
  }
  return errMsg(e);
}
/** N'autorise que les redirections internes (anti open-redirect). */
export const safeNext = (n: string | null | undefined, fallback = '/') => (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : fallback);
