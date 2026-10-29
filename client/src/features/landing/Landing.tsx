import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { APP_NAME, useSeo } from '../../hooks/useSeo';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';
import { ButtonLink } from '../../components/ui';
import { Icons } from '../../components/icons';

const FEATURES = [
  {
    icon: Icons.Inbox,
    t: 'Une inbox partagée en temps réel',
    d: 'Tous les messages Telegram de tous vos modèles dans une seule vue, avec filtres « à répondre », « non assignées », « mes conversations ».',
  },
  {
    icon: Icons.UserCog,
    t: 'Assignation claire',
    d: 'Un chatter prend une conversation, un sous-chef la réassigne. Une conversation, un responsable : zéro doublon.',
  },
  {
    icon: Icons.Lock,
    t: 'Médias payants avec cadenas flouté',
    d: 'Le fan reçoit un aperçu flouté avec un grand cadenas et un bouton Débloquer. Il paie en mini-app Telegram et reçoit l’original automatiquement.',
  },
  {
    icon: Icons.Library,
    t: 'Médiathèque et scripts',
    d: 'Images, vidéos, audio et messages pré-faits, classés par modèle. Un seul clic pour envoyer en live.',
  },
  {
    icon: Icons.Analytics,
    t: 'Rendement par chatter',
    d: 'Ventes, temps de réponse et taux de conversion de chaque chatter, calculés à partir d’évènements réels.',
  },
  {
    icon: Icons.Wallet,
    t: 'Brut, net et retraits',
    d: 'Vous voyez le prix brut, la commission et votre net total transparent. Demandez un retrait à tout moment.',
  },
];

const ROLES = [
  {
    icon: Icons.Agencies,
    t: 'Chef d’agence',
    d: 'Crée une ou plusieurs agences, y installe ses modèles, ses médias et son équipe, suit le rendement et retire ses gains.',
  },
  {
    icon: Icons.Supervisor,
    t: 'Sous-chef',
    d: 'Supervise toutes les discussions de l’agence et sa performance globale. Droits ajustables membre par membre.',
  },
  {
    icon: Icons.Messages,
    t: 'Chatters',
    d: 'Répondent aux conversations qui leur sont ouvertes, enregistrent leurs ventes PPV et suivent leurs statistiques.',
  },
  {
    icon: Icons.Team,
    t: 'Team leaders & modèles',
    d: 'Le team leader supervise ses comptes attribués ; le modèle dépose ses contenus et suit ses conversations.',
  },
];

const STEPS = [
  ['Créez votre agence', 'Inscrivez-vous en 30 secondes : vous devenez chef d’agence. Créez autant d’agences que nécessaire.'],
  ['Connectez vos modèles', 'Compte Telegram Business (bot officiel), bot classique, ou compte personnel par numéro — sans Telegram Premium requis.'],
  ['Invitez l’équipe, encaissez', 'Vos chatters répondent, les fans débloquent les médias, vous suivez les encaissements et retirez votre net.'],
];

const FAQ = [
  ['Combien ça coûte ?', 'Aucun abonnement mensuel : la plateforme prélève seulement 15 % sur chaque vente débloquée. Vous voyez toujours le prix brut, la commission et votre net exact.'],
  ['Comment le fan paie-t-il un média verrouillé ?', 'Il reçoit un aperçu flouté avec un cadenas et un bouton Débloquer. Le bouton ouvre le mini navigateur intégré de Telegram avec la prévisualisation stylée, où il choisit son moyen de paiement et débloque le média immédiatement.'],
  ['Mes fans parlent-ils à un bot ?', 'Pas obligatoirement. En mode « compte personnel », les fans écrivent au vrai compte du modèle ; en mode Business, ils écrivent aussi au compte du modèle.'],
  ['Peut-on écrire en premier à un contact ?', 'Non : on ne répond qu’aux personnes qui ont écrit en premier. C’est une règle stricte de Telegram et une protection essentielle anti-ban pour vos comptes.'],
  ['Qui peut voir quoi ?', 'Les droits sont appliqués côté serveur : un chatter ne voit que ses conversations assignées, le sous-chef supervise toute l’agence, et chaque agence est strictement isolée.'],
  ['Puis-je essayer sans Telegram ?', 'Oui : un mode bac à sable complet simule Telegram pour former votre équipe avant le grand lancement.'],
];

export default function Landing() {
  useSeo({
    title: 'Le CRM Telegram des agences',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: APP_NAME,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
    },
  });

  return (
    <div className="min-h-dvh bg-bg text-ink font-sans selection:bg-brand/20 selection:text-brand">
      {/* Header Sticky avec Glassmorphism */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav aria-label="Navigation" className="hidden gap-8 text-sm font-medium text-muted md:flex">
            <a href="#fonctions" className="hover:text-brand transition">Fonctions</a>
            <a href="#roles" className="hover:text-brand transition">Rôles</a>
            <a href="#connexion" className="hover:text-brand transition">Démarrer</a>
            <a href="#offres" className="hover:text-brand transition">Tarif</a>
            <a href="#faq" className="hover:text-brand transition">FAQ</a>
          </nav>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <ButtonLink to="/login" variant="ghost" size="sm">Connexion</ButtonLink>
            <ButtonLink to="/register" size="sm">Créer mon agence</ButtonLink>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Section Hero avec Animations Framer Motion */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-muted shadow-xs">
              <Icons.Zap className="h-4 w-4 text-gold shrink-0" />
              <span>Pour les agences qui gèrent des modèles sur Telegram</span>
            </div>
            <h1 className="mt-5 font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.08] tracking-tight text-ink">
              Toute l’agence dans <span className="text-brand">une seule inbox</span> Telegram.
            </h1>
            <p className="mt-5 max-w-xl text-base sm:text-lg leading-relaxed text-muted">
              Chatters, sous-chef et modèles réunis : conversations assignées sans collision, médias payants floutés avec cadenas, paiement intégré in-app Telegram, rendement temps réel et retraits sécurisés.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <ButtonLink to="/register" size="lg" className="shadow-md">
                Créer mon agence gratuitement
              </ButtonLink>
              <a
                href="#connexion"
                className="inline-flex h-12 items-center rounded-ctl border border-line bg-surface px-6 font-semibold text-ink transition hover:bg-raised active:scale-95"
              >
                Comment démarrer
              </a>
            </div>
            <p className="mt-4 text-xs font-medium text-muted flex items-center gap-2">
              <Icons.CheckCircle className="h-4 w-4 text-ok" />
              Aucun abonnement fixe · 15 % par vente · Frais transparents
            </p>
          </motion.div>

          {/* Démonstration Visuelle Mock UI animée */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
          >
            <MockPreview />
          </motion.div>
        </section>

        {/* Section Fonctions */}
        <section id="fonctions" className="border-y border-line bg-surface py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-ink">Ce que votre équipe fait dans TeleDesk</h2>
              <p className="mt-3 text-sm sm:text-base text-muted">
                Une suite complète d’outils conçue pour maximiser le taux de conversion et supprimer les pertes de temps.
              </p>
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <motion.article
                  key={f.t}
                  whileHover={{ y: -4 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                  className="rounded-card border border-line bg-bg p-6 shadow-xs transition hover:shadow-md hover:border-brand/30"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <f.icon className="h-6 w-6" aria-hidden />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold text-ink">{f.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{f.d}</p>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        {/* Section Rôles & Permissions */}
        <section id="roles" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-ink">Chacun son rôle, chacun ses droits</h2>
            <p className="mt-3 text-sm sm:text-base text-muted">
              Les permissions sont vérifiées rigoureusement par le serveur à chaque requête. Vos données et modèles restent sous clé.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((r) => (
              <motion.article
                key={r.t}
                whileHover={{ y: -3 }}
                className="rounded-card border border-line bg-surface p-6 shadow-xs transition hover:shadow-md"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/15 text-gold">
                  <r.icon className="h-6 w-6" aria-hidden />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-ink">{r.t}</h3>
                <p className="mt-2 text-xs sm:text-sm leading-relaxed text-muted">{r.d}</p>
              </motion.article>
            ))}
          </div>
        </section>

        {/* Section 3 Étapes */}
        <section id="connexion" className="border-y border-line bg-surface py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="text-center max-w-xl mx-auto">
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-ink">Démarrez en trois étapes</h2>
              <p className="mt-3 text-sm text-muted">Pas besoin d'installation technique complexe.</p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {STEPS.map(([t, d], i) => (
                <article key={t} className="rounded-card border border-line bg-bg p-6 shadow-xs relative">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand font-display font-bold text-brand-ink text-sm shadow-xs">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-display text-lg font-semibold text-ink">{t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{d}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Section Tarifs */}
        <section id="offres" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid items-center gap-8 rounded-2xl border border-line bg-surface p-8 sm:p-10 shadow-sm md:grid-cols-[1fr_auto]">
            <div>
              <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">Tarif unique sans surprise</span>
              <h2 className="mt-3 font-display text-3xl sm:text-4xl font-bold text-ink">15 % par vente uniquement</h2>
              <p className="mt-3 max-w-xl text-sm sm:text-base leading-relaxed text-muted">
                Zéro abonnement mensuel, zéro frais cachés. Vous ne payez que lorsque votre agence génère du chiffre d’affaires réel. Chaque vente affiche en toute clarté le montant brut, la commission et votre net.
              </p>
              <ul className="mt-6 grid gap-2.5 text-sm sm:grid-cols-2">
                {[
                  'Agences et modèles illimités',
                  'Chatters et chefs illimités',
                  'Retraits rapides dès 20 €',
                  'Page de paiement in-app Telegram intégrée',
                ].map((x) => (
                  <li key={x} className="flex items-center gap-2 font-medium text-ink">
                    <Icons.CheckCircle className="h-4 w-4 text-ok shrink-0" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-brand p-8 text-center text-brand-ink shadow-lg md:w-72 shrink-0">
              <p className="font-display text-5xl font-extrabold tracking-tight">15 %</p>
              <p className="mt-2 text-xs font-medium opacity-90">de commission sur les ventes débloquées</p>
              <ButtonLink to="/register" variant="gold" className="mt-6 w-full shadow-md font-bold">
                Créer mon agence
              </ButtonLink>
            </div>
          </div>
        </section>

        {/* Section FAQ */}
        <section id="faq" className="border-t border-line bg-surface py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 className="font-display text-3xl font-bold text-center text-ink">Questions fréquentes</h2>
            <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-bg overflow-hidden shadow-xs">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group p-5 transition hover:bg-surface/50">
                  <summary className="flex cursor-pointer items-center justify-between font-semibold text-sm sm:text-base text-ink list-none">
                    <span>{q}</span>
                    <Icons.ChevronDown className="h-4 w-4 text-muted transition-transform group-open:rotate-180 shrink-0 ml-2" />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{a}</p>
                </details>
              ))}
            </div>
            <div className="mt-8 rounded-xl border border-gold/40 bg-gold/10 p-4 text-xs sm:text-sm text-ink leading-relaxed">
              <strong>Cadre réglementaire & responsabilité :</strong> {APP_NAME} est un logiciel CRM de gestion des interactions. Vous restez responsable de la légalité de votre activité, de l'âge légal (18 ans minimum strict) et du consentement des personnes représentées, ainsi que des règles de Telegram.
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line bg-surface py-10 text-center text-xs text-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
          <span>© {new Date().getFullYear()} {APP_NAME} — Tous droits réservés.</span>
          <div className="flex gap-6 font-medium">
            <Link to="/terms" className="hover:text-ink transition">Conditions d’utilisation</Link>
            <Link to="/privacy" className="hover:text-ink transition">Confidentialité</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Mock UI visuel haute résolution représentant le CRM et le PPV verrouillé */
function MockPreview() {
  const contacts = [
    { name: 'Thomas D.', msg: 'Tu as un nouveau média exclusif ?', tag: 'À répondre', tone: 'danger' },
    { name: 'Lucas B.', msg: 'Merci beaucoup, c’est sublime !', tag: 'Yanis', tone: 'brand' },
    { name: 'Hugo M.', msg: 'OK je prends le pack de suite', tag: 'Inès', tone: 'brand' },
  ];

  return (
    <div aria-hidden className="rounded-2xl border border-line bg-surface p-4 shadow-xl">
      <div className="grid grid-cols-[12rem_1fr] gap-3">
        {/* Colonne Liste */}
        <div className="space-y-2 border-r border-line pr-2.5">
          <div className="flex items-center gap-1.5 px-1 py-1 text-xs font-bold text-ink">
            <Icons.Messages className="h-4 w-4 text-brand" />
            <span>Conversations</span>
          </div>
          {contacts.map((c, i) => (
            <div
              key={c.name}
              className={`rounded-xl p-2.5 text-xs transition ${
                i === 0 ? 'bg-brand/10 border border-brand/20' : 'bg-raised/70'
              }`}
            >
              <p className="font-semibold text-ink">{c.name}</p>
              <p className="truncate text-muted text-[11px] mt-0.5">{c.msg}</p>
              <span
                className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold ${
                  c.tone === 'danger' ? 'bg-danger/15 text-danger' : 'bg-brand/15 text-brand'
                }`}
              >
                {c.tag}
              </span>
            </div>
          ))}
        </div>

        {/* Colonne Chat */}
        <div className="flex flex-col justify-end gap-2.5 rounded-xl bg-bg p-3.5 text-xs">
          <div className="max-w-[85%] rounded-2xl rounded-bl-xs border border-line bg-surface px-3.5 py-2.5 text-ink shadow-2xs">
            Tu as un nouveau média exclusif ?
          </div>

          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-xs bg-brand px-3.5 py-2.5 text-brand-ink shadow-xs">
            Oui, je t’envoie le pack photo & vidéo de la semaine 🔥
          </div>

          {/* Bulle PPV Cadenas Flouté */}
          <div className="ml-auto max-w-[88%] rounded-2xl border border-gold/40 bg-surface p-2.5 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="relative h-12 w-12 rounded-lg bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 flex items-center justify-center text-white overflow-hidden shadow-xs">
                <span className="absolute inset-0 bg-black/40 backdrop-blur-xs" />
                <Icons.Lock className="h-5 w-5 text-white z-10" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink text-xs truncate">🔒 Pack exclusif · 25 €</p>
                <p className="text-[10px] text-muted">Aperçu flouté envoyé au fan</p>
              </div>
            </div>
            <button className="mt-2 w-full rounded-lg bg-ok/15 text-ok text-[11px] font-bold py-1.5 flex items-center justify-center gap-1.5">
              <Icons.LockOpen className="h-3.5 w-3.5" />
              Débloquer après paiement
            </button>
          </div>

          <div className="rounded-xl border border-line bg-surface px-3 py-2 text-muted text-xs flex items-center justify-between">
            <span>Écrire un message…</span>
            <Icons.Send className="h-3.5 w-3.5 text-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}
