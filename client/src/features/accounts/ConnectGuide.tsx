import { Icons } from '../../components/icons';

/** Guide pas à pas de la connexion d'un compte Telegram Business (aucun mot de passe ni numéro de téléphone du modèle n'est demandé). */
export function ConnectGuide({ botUsername }: { botUsername?: string | null }) {
  const bot = botUsername ? `@${botUsername}` : 'votre bot';
  const steps: Array<{ t: string; d: React.ReactNode }> = [
    { t: 'Créer le bot (une seule fois par modèle)', d: <>Dans Telegram, ouvrez <a className="text-brand underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather <Icons.ExternalLink className="inline h-3 w-3" /></a>, envoyez <code>/newbot</code>, choisissez un nom puis un identifiant terminé par « bot ». BotFather vous donne un <strong>jeton</strong> (123456:ABC…).</> },
    { t: 'Activer le mode Business du bot', d: <>Toujours dans @BotFather : <code>/mybots</code> → votre bot → <strong>Bot Settings</strong> → <strong>Business Mode</strong> → activer.</> },
    { t: 'Coller le jeton dans TeleDesk', d: <>Le jeton est chiffré dès son enregistrement et n’est plus jamais affiché, même à vous. Il ne donne accès qu’au bot, pas au compte personnel du modèle.</> },
    { t: 'Le modèle connecte le bot à son compte', d: <>Sur le compte Telegram <strong>Premium</strong> du modèle : <strong>Paramètres → Telegram Business → Chatbots</strong>, saisir <strong>{bot}</strong>, puis accorder le droit <strong>« Répondre aux messages »</strong> (et « Lire les messages » pour marquer les conversations comme lues). Le modèle peut limiter les chats concernés et retirer le bot à tout moment.</> },
    { t: 'Confirmer ici', d: <>Dès que Telegram prévient TeleDesk, la connexion apparaît « en attente » : vérifiez que c’est bien le bon modèle, puis <strong>Confirmer</strong>. Aucun message n’est lu avant cette confirmation.</> },
  ];
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-ink">{i + 1}</span>
          <div className="min-w-0 text-sm"><p className="font-semibold">{s.t}</p><p className="mt-0.5 text-muted [&_code]:rounded [&_code]:bg-raised [&_code]:px-1 [&_strong]:text-ink">{s.d}</p></div>
        </li>
      ))}
    </ol>
  );
}
