import http from 'node:http';
import mongoose from 'mongoose';
import { env } from './config/env';
import { connectDb } from './config/db';
import { logger } from './config/logger';
import { ensureSuperAdmin } from './services/auth.service';
import { createApp } from './app';
import { initSockets } from './sockets';
import { initCache } from './providers/cache';
import { startJobs, stopJobs } from './jobs';
import { restoreSandbox } from './services/telegram/sandbox';
import { telegramManager } from './services/telegram/manager';
import { resumeOutbound } from './services/telegram/outbound';

async function main() {
  try {
    await connectDb();
  } catch {
    process.exit(1);
  }
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch((err) => logger.warn({ err, model: m.modelName }, 'index init failed'))));
  await initCache();
  if (env.SUPERADMIN_EMAIL && env.SUPERADMIN_PASSWORD) {
    try { if (await ensureSuperAdmin(env.SUPERADMIN_EMAIL, env.SUPERADMIN_PASSWORD)) logger.info({ email: env.SUPERADMIN_EMAIL }, 'super admin créé'); } catch (err) { logger.error({ err }, 'super admin non créé'); }
  }
  const app = createApp();
  const server = http.createServer(app);
  initSockets(server);
  startJobs();
  server.listen(env.PORT, () => {
    console.log(`Server running on http://localhost:${env.PORT}`);
    console.log(`${env.APP_NAME} · env=${env.NODE_ENV} · stockage=${env.STORAGE_PROVIDER} · bac à sable=${env.ALLOW_SANDBOX ? 'on' : 'off'} · redis=${env.REDIS_ENABLED ? 'on' : 'off'}`);
    // Une fois le serveur à l'écoute (le faux Telegram est joignable) : reconstruction du bac à sable, écoute des comptes, reprise des envois.
    void (async () => {
      try {
        const restored = await restoreSandbox();
        const started = await telegramManager.startAll();
        const r = await resumeOutbound();
        logger.info({ sandboxAccounts: restored, listening: started, ...r }, 'telegram ready');
      } catch (err) { logger.error({ err }, 'telegram startup failed'); }
    })();
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(err.code === 'EADDRINUSE' ? `Le port ${env.PORT} est déjà utilisé. Changez PORT dans .env.` : err);
    process.exit(1);
  });
  const shutdown = async () => {
    stopJobs();
    await telegramManager.stopAll();
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
void main();
