// Crée .env depuis .env.example (secrets aléatoires) s'il n'existe pas.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, '.env');
if (!existsSync(target)) {
  let c = readFileSync(resolve(root, '.env.example'), 'utf8');
  c = c.replace(/^(JWT_ACCESS_SECRET|MEDIA_SIGNING_SECRET|TELEGRAM_SECRET_KEY)=.*$/gm, (_m, k) => `${k}=${randomBytes(32).toString('hex')}`);
  writeFileSync(target, c);
  console.log('✓ .env créé (secrets aléatoires générés)');
}
