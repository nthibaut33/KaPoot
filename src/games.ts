import { randomInt, randomUUID } from 'node:crypto';
import { GameError } from './types.ts';
import type { Answer, Conn, Game, LeaderboardEntry, Player, PodiumEntry, Question, Quiz } from './types.ts';

export const MAX_PLAYERS = 100;
export const MAX_POINTS = 1000;
export const MIN_POINTS = 100;
export const PODIUM_SIZE = 3;

/** Delais de nettoyage (ms). */
export const ENDED_TTL = 5 * 60_000;
export const IDLE_TTL = 60 * 60_000;
export const HOST_GONE_TTL = 2 * 60_000;
export const SWEEP_INTERVAL = 60_000;

/** Registre global : seule source de verite, perdue au redemarrage. */
const games = new Map<string, Game>();

// --- Validation ------------------------------------------------------------

function fail(code: string, status: number, message: string): never {
  throw new GameError(code, status, message);
}

export function validateQuiz(raw: unknown): Quiz {
  const quiz = raw as Partial<Quiz> | null;
  if (!quiz || typeof quiz !== 'object') fail('INVALID_QUIZ', 400, 'Quiz manquant');

  const title = typeof quiz.title === 'string' ? quiz.title.trim() : '';
  if (!title || title.length > 80) fail('INVALID_QUIZ', 400, 'Titre invalide (1 a 80 caracteres)');

  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    fail('INVALID_QUIZ', 400, 'Le quiz doit contenir au moins une question');
  }
  if (quiz.questions.length > 50) fail('INVALID_QUIZ', 400, 'Maximum 50 questions');

  const questions: Question[] = quiz.questions.map((q: unknown, i: number) => {
    const at = `Question ${i + 1}`;
    const src = q as Partial<Question> | null;
    if (!src || typeof src !== 'object') fail('INVALID_QUIZ', 400, `${at} : format invalide`);

    const text = typeof src.text === 'string' ? src.text.trim() : '';
    if (!text || text.length > 200) fail('INVALID_QUIZ', 400, `${at} : intitule invalide`);

    if (!Array.isArray(src.choices) || src.choices.length < 2 || src.choices.length > 4) {
      fail('INVALID_QUIZ', 400, `${at} : il faut 2 a 4 reponses`);
    }
    const choices = src.choices.map((c: unknown) => {
      const value = typeof c === 'string' ? c.trim() : '';
      if (!value || value.length > 100) fail('INVALID_QUIZ', 400, `${at} : reponse invalide`);
      return value;
    });

    const correctIndex = src.correctIndex;
    if (
      !Number.isInteger(correctIndex) ||
      (correctIndex as number) < 0 ||
      (correctIndex as number) >= choices.length
    ) {
      fail('INVALID_QUIZ', 400, `${at} : correctIndex hors limites`);
    }

    const timeLimitSec = src.timeLimitSec ?? 20;
    if (!Number.isInteger(timeLimitSec) || timeLimitSec < 5 || timeLimitSec > 120) {
      fail('INVALID_QUIZ', 400, `${at} : timeLimitSec doit etre entre 5 et 120`);
    }

    return { text, choices, correctIndex: correctIndex as number, timeLimitSec };
  });

  return { title, questions };
}

function validateNickname(nickname: unknown): string {
  const value = typeof nickname === 'string' ? nickname.trim() : '';
  if (!value || value.length > 20) fail('INVALID_NICKNAME', 400, 'Pseudo invalide (1 a 20 caracteres)');
  return value;
}

// --- Cycle de vie ----------------------------------------------------------

function newPin(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    if (!games.has(pin)) return pin;
  }
  fail('NO_PIN_AVAILABLE', 503, 'Impossible d allouer un PIN, reessayez');
}

export function createGame(rawQuiz: unknown): { pin: string; hostToken: string } {
  const quiz = validateQuiz(rawQuiz);
  const now = Date.now();
  const game: Game = {
    pin: newPin(),
    hostToken: randomUUID(),
    quiz,
    state: 'lobby',
    currentIndex: -1,
    questionStartedAt: null,
    players: new Map(),
    answers: new Map(),
    conns: new Set(),
    createdAt: now,
    lastActivityAt: now,
    hostDisconnectedAt: null,
    timer: null,
    podiumRevealed: 0,
  };
  games.set(game.pin, game);
  return { pin: game.pin, hostToken: game.hostToken };
}

export function getGame(pin: string): Game {
  const game = games.get(pin);
  if (!game) fail('GAME_NOT_FOUND', 404, 'Aucune partie avec ce PIN');
  return game;
}

export function publicInfo(pin: string) {
  const game = getGame(pin);
  return {
    pin: game.pin,
    state: game.state,
    title: game.quiz.title,
    playerCount: game.players.size,
    questionCount: game.quiz.questions.length,
  };
}

export function joinGame(pin: string, rawNickname: unknown): { playerId: string; playerToken: string } {
  const game = getGame(pin);
  const nickname = validateNickname(rawNickname);

  if (game.state !== 'lobby') fail('GAME_ALREADY_STARTED', 409, 'La partie a deja commence');
  if (game.players.size >= MAX_PLAYERS) fail('GAME_FULL', 429, 'Partie complete');
  for (const player of game.players.values()) {
    if (player.nickname.toLowerCase() === nickname.toLowerCase()) {
      fail('NICKNAME_TAKEN', 409, 'Ce pseudo est deja pris');
    }
  }

  const player: Player = {
    id: randomUUID(),
    token: randomUUID(),
    nickname,
    score: 0,
    connected: false,
  };
  game.players.set(player.id, player);
  touch(game);
  broadcast(game, { type: 'player_joined', nickname, playerCount: game.players.size });
  return { playerId: player.id, playerToken: player.token };
}

function touch(game: Game): void {
  game.lastActivityAt = Date.now();
}

export function destroyGame(game: Game): void {
  if (game.timer) clearTimeout(game.timer);
  game.timer = null;
  for (const conn of game.conns) conn.close(4404, 'game_closed');
  game.conns.clear();
  games.delete(game.pin);
}

// --- Connexions ------------------------------------------------------------

/** Resout un token en role. Retourne null si le token est inconnu. */
export function authenticate(
  pin: string,
  token: string,
): { role: 'host' | 'player'; playerId: string | null } | null {
  const game = games.get(pin);
  if (!game) return null;
  if (token === game.hostToken) return { role: 'host', playerId: null };
  for (const player of game.players.values()) {
    if (player.token === token) return { role: 'player', playerId: player.id };
  }
  return null;
}

export function attach(game: Game, conn: Conn): void {
  game.conns.add(conn);
  if (conn.role === 'host') {
    game.hostDisconnectedAt = null;
  } else if (conn.playerId) {
    const player = game.players.get(conn.playerId);
    if (player) player.connected = true;
  }
  touch(game);
  conn.send(stateSync(game, conn));
}

export function detach(game: Game, conn: Conn): void {
  game.conns.delete(conn);
  if (conn.role === 'host') {
    game.hostDisconnectedAt = Date.now();
    return;
  }
  if (!conn.playerId) return;
  const player = game.players.get(conn.playerId);
  if (!player) return;
  player.connected = false;
  broadcast(game, { type: 'player_left', nickname: player.nickname, playerCount: game.players.size });
  // Le depart du dernier joueur attendu peut cloturer la question.
  if (game.state === 'question') maybeEndQuestion(game);
}

// --- Diffusion -------------------------------------------------------------

function broadcast(game: Game, payload: unknown): void {
  for (const conn of game.conns) conn.send(payload);
}

/** Diffuse un message dont le contenu depend du destinataire. */
function broadcastPersonalized(game: Game, build: (conn: Conn) => unknown): void {
  for (const conn of game.conns) conn.send(build(conn));
}

function ordered(game: Game): Player[] {
  return [...game.players.values()].sort(
    (a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname),
  );
}

export function leaderboard(game: Game, limit = 5): LeaderboardEntry[] {
  return ordered(game)
    .slice(0, limit)
    .map((p) => ({ nickname: p.nickname, score: p.score }));
}

function rankOf(game: Game, playerId: string | null): number | null {
  if (!playerId) return null;
  const index = ordered(game).findIndex((p) => p.id === playerId);
  return index === -1 ? null : index + 1;
}

/** Place du joueur et ecart au joueur juste devant (null si en tete). Le classement reste a l animateur. */
function standingOf(game: Game, playerId: string | null) {
  if (!playerId) return null;
  const all = ordered(game);
  const index = all.findIndex((p) => p.id === playerId);
  const me = all[index];
  if (!me) return null;
  const ahead = all[index - 1];
  return {
    yourRank: index + 1,
    gapToAhead: ahead ? ahead.score - me.score : null,
    aheadNickname: ahead?.nickname ?? null,
  };
}

function scoreOf(game: Game, playerId: string | null): number | null {
  if (!playerId) return null;
  return game.players.get(playerId)?.score ?? null;
}

/**
 * Podium tel que devoile a l instant : les marches se revelent de la derniere a la premiere,
 * et seules les marches devoilees quittent le serveur, pour garder le suspense.
 */
function podiumPayload(game: Game): { podiumSize: number; podium: PodiumEntry[] } {
  const top = ordered(game).slice(0, PODIUM_SIZE);
  const podium = top
    .map((p, i) => ({ place: i + 1, nickname: p.nickname, score: p.score }))
    .slice(top.length - game.podiumRevealed);
  return { podiumSize: top.length, podium };
}

function currentQuestion(game: Game): Question | null {
  return game.quiz.questions[game.currentIndex] ?? null;
}

function revealPayload(game: Game, question: Question) {
  const counts = question.choices.map(() => 0);
  for (const answer of game.answers.values()) {
    const at = counts[answer.choiceIndex];
    if (at !== undefined) counts[answer.choiceIndex] = at + 1;
  }
  return { correctIndex: question.correctIndex, counts };
}

/** Le classement n est envoye qu a l animateur. */
function leaderboardFor(game: Game, conn: Conn): LeaderboardEntry[] | null {
  return conn.role === 'host' ? leaderboard(game) : null;
}

function stateSync(game: Game, conn: Conn): unknown {
  const question = currentQuestion(game);
  const base = {
    type: 'state_sync',
    role: conn.role,
    state: game.state,
    title: game.quiz.title,
    pin: game.pin,
    index: game.currentIndex,
    total: game.quiz.questions.length,
    playerCount: game.players.size,
    players: [...game.players.values()].map((p) => p.nickname),
    yourScore: scoreOf(game, conn.playerId),
    leaderboard: leaderboardFor(game, conn),
  };

  if (game.state === 'question' && question && game.questionStartedAt !== null) {
    const elapsed = Date.now() - game.questionStartedAt;
    return {
      ...base,
      question: {
        text: question.text,
        choices: question.choices,
        timeLimitSec: question.timeLimitSec,
        remainingMs: Math.max(0, question.timeLimitSec * 1000 - elapsed),
      },
      alreadyAnswered: conn.playerId ? game.answers.has(conn.playerId) : false,
      answeredCount: game.answers.size,
    };
  }

  if (game.state === 'reveal' && question) {
    return {
      ...base,
      reveal: { ...revealPayload(game, question), leaderboard: leaderboardFor(game, conn) },
      isLast: game.currentIndex === game.quiz.questions.length - 1,
      yourRank: rankOf(game, conn.playerId),
      standing: standingOf(game, conn.playerId),
    };
  }

  if (game.state === 'ended') {
    // Meme en fin de partie, le classement complet devoilerait le podium avant l heure.
    return { ...base, leaderboard: null, ...podiumPayload(game) };
  }

  return base;
}

// --- Moteur de jeu ---------------------------------------------------------

export function startGame(game: Game): void {
  if (game.state !== 'lobby') fail('BAD_STATE', 409, 'La partie n est plus dans le lobby');
  if (game.players.size === 0) fail('NO_PLAYERS', 409, 'Aucun joueur dans le lobby');
  askQuestion(game, 0);
}

export function nextQuestion(game: Game): void {
  if (game.state !== 'reveal') fail('BAD_STATE', 409, 'Aucune question a enchainer');
  const next = game.currentIndex + 1;
  if (next >= game.quiz.questions.length) {
    endGame(game);
    return;
  }
  askQuestion(game, next);
}

function askQuestion(game: Game, index: number): void {
  const question = game.quiz.questions[index];
  if (!question) fail('BAD_STATE', 409, 'Question introuvable');

  if (game.timer) clearTimeout(game.timer);
  game.state = 'question';
  game.currentIndex = index;
  game.answers.clear();
  game.questionStartedAt = Date.now();
  touch(game);

  game.timer = setTimeout(() => endQuestion(game), question.timeLimitSec * 1000);

  broadcast(game, {
    type: 'question_started',
    index,
    total: game.quiz.questions.length,
    text: question.text,
    choices: question.choices,
    timeLimitSec: question.timeLimitSec,
    serverTime: game.questionStartedAt,
  });
}

export function submitAnswer(game: Game, playerId: string, choiceIndex: unknown): void {
  if (game.state !== 'question') fail('BAD_STATE', 409, 'Aucune question en cours');

  const question = currentQuestion(game);
  if (!question || game.questionStartedAt === null) fail('BAD_STATE', 409, 'Aucune question en cours');

  const player = game.players.get(playerId);
  if (!player) fail('PLAYER_NOT_FOUND', 404, 'Joueur inconnu');
  if (game.answers.has(playerId)) fail('ALREADY_ANSWERED', 409, 'Vous avez deja repondu');

  if (
    !Number.isInteger(choiceIndex) ||
    (choiceIndex as number) < 0 ||
    (choiceIndex as number) >= question.choices.length
  ) {
    fail('INVALID_CHOICE', 400, 'Reponse hors limites');
  }

  const index = choiceIndex as number;
  const elapsed = Date.now() - game.questionStartedAt;
  const points = index === question.correctIndex ? awardPoints(elapsed, question.timeLimitSec) : 0;

  const answer: Answer = { choiceIndex: index, answeredAtMs: elapsed, points };
  game.answers.set(playerId, answer);
  player.score += points;
  touch(game);

  broadcast(game, { type: 'answer_received', answeredCount: game.answers.size });
  maybeEndQuestion(game);
}

/** Points degressifs : 1000 au premier instant, plancher a 100. */
export function awardPoints(elapsedMs: number, timeLimitSec: number): number {
  const ratio = 1 - elapsedMs / (timeLimitSec * 1000);
  return Math.min(MAX_POINTS, Math.max(MIN_POINTS, Math.round(MAX_POINTS * ratio)));
}

/** Cloture anticipee : tous les joueurs connectes ont repondu. */
function maybeEndQuestion(game: Game): void {
  if (game.state !== 'question') return;
  const connected = [...game.players.values()].filter((p) => p.connected);
  if (connected.length === 0) return;
  if (connected.every((p) => game.answers.has(p.id))) endQuestion(game);
}

export function endQuestion(game: Game): void {
  if (game.state !== 'question') return;
  const question = currentQuestion(game);
  if (!question) return;

  if (game.timer) clearTimeout(game.timer);
  game.timer = null;
  game.state = 'reveal';
  game.questionStartedAt = null;
  touch(game);

  const reveal = revealPayload(game, question);
  const isLast = game.currentIndex === game.quiz.questions.length - 1;
  broadcastPersonalized(game, (conn) => ({
    type: 'question_ended',
    ...reveal,
    leaderboard: leaderboardFor(game, conn),
    isLast,
    yourScore: scoreOf(game, conn.playerId),
    yourPoints: conn.playerId ? (game.answers.get(conn.playerId)?.points ?? 0) : null,
    yourChoice: conn.playerId ? (game.answers.get(conn.playerId)?.choiceIndex ?? null) : null,
    standing: standingOf(game, conn.playerId),
  }));
}

export function endGame(game: Game): void {
  if (game.timer) clearTimeout(game.timer);
  game.timer = null;
  game.state = 'ended';
  game.questionStartedAt = null;
  game.podiumRevealed = 0;
  touch(game);

  const podium = podiumPayload(game);
  broadcastPersonalized(game, (conn) => ({
    type: 'game_ended',
    ...podium,
    yourScore: scoreOf(game, conn.playerId),
  }));
}

/** L animateur devoile la marche suivante du podium, de la derniere a la premiere. */
export function revealPodium(game: Game): void {
  if (game.state !== 'ended') fail('BAD_STATE', 409, 'La partie n est pas terminee');
  const { podiumSize } = podiumPayload(game);
  if (game.podiumRevealed >= podiumSize) fail('BAD_STATE', 409, 'Le podium est deja entierement devoile');

  game.podiumRevealed += 1;
  touch(game);
  broadcast(game, { type: 'podium_revealed', ...podiumPayload(game) });
}

// --- Nettoyage -------------------------------------------------------------

export function sweep(now = Date.now()): string[] {
  const removed: string[] = [];
  for (const game of [...games.values()]) {
    const endedTooLong = game.state === 'ended' && now - game.lastActivityAt > ENDED_TTL;
    const idleTooLong = now - game.lastActivityAt > IDLE_TTL;
    const hostGoneTooLong = game.hostDisconnectedAt !== null && now - game.hostDisconnectedAt > HOST_GONE_TTL;
    if (endedTooLong || idleTooLong || hostGoneTooLong) {
      destroyGame(game);
      removed.push(game.pin);
    }
  }
  return removed;
}

export function startSweeper(): NodeJS.Timeout {
  const timer = setInterval(() => sweep(), SWEEP_INTERVAL);
  timer.unref();
  return timer;
}

/** Acces au registre, pour les tests. */
export function _registry(): Map<string, Game> {
  return games;
}
