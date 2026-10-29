import pino from 'pino';
import { env, isTest } from './env';

export const logger = pino({
  level: isTest ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'newPassword', 'currentPassword', 'token', '*.password', '*.token', '*.refreshToken'],
    censor: '[REDACTED]',
  },
});
