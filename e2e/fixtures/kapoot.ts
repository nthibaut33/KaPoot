import { test as base } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { HostConsole } from '../pages/host';
import { PlayerPage } from '../pages/player';
import { makeQuiz } from './quiz';
import type { Quiz } from './quiz';

type KapootFixtures = {
  /** Cree un `BrowserContext` isole par participant, tous fermes en fin de test. */
  newParticipant: () => Promise<BrowserContext>;
  /** Ouvre la console animateur et cree une partie. */
  openHost: (quiz?: Quiz) => Promise<HostConsole>;
  /** Fait rejoindre un joueur dans son propre contexte. */
  joinPlayer: (pin: string, nickname: string) => Promise<PlayerPage>;
};

export const test = base.extend<KapootFixtures>({
  newParticipant: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext();
      contexts.push(context);
      return context;
    });
    await Promise.all(contexts.map((c) => c.close()));
  },

  openHost: async ({ newParticipant }, use) => {
    await use(async (quiz = makeQuiz()) => HostConsole.open(await newParticipant(), quiz));
  },

  joinPlayer: async ({ newParticipant }, use) => {
    await use(async (pin, nickname) => PlayerPage.join(await newParticipant(), pin, nickname));
  },
});

export { expect } from '@playwright/test';
export { makeQuiz } from './quiz';
export type { Quiz } from './quiz';
