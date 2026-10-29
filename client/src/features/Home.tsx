import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, useCan } from '../stores/auth';

const AdminOverview = lazy(() => import('./admin/AdminOverview'));
const Dashboard = lazy(() => import('./dashboard/Dashboard'));

/** Première page selon le rôle : console plateforme, tableau de bord de l'agence, ou directement les messages pour un chatter. */
export default function Home() {
  const user = useAuth((s) => s.user)!;
  const can = useCan();
  if (user.platform) return <AdminOverview />;
  if (can('analytics.team')) return <Dashboard />;
  if (can('inbox.reply') || can('inbox.supervise')) return <Navigate to="/app/messages" replace />;
  return <Navigate to="/app/library" replace />;
}
