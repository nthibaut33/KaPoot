import { spawnBots } from './fixtures/bot';
import { expect, makeQuiz, test } from './fixtures/kapoot';

const QUIZ = makeQuiz();
const CORRECT = QUIZ.questions[0]!.correctIndex;

test('1 animateur + 2 joueurs : le plus rapide marque strictement plus de points', async ({
  openHost,
  joinPlayer,
}) => {
  // Trois BrowserContext distincts : chacun a son propre sessionStorage, donc sa propre
  // identite KaPoot. C est ce qui permet de simuler de vrais joueurs concurrents.
  const host = await openHost(QUIZ);

  const alice = await joinPlayer(host.pin, 'Alice');
  const bob = await joinPlayer(host.pin, 'Bob');

  // Le lobby de l animateur se met a jour en temps reel (broadcast `player_joined`).
  await host.waitForPlayers(2);
  await expect(host.playerChips).toHaveText(['Alice', 'Bob']);

  await host.start();

  // Les deux joueurs recoivent `question_started` et voient le meme enonce.
  for (const player of [alice, bob]) {
    await expect(player.question).toHaveText(QUIZ.questions[0]!.text);
    await expect(player.status).toHaveText('A vous de jouer !');
  }

  // Alice repond la premiere ; on attend l accuse de reception cote animateur avant de
  // laisser Bob repondre, ce qui garantit l ordre.
  await alice.answer(CORRECT);
  await host.waitForAnswers(1);

  // 300 ms sur un chrono de 20 s valent ~15 points : largement au-dessus du bruit
  // d arrondi de `awardPoints`, l ecart est donc deterministe.
  await bob.page.waitForTimeout(300);
  await bob.answer(CORRECT);

  // Tous les joueurs connectes ont repondu : la question se cloture sans attendre le chrono.
  await expect(host.status).toHaveText('Classement provisoire');
  await expect(alice.banner).toHaveText(/^Bravo ! \+\d+$/);
  await expect(bob.banner).toHaveText(/^Bravo ! \+\d+$/);

  // Classement de l animateur : Alice devant Bob.
  await expect(host.boardRows.first()).toContainText('1. Alice');
  await expect(host.boardRows.nth(1)).toContainText('2. Bob');

  const [aliceScore, bobScore] = [await alice.score(), await bob.score()];
  expect(aliceScore).toBeGreaterThan(bobScore);

  // Chaque joueur voit sa place et son ecart avec celui qui le precede...
  await expect(alice.gap).toHaveText('1e — Vous etes en tete !');
  const diff = aliceScore - bobScore;
  await expect(bob.gap).toHaveText(`2e — ${diff} pt${diff > 1 ? 's' : ''} derriere Alice`);
  // ...mais le classement reste reserve a l animateur.
  for (const player of [alice, bob]) {
    await expect(player.page.locator('table')).toHaveCount(0);
  }

  // Derniere question : le bouton passe a "Voir le podium".
  // Podium : meme ecran partout, rien n est devoile tant que l animateur n a pas clique.
  await host.next();
  const screens = [host, alice, bob];
  for (const screen of screens) {
    await expect(screen.heading).toHaveText('Podium');
    await expect(screen.podiumRevealed).toHaveCount(0);
  }
  await expect(host.action).toHaveText('Devoiler la 2e place'); // 2 joueurs : 2 marches

  await host.revealPodium();
  for (const screen of screens) {
    await expect(screen.podiumRevealed).toHaveCount(1);
    await expect(screen.podiumRevealed).toContainText(`Bob${bobScore} pts2e`);
  }

  await expect(host.action).toHaveText('Devoiler la 1re place');
  await host.revealPodium();
  for (const screen of screens) {
    // Ordre visuel : 2e a gauche, 1re au centre.
    await expect(screen.podiumRevealed).toHaveText([`Bob${bobScore} pts2e`, `Alice${aliceScore} pts1re`]);
  }
  await expect(host.action).toBeHidden();
  await expect(host.status).toHaveText('Partie terminee');
});

test('1 joueur reel + 8 bots WebSocket dans la meme partie', async ({ openHost, joinPlayer, baseURL }) => {
  const host = await openHost(QUIZ);

  const alice = await joinPlayer(host.pin, 'Alice');
  // Les figurants n ouvrent pas de navigateur : join HTTP + vraie socket, bien plus leger.
  const bots = await spawnBots(baseURL!, host.pin, 8, QUIZ, { answer: 'correct', delayMs: 500 });

  await host.waitForPlayers(9);
  await expect(host.playerChips).toHaveCount(9);

  await host.start();
  await expect(alice.question).toHaveText(QUIZ.questions[0]!.text);
  await alice.answer(CORRECT); // Alice passe devant les bots, qui attendent 500 ms

  // La question se cloture des que les 9 joueurs ont repondu, sans attendre le chrono.
  await expect(host.status).toHaveText('Classement provisoire');
  await expect(host.boardRows).toHaveCount(5); // le classement est un Top 5
  await expect(host.boardRows.first()).toContainText('1. Alice');

  await bots.close();
});
