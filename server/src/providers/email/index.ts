import { env } from '../../config/env';
import { logger } from '../../config/logger';

export interface EmailMessage { to: string; subject: string; html: string; text: string }
export interface EmailProvider { send(msg: EmailMessage): Promise<void> }

/** Dev : affiche l'email dans la console (et le conserve en mémoire pour les tests). */
export class ConsoleEmailProvider implements EmailProvider {
  static outbox: EmailMessage[] = [];
  async send(msg: EmailMessage) {
    ConsoleEmailProvider.outbox.push(msg);
    if (ConsoleEmailProvider.outbox.length > 200) ConsoleEmailProvider.outbox.shift();
    if (env.NODE_ENV !== 'test') console.log(`\n✉  [email → ${msg.to}] ${msg.subject}\n${msg.text}\n`);
  }
}
/** SMTP/Resend : brancher ici (nodemailer ou API HTTP). Chargé dynamiquement. */
export class SmtpEmailProvider implements EmailProvider {
  async send(msg: EmailMessage) {
    const name = 'nodemailer';
    const nodemailer: any = await import(/* @vite-ignore */ name).catch(() => {
      throw new Error('Installez nodemailer pour EMAIL_PROVIDER=smtp');
    });
    const t = nodemailer.createTransport(process.env.SMTP_URL);
    await t.sendMail({ from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
  }
}
const provider: EmailProvider = env.EMAIL_PROVIDER === 'smtp' ? new SmtpEmailProvider() : new ConsoleEmailProvider();

const layout = (title: string, body: string, cta?: { label: string; url: string }) => ({
  html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;color:#2B1B4A"><h2 style="margin:0 0 12px">${title}</h2><p style="line-height:1.6">${body}</p>${
    cta ? `<p><a href="${cta.url}" style="background:#4A2C82;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">${cta.label}</a></p>` : ''
  }<p style="color:#888;font-size:12px">${env.APP_NAME}</p></div>`,
  text: `${title}\n\n${body.replace(/<[^>]+>/g, '')}${cta ? `\n${cta.label}: ${cta.url}` : ''}`,
});

export const templates = {
  welcome: (name: string, agency: string) => layout(`Bienvenue sur ${env.APP_NAME}, ${name} !`, `L'agence « ${agency} » est créée. Connectez votre premier compte Telegram, puis invitez votre équipe.`, { label: 'Ouvrir mon espace', url: `${env.CLIENT_URL}/app` }),
  verifyEmail: (token: string) => layout('Confirmez votre email', 'Cliquez pour vérifier votre adresse.', { label: 'Vérifier', url: `${env.CLIENT_URL}/verifier-email?token=${token}` }),
  resetPassword: (token: string) => layout('Réinitialisation du mot de passe', 'Ce lien expire dans 1 heure. Ignorez cet email si vous n\'êtes pas à l\'origine de la demande.', { label: 'Réinitialiser', url: `${env.CLIENT_URL}/reinitialiser?token=${token}` }),
  invite: (agency: string, inviter: string, role: string, token: string) => layout(`${inviter} vous invite à rejoindre ${agency}`, `Vous avez été invité(e) avec le rôle « ${role} ». Ce lien est valable 7 jours.`, { label: 'Accepter l\'invitation', url: `${env.CLIENT_URL}/invitation/${token}` }),
  security: (what: string) => layout('Alerte de sécurité', what),
};

export async function sendEmail(to: string, tpl: { html: string; text: string }, subject: string) {
  try {
    await provider.send({ to, subject, ...tpl });
  } catch (err) {
    logger.error({ err }, 'email send failed');
  }
}
