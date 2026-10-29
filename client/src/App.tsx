import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { GuestOnly, RequireAuth, RequirePermission, RequirePlatform } from './routes/guards';
import AuthLayout from './layouts/AuthLayout';
import AppShell from './layouts/AppShell';
import { PageSpinner } from './components/ui';
import LoginPage from './features/auth/LoginPage';
import RegisterPage from './features/auth/RegisterPage';
import { ForgotPage, ResetPage, VerifyEmailPage } from './features/auth/RecoveryPages';
import { Privacy, Terms } from './features/legal/Legal';
import NotFound from './features/legal/NotFound';

const Landing = lazy(() => import('./features/landing/Landing'));
const InvitePage = lazy(() => import('./features/auth/InvitePage'));
const Home = lazy(() => import('./features/Home'));
const AdminAgencies = lazy(() => import('./features/admin/AdminAgencies'));
const AdminPayouts = lazy(() => import('./features/admin/AdminPayouts'));
const AdminMessages = lazy(() => import('./features/admin/AdminMessages'));
const WalletPage = lazy(() => import('./features/wallet/WalletPage'));
const InboxPage = lazy(() => import('./features/inbox/InboxPage'));
const LibraryPage = lazy(() => import('./features/library/LibraryPage'));
const AnalyticsPage = lazy(() => import('./features/analytics/AnalyticsPage'));
const SalesPage = lazy(() => import('./features/sales/SalesPage'));
const ShiftsPage = lazy(() => import('./features/shifts/ShiftsPage'));
const AccountsPage = lazy(() => import('./features/accounts/AccountsPage'));
const TeamPage = lazy(() => import('./features/team/TeamPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));

export default function App() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/terms" element={<div className="px-5 py-10"><Terms /></div>} />
        <Route path="/privacy" element={<div className="px-5 py-10"><Privacy /></div>} />
        <Route element={<AuthLayout />}>
          <Route element={<GuestOnly />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPage />} />
          </Route>
          <Route path="/reset-password" element={<ResetPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/invitation/:token" element={<InvitePage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/app" element={<AppShell />}>
            <Route index element={<Home />} />
            <Route element={<RequirePermission any={['inbox.reply', 'inbox.supervise']} />}><Route path="messages" element={<InboxPage />} /></Route>
            <Route element={<RequirePlatform />}>
              <Route path="admin/agencies" element={<AdminAgencies />} />
              <Route path="admin/payouts" element={<AdminPayouts />} />
              <Route path="admin/messages" element={<AdminMessages />} />
            </Route>
            <Route element={<RequirePermission any={['wallet.view']} />}><Route path="wallet" element={<WalletPage />} /></Route>
            <Route element={<RequirePermission any={['library.read']} />}><Route path="library" element={<LibraryPage />} /></Route>
            <Route element={<RequirePermission any={['analytics.team', 'analytics.me']} />}><Route path="analytics" element={<AnalyticsPage />} /></Route>
            <Route element={<RequirePermission any={['sales.record', 'analytics.team']} />}><Route path="sales" element={<SalesPage />} /></Route>
            <Route element={<RequirePermission any={['shifts.manage', 'inbox.reply']} />}><Route path="shifts" element={<ShiftsPage />} /></Route>
            <Route path="accounts" element={<AccountsPage />} />
            <Route element={<RequirePermission any={['team.manage']} />}><Route path="team" element={<TeamPage />} /></Route>
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
