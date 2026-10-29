import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Permission } from '@teledesk/shared';
import { useAuth, useCan } from '../stores/auth';
import { PageSpinner } from '../components/ui';

const nextParam = (l: { pathname: string; search: string }) => encodeURIComponent(`${l.pathname}${l.search}`);

/** Les gardes ne servent qu'à l'ergonomie : l'autorisation réelle est toujours revérifiée par l'API. */
export function RequireAuth() {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <PageSpinner />;
  if (status === 'anon') return <Navigate to={`/login?next=${nextParam(loc)}`} replace />;
  return <Outlet />;
}
export function RequirePermission({ any }: { any: Permission[] }) {
  const can = useCan();
  return any.some(can) ? <Outlet /> : <Navigate to="/app" replace />;
}
export function GuestOnly() {
  const { status } = useAuth();
  if (status === 'loading') return <PageSpinner />;
  if (status === 'authed') return <Navigate to="/app" replace />;
  return <Outlet />;
}
export function RequirePlatform() {
  const user = useAuth((s) => s.user);
  return user?.platform ? <Outlet /> : <Navigate to="/app" replace />;
}
