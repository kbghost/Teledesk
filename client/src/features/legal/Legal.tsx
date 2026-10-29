import type { ReactNode } from 'react';
import { APP_NAME, useSeo } from '../../hooks/useSeo';

const Doc = ({ title, children }: { title: string; children: ReactNode }) => (
  <article className="mx-auto max-w-2xl [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-3 [&_p]:leading-relaxed [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
    <h1 className="font-display text-3xl font-bold">{title}</h1>
    <p className="mt-2 rounded-ctl border border-gold/50 bg-gold/10 px-3 py-2 text-sm">Document type fourni avec le projet : à faire relire et adapter par un juriste avant toute mise en production.</p>
    {children}
  </article>
);
export function Terms() {
  useSeo({ title: 'Conditions d’utilisation' });
  return (
    <Doc title="Conditions d’utilisation">
      <h2>1. Objet</h2><p>{APP_NAME} met à disposition des créateurs un espace pour publier des contenus gratuits ou payants et échanger avec leur audience. L’utilisation du service implique l’acceptation de ces conditions.</p>
      <h2>2. Comptes et âge minimum</h2><p>Vous devez avoir 18 ans révolus et fournir des informations exactes. Vous êtes responsable de la confidentialité de votre mot de passe et de l’activité de votre compte.</p>
      <h2>3. Contenus</h2><ul><li>Vous conservez vos droits sur vos contenus et nous accordez la licence nécessaire à leur diffusion sur la plateforme.</li><li>Sont interdits : contenus illégaux, harcèlement, usurpation d’identité, fraude, spam, atteinte aux droits de tiers.</li><li>Les contenus signalés peuvent être retirés et les comptes suspendus ou bannis après examen.</li></ul>
      <h2>4. Paiements et commissions</h2><p>Les achats, abonnements et pourboires sont facturés en FCFA. Une commission de plateforme est prélevée sur chaque paiement et affichée dans l’espace créateur. L’accès à un contenu payant n’est accordé qu’après confirmation du paiement par notre prestataire. Les retraits sont soumis à un montant minimum et à validation.</p>
      <h2>5. Résiliation</h2><p>Vous pouvez supprimer votre compte à tout moment depuis les paramètres. Un abonnement annulé reste actif jusqu’à la fin de la période déjà payée.</p>
      <h2>6. Responsabilité</h2><p>Le service est fourni « en l’état ». Dans les limites permises par la loi, notre responsabilité ne saurait être engagée pour les contenus publiés par les utilisateurs.</p>
    </Doc>
  );
}
export function Privacy() {
  useSeo({ title: 'Politique de confidentialité' });
  return (
    <Doc title="Politique de confidentialité">
      <h2>Données collectées</h2><ul><li>Compte : email, nom affiché, mot de passe (stocké haché, jamais en clair).</li><li>Usage : sessions et appareils, publications, messages, achats, statistiques d’audience agrégées.</li><li>Paiements : références de transaction ; nous ne stockons pas de données de carte bancaire.</li></ul>
      <h2>Finalités</h2><p>Fournir le service, sécuriser les comptes, traiter les paiements, modérer les contenus et envoyer les notifications que vous avez activées.</p>
      <h2>Vos droits</h2><p>Vous pouvez à tout moment exporter vos données et supprimer votre compte depuis <em>Paramètres → Données</em>. La suppression anonymise vos données personnelles ; certaines écritures comptables peuvent être conservées pour obligation légale.</p>
      <h2>Cookies</h2><p>Un cookie technique sécurisé (HttpOnly) maintient votre session. Aucun cookie publicitaire n’est utilisé.</p>
      <h2>Contact</h2><p>Pour toute demande relative à vos données, contactez l’équipe via les coordonnées de l’exploitant du service.</p>
    </Doc>
  );
}
