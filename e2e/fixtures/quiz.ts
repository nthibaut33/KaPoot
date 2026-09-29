export type Question = {
  text: string;
  choices: string[];
  correctIndex: number;
  timeLimitSec: number;
};

export type Quiz = { title: string; questions: Question[] };

/**
 * Quiz deterministe pour les tests.
 *
 * Le chrono par defaut (20 s) est volontairement large : une question doit se terminer
 * parce que **tous les joueurs connectes ont repondu** (cf. `maybeEndQuestion` dans
 * `src/games.ts`), jamais parce que le temps a expire pendant que Playwright cliquait.
 * Pour tester explicitement l expiration, passer un `timeLimitSec` court.
 */
export function makeQuiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    title: 'Quiz e2e',
    questions: [
      {
        text: 'Quelle est la capitale de la France ?',
        choices: ['Lyon', 'Paris', 'Marseille', 'Lille'],
        correctIndex: 1,
        timeLimitSec: 20,
      },
    ],
    ...overrides,
  };
}
