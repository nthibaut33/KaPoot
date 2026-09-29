import { expect } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';

/**
 * Ecran joueur (`public/index.html` pour rejoindre, puis `public/play.html`).
 *
 * L identite du joueur vit dans le `sessionStorage` de l onglet : chaque joueur simule
 * doit donc avoir son propre `BrowserContext`, sinon ils se marchent dessus.
 */
export class PlayerPage {
  readonly page: Page;
  readonly nickname: string;

  constructor(page: Page, nickname: string) {
    this.page = page;
    this.nickname = nickname;
  }

  /** Rejoint la partie depuis l accueil et attend l arrivee sur l ecran de jeu. */
  static async join(context: BrowserContext, pin: string, nickname: string): Promise<PlayerPage> {
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('#pin').fill(pin);
    await page.locator('#nickname').fill(nickname);
    await page.getByRole('button', { name: 'Rejoindre' }).click();
    await page.waitForURL('**/play.html');
    return new PlayerPage(page, nickname);
  }

  get heading(): Locator {
    return this.page.locator('#heading');
  }
  get question(): Locator {
    return this.page.locator('#question');
  }
  get status(): Locator {
    return this.page.locator('#status');
  }
  get banner(): Locator {
    return this.page.locator('.banner');
  }
  /** Place et ecart au joueur devant, affiches au reveal : "2e — 15 pts derriere Alice". */
  get gap(): Locator {
    return this.page.locator('#gap');
  }
  /** Marches du podium devoilees, identiques a celles de l animateur. */
  get podiumRevealed(): Locator {
    return this.page.locator('#podium .step.revealed');
  }
  get answers(): Locator {
    return this.page.locator('#answers .answer');
  }

  /**
   * Repond par l index du choix (l ordre du tableau `choices` du quiz).
   *
   * On verifie le verrouillage du bouton, pas `#status` : pour le dernier repondant, la
   * question se cloture aussitot (`maybeEndQuestion`) et le reveal remplace le message
   * "Reponse envoyee" avant qu on ait pu l observer. Les boutons, eux, restent desactives.
   */
  async answer(choiceIndex: number): Promise<void> {
    const choice = this.page.locator(`#answers .answer[data-i="${choiceIndex}"]`);
    await choice.click();
    await expect(choice).toBeDisabled();
  }

  /** Repond en cliquant sur le libelle de la reponse. */
  async answerLabeled(label: string): Promise<void> {
    const choice = this.page.locator('#answers').getByRole('button', { name: label });
    await choice.click();
    await expect(choice).toBeDisabled();
  }

  /** Score courant affiche, en points. -1 tant que rien n a ete diffuse. */
  async score(): Promise<number> {
    const text = (await this.page.locator('#score').textContent()) ?? '';
    const match = text.match(/(\d+)/);
    return match ? Number(match[1]) : -1;
  }
}
