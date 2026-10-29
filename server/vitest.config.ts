import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/teledesk_test',
      UPLOAD_DIR: './.test-uploads',
      JWT_ACCESS_SECRET: 'test_access_secret_test_access_secret_1234',
      MEDIA_SIGNING_SECRET: 'test_media_secret_test_media_secret_1234',
      TELEGRAM_SECRET_KEY: 'test_telegram_key_test_telegram_key_1234',
      ALLOW_SANDBOX: 'true',
      PUBLIC_URL: 'https://pay.example.test',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
      TELEGRAM_AUTOSTART: 'false',
      OUTBOUND_MIN_INTERVAL_MS: '0',
      REQUIRE_EMAIL_VERIFICATION: 'false',
      BLOCKED_COUNTRIES: '',
      EMAIL_PROVIDER: 'console',
    },
  },
});
