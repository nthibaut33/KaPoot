import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Le bac a sable humain ne se termine jamais : il a sa propre config.
  testIgnore: '**/sandbox/**',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: { baseURL, trace: 'on-first-retry' },

  // L etat des parties vit dans la heap du serveur : on en veut un neuf a chaque run,
  // et sur un port distinct de celui d un `npm run dev` eventuellement en cours.
  webServer: {
    command: 'npm start',
    url: baseURL,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    stdout: 'pipe',
  },

  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
});
