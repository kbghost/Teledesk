import { ButtonLink } from '../../components/ui';
import { useSeo } from '../../hooks/useSeo';

export default function NotFound() {
  useSeo({ title: 'Page introuvable', noindex: true });
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="weave mx-auto flex h-20 w-32 items-center justify-center rounded-card border border-gold/40 font-display text-4xl font-bold">404</p>
      <h1 className="mt-6 font-display text-2xl font-bold">Cette page n’existe pas</h1>
      <p className="mt-2 text-muted">Le lien est peut-être incorrect, ou le contenu a été retiré.</p>
      <div className="mt-6 flex justify-center gap-2"><ButtonLink to="/">Accueil</ButtonLink><ButtonLink to="/explore" variant="secondary">Explorer</ButtonLink></div>
    </div>
  );
}
