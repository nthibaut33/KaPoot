import WebSocket from 'ws';
import type { Quiz } from './quiz';

export type AnswerPolicy = 'correct' | 'wrong' | 'never';

export type BotOptions = {
  /** Comportement face a une question. `never` : le bot ne repond jamais. */
  answer?: AnswerPolicy;
  /** Delai avant de repondre, en ms. Sert a placer les bots derriere les vrais joueurs. */
  delayMs?: number;
  /** Prefixe des pseudos generes. */
  prefix?: string;
};

export type BotSwarm = {
  nicknames: string[];
  close: () => Promise<void>;
};

/**
 * Fait rejoindre `count` joueurs "figurants" sans ouvrir de navigateur : appel HTTP de
 * join puis vraie connexion WebSocket. Permet de monter a plusieurs dizaines de joueurs
 * la ou un `BrowserContext` par joueur serait trop lourd.
 *
 * ATTENTION : une question se termine des que **tous les joueurs connectes** ont repondu
 * (`maybeEndQuestion`, `src/games.ts`). Un seul bot en `answer: 'never'` empeche donc la
 * cloture anticipee et force l attente du chrono — utile pour tester l expiration, mais
 * il faut le vouloir.
 *
 * Le moteur plafonne une partie a 100 joueurs (`joinGame`), bots compris.
 */
export async function spawnBots(
  baseURL: string,
  pin: string,
  count: number,
  quiz: Quiz,
  options: BotOptions = {},
): Promise<BotSwarm> {
  const { answer = 'correct', delayMs = 0, prefix = 'Bot' } = options;
  const wsBase = baseURL.replace(/^http/, 'ws');
  const sockets: WebSocket[] = [];
  const nicknames: string[] = [];
  const timers: NodeJS.Timeout[] = [];

  for (let i = 0; i < count; i++) {
    const nickname = `${prefix}${i + 1}`;
    const res = await fetch(`${baseURL}/api/games/${pin}/players`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname }),
    });
    if (!res.ok) throw new Error(`Join refuse pour ${nickname} : ${res.status} ${await res.text()}`);
    const { playerToken } = (await res.json()) as { playerToken: string };

    const ws = new WebSocket(`${wsBase}/ws?pin=${pin}&token=${playerToken}`);
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { type?: string; index?: number };
      if (msg.type !== 'question_started' || answer === 'never') return;

      const question = quiz.questions[msg.index ?? 0];
      if (!question) return;
      const choiceIndex =
        answer === 'correct'
          ? question.correctIndex
          : (question.correctIndex + 1) % question.choices.length;

      timers.push(
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'answer', choiceIndex }));
          }
        }, delayMs),
      );
    });

    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    sockets.push(ws);
    nicknames.push(nickname);
  }

  return {
    nicknames,
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      await Promise.all(
        sockets.map(
          (ws) =>
            new Promise<void>((resolve) => {
              ws.once('close', () => resolve());
              ws.close();
            }),
        ),
      );
    },
  };
}
