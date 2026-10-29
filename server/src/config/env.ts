import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Recherche du .env en remontant depuis le dossier courant (racine du monorepo).
function loadDotenv() {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}
export const projectRoot = loadDotenv();

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  APP_NAME: z.string().default('TeleDesk'),
  /** Identifiants du super admin de la plateforme (créé au premier démarrage s'il n'existe pas). */
  SUPERADMIN_EMAIL: z.string().email().optional(),
  SUPERADMIN_PASSWORD: z.string().min(10).optional(),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/teledesk'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  /** URL publique HTTPS du serveur (nécessaire seulement pour le mode webhook de Telegram). */
  PUBLIC_URL: z.string().default(''),
  /** Paiement des médias payants : « simulated » (page de test, aucun débit) ou « stripe » (Stripe Checkout réel). */
  PAYMENT_PROVIDER: z.enum(['simulated', 'stripe']).default('simulated'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  /** Durée de validité d'un lien de paiement (heures). */
  CHECKOUT_TTL_HOURS: z.coerce.number().default(72),
  JWT_ACCESS_SECRET: z.string().default('change_me'),
  MEDIA_SIGNING_SECRET: z.string().default('change_me'),
  /** Clé de chiffrement (AES-256-GCM) des jetons de bot Telegram stockés en base. */
  TELEGRAM_SECRET_KEY: z.string().default('change_me'),
  REDIS_ENABLED: bool,
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(50),
  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  EMAIL_FROM: z.string().default('TeleDesk <no-reply@teledesk.local>'),
  /** API officielle de Telegram. Modifiable pour les tests (faux serveur local). */
  TELEGRAM_API_BASE: z.string().url().default('https://api.telegram.org'),
  /** Bac à sable : faux serveur Telegram intégré pour la démo et les tests. Désactivé par défaut en production. */
  ALLOW_SANDBOX: z.enum(['true', 'false']).optional(),
  /** Durée d'attente (secondes) d'un appel getUpdates en mode polling. */
  /** Identifiants d'application Telegram (https://my.telegram.org › API development tools), requis seulement pour le mode « compte personnel ». */
  TELEGRAM_API_ID: z.coerce.number().optional(),
  TELEGRAM_API_HASH: z.string().default(''),
  /** Plafond d'envois par heure et par compte personnel (protège le compte contre les blocages anti-spam de Telegram). */
  USER_MAX_SENDS_PER_HOUR: z.coerce.number().default(90),
  POLL_TIMEOUT_S: z.coerce.number().min(0).max(50).default(25),
  /** Démarre automatiquement les connexions Telegram (polling, webhooks) au lancement du serveur. */
  TELEGRAM_AUTOSTART: z.enum(['true', 'false']).default('true'),
  /** Intervalle minimal entre deux envois sur un même compte Telegram (protection anti-flood). */
  OUTBOUND_MIN_INTERVAL_MS: z.coerce.number().min(0).default(1100),
  REQUIRE_EMAIL_VERIFICATION: bool,
  BLOCKED_COUNTRIES: z.string().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuration invalide :', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const base = parsed.data;
export const env = {
  ...base,
  ALLOW_SANDBOX: base.ALLOW_SANDBOX ? base.ALLOW_SANDBOX === 'true' : base.NODE_ENV !== 'production',
  TELEGRAM_AUTOSTART: base.TELEGRAM_AUTOSTART === 'true' && base.NODE_ENV !== 'test',
  blockedCountries: base.BLOCKED_COUNTRIES.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
};
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

// En production, refuser les secrets par défaut / trop courts.
if (isProd) {
  const weak = (['JWT_ACCESS_SECRET', 'MEDIA_SIGNING_SECRET', 'TELEGRAM_SECRET_KEY'] as const).filter((k) => env[k] === 'change_me' || env[k].length < 32);
  if (weak.length) {
    console.error(`Secrets faibles ou par défaut en production : ${weak.join(', ')}`);
    process.exit(1);
  }
}
export const uploadRoot = path.resolve(projectRoot, env.UPLOAD_DIR);
