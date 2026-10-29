import { Outlet } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { APP_NAME } from '../hooks/useSeo';

export default function AuthLayout() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="weave relative hidden flex-col justify-between overflow-hidden bg-brand p-10 text-brand-ink lg:flex" style={{ backgroundBlendMode: 'overlay' }}>
        <Logo className="[&_span]:text-brand-ink" />
        <div className="max-w-md">
          <h2 className="font-display text-4xl font-bold leading-tight">Toute l’agence dans une seule inbox Telegram.</h2>
          <p className="mt-4 text-lg opacity-85">{APP_NAME} réunit chatters, team leaders et modèles : conversations assignées, notes internes, médias PPV en un clic et métriques par shift.</p>
        </div>
        <p className="text-sm opacity-70">API officielle de Telegram · aucun mot de passe ni session Telegram demandés</p>
      </aside>
      <main id="main" className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end"><Logo className="lg:hidden" /><ThemeToggle /></div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8"><Outlet /></div>
      </main>
    </div>
  );
}
