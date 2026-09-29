import { expect } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { Quiz } from '../fixtures/quiz';

/**
 * Console animateur (`public/host.html`).
 *
 * `#status` est le point d observation du temps reel :
 *   lobby    -> "N joueur(s) connecte(s)"   (player_joined / player_left)
 *   question -> "N reponse(s)"              (answer_received)
 *   reveal   -> "Classement provisoire"     (question_ended)
 */
export class HostConsole {
  readonly page: Page;
  readonly pin: string;

  constructor(page: Page, pin: string) {
    this.page = page;
    this.pin = pin;
  }

  /** Ouvre la console, cree la partie a partir du quiz, et renvoie le host avec son PIN. */
  static async open(context: BrowserContext, quiz: Quiz): Promise<HostConsole> {
    const page = await context.newPage();
    await page.goto('/host.html');
    await page.locator('#quiz').fill(JSON.stringify(quiz, null, 2));
    await page.getByRole('button', { name: 'Creer la partie' }).click();

    const pinEl = page.locator('#pin');
    await expect(pinEl).toHaveText(/^\d{6}$/);
    const pin = (await pinEl.textContent())!.trim();
    return new HostConsole(page, pin);
  }

  get action(): Locator {
    return this.page.locator('#action');
  }
  get status(): Locator {
    return this.page.locator('#status');
  }
  get heading(): Locator {
    return this.page.locator('#heading');
  }
  /** Bloc d invitation du lobby : QR code + lien en clair. */
  get invite(): Locator {
    return this.page.locator('#invite');
  }
  get qr(): Locator {
    return this.page.locator('#qr svg');
  }
  get joinUrl(): Locator {
    return this.page.locator('#join-url');
  }
  get playerChips(): Locator {
    return this.page.locator('#players .chip');
  }
  /** Lignes du classement, dans l ordre affiche : "1. Alice" / "315". */
  get boardRows(): Locator {
    return this.page.locator('#board tr');
  }

  /** Lance la partie. Le bouton reste `disabled` tant qu aucun joueur n a rejoint. */
  async start(): Promise<void> {
    await expect(this.action).toHaveAttribute('data-action', 'start');
    await this.action.click(); // Playwright attend l etat `enabled` tout seul
  }

  /** Passe a la question suivante, ou affiche le podium apres la derniere. */
  async next(): Promise<void> {
    await expect(this.action).toHaveAttribute('data-action', 'next');
    await this.action.click();
  }

  /** Marches du podium devoilees, affichees dans l ordre visuel 2e / 1re / 3e. */
  get podiumRevealed(): Locator {
    return this.page.locator('#podium .step.revealed');
  }

  /** Devoile la marche suivante du podium (3e, puis 2e, puis 1re). */
  async revealPodium(): Promise<void> {
    await expect(this.action).toHaveAttribute('data-action', 'reveal_podium');
    await this.action.click();
  }

  /** Attend que le serveur ait enregistre `count` reponses pour la question en cours. */
  async waitForAnswers(count: number): Promise<void> {
    await expect(this.status).toHaveText(`${count} reponse(s)`);
  }

  /** Attend que `count` joueurs soient annonces connectes dans le lobby. */
  async waitForPlayers(count: number): Promise<void> {
    await expect(this.status).toHaveText(`${count} joueur(s) connecte(s)`);
  }
}
