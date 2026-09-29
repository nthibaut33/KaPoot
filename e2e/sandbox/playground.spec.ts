import os from 'node:os';
import { spawnBots } from '../fixtures/bot';
import type { AnswerPolicy } from '../fixtures/bot';
import { makeQuiz, test } from '../fixtures/kapoot';

/**
 * Bac a sable pour testeur humain — PAS un test de non-regression.
 *
 * Monte une partie reelle, affiche le PIN et les URL joignables depuis le reseau local,
 * ouvre la console animateur dans une vraie fenetre, puis reste ouvert jusqu a Ctrl+C.
 * Le testeur rejoint depuis son navigateur ou son telephone et joue librement.
 *
 *   npm run sandbox                 # partie vide, le testeur joue seul
 *   KAPOOT_BOTS=5 npm run sandbox   # 5 joueurs fictifs pour remplir le lobby
 *
 * Variables d environnement :
 *   KAPOOT_BOTS          nombre de joueurs fictifs (defaut 0, max 99)
 *   KAPOOT_BOT_ANSWER    correct | wrong | never   (defaut correct)
 *   KAPOOT_BOT_DELAY_MS  delai de reponse des bots (defaut 3000)
 */

const QUIZ = makeQuiz({
  title: 'Session de test',
  questions: [
    {
      text: 'Quelle est la capitale de l Australie ?',
      choices: ['Sydney', 'Canberra', 'Melbourne', 'Perth'],
      correctIndex: 1,
      timeLimitSec: 20,
    },
    {
      text: 'Combien de cotes a un hexagone ?',
      choices: ['5', '6', '7', '8'],
      correctIndex: 1,
      timeLimitSec: 15,
    },
    {
      text: 'Qui a ecrit "Le Petit Prince" ?',
      choices: ['Camus', 'Saint-Exupery', 'Hugo', 'Proust'],
      correctIndex: 1,
      timeLimitSec: 20,
    },
  ],
});

/** Adresses IPv4 non-internes, pour rejoindre depuis un telephone sur le meme reseau. */
function lanHosts(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((ifaces) => ifaces ?? [])
    .filter((iface) => iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}

test('bac a sable : une partie ouverte pour un testeur humain', async ({ openHost, baseURL }) => {
  const port = new URL(baseURL!).port;
  const botCount = Math.min(Number(process.env.KAPOOT_BOTS ?? 0), 99);
  const botAnswer = (process.env.KAPOOT_BOT_ANSWER ?? 'correct') as AnswerPolicy;
  const botDelayMs = Number(process.env.KAPOOT_BOT_DELAY_MS ?? 3000);

  const host = await openHost(QUIZ);

  const bots =
    botCount > 0
      ? await spawnBots(baseURL!, host.pin, botCount, QUIZ, {
          answer: botAnswer,
          delayMs: botDelayMs,
        })
      : null;

  const urls = [baseURL!, ...lanHosts().map((ip) => `http://${ip}:${port}`)];
  const boxed = `  Code PIN : ${host.pin}  `;
  console.log(
    [
      '',
      `  ┌${'─'.repeat(boxed.length)}┐`,
      `  │${boxed}│`,
      `  └${'─'.repeat(boxed.length)}┘`,
      '',
      '  Rejoindre depuis un navigateur ou un telephone :',
      ...urls.map((url) => `    ${url}`),
      '',
      bots
        ? `  ${bots.nicknames.length} bot(s) dans le lobby (${botAnswer}, ${botDelayMs} ms) : ${bots.nicknames.join(', ')}`
        : '  Aucun bot. KAPOOT_BOTS=5 pour remplir le lobby.',
      '',
      '  La console animateur est la fenetre ouverte : c est la qu on demarre',
      '  la partie et qu on enchaine les questions.',
      '',
      '  Ctrl+C pour terminer la session.',
      '',
    ].join('\n'),
  );

  // Retour terminal sur ce que fait la partie, sans quitter des yeux son telephone.
  let previous = '';
  const poll = setInterval(async () => {
    try {
      const res = await fetch(`${baseURL}/api/games/${host.pin}`);
      if (!res.ok) return;
      const info = (await res.json()) as { state: string; playerCount: number };
      const line = `  [${info.state}] ${info.playerCount} joueur(s)`;
      if (line !== previous) {
        previous = line;
        console.log(line);
      }
    } catch {
      // Serveur coupe ou partie nettoyee : rien a signaler, le poll suivant reessaiera.
    }
  }, 2000);

  try {
    // La session vit jusqu a Ctrl+C (`timeout: 0` dans playwright.sandbox.config.ts).
    await new Promise<never>(() => {});
  } finally {
    clearInterval(poll);
    await bots?.close();
  }
});
