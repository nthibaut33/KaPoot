import { defineConfig, devices } from '@playwright/test';

/**
 * Config du bac a sable humain (`npm run sandbox`).
 *
 * Ce n est pas une suite de non-regression : la session reste ouverte jusqu a Ctrl+C
 * pour qu un testeur rejoigne depuis son propre appareil. D ou `timeout: 0`, le mode
 * `headed` (la console animateur doit etre visible) et l absence de retry.
 */
const PORT = Number(process.env.PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e/sandbox',
  timeout: 0,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL, headless: false },

  webServer: {
    command: 'npm start',
    url: baseURL,
    env: { PORT: String(PORT) },
    // Contrairement aux tests, on accepte un serveur deja lance : le testeur peut
    // relancer le bac a sable sans couper les parties en cours.
    reuseExistingServer: true,
    stdout: 'pipe',
  },
});
