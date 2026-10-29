import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { env, isProd, isTest, projectRoot } from './config/env';
import { errorHandler, geoBlock, globalLimiter } from './middleware';
import { sanitize } from './middleware/security';
import { getStorage } from './providers/storage';
import { sandboxTelegram } from './providers/telegram/fake';
import routes from './routes';
import { payRouter, stripeWebhook } from './routes/pay';
import { notFound } from './utils/errors';

export function createApp() {
  const app = express();
  getStorage(); // crée les dossiers de stockage privé
  app.disable('x-powered-by');
  if (isProd) app.set('trust proxy', 1);
  // Faux serveur Telegram du bac à sable : monté avant le reste (il lit son propre corps), seulement si ALLOW_SANDBOX.
  if (env.ALLOW_SANDBOX) app.use('/__sandbox/telegram', sandboxTelegram.router());
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://telegram.org'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org'],
          objectSrc: ["'none'"],
        },
      },
    }),

  );
  app.use(compression());
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  app.use(cookieParser());
  app.use('/api/stripe/webhook', stripeWebhook); // corps brut : monté avant le parseur JSON
  app.use('/pay', payRouter);
  app.use(express.json({ limit: '1mb' })); // les mises à jour Telegram peuvent dépasser 100 ko (messages longs)
  app.use(sanitize);
  app.use(geoBlock);
  if (!isTest) app.use('/api', globalLimiter);

  app.use('/api', routes);
  app.use('/api', (_req, _res, next) => next(notFound('Route introuvable', 'ROUTE_NOT_FOUND')));

  // Production : le serveur sert aussi le client compilé (une seule commande : npm start)
  const dist = path.resolve(projectRoot, 'client/dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    const indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    app.use(express.static(dist, { index: false, maxAge: isProd ? '1y' : 0, setHeaders: (res, p) => { if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^(?!\/(api|__sandbox|pay)\/).*/, (_req, res) => res.type('html').send(indexHtml.replace('<!--SEO-->', '')));
  }
  app.use(errorHandler);
  return app;
}
