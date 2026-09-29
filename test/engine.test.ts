import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/games.ts';
import { GameError } from '../src/types.ts';
import type { Conn, Game } from '../src/types.ts';

const QUIZ = {
  title: 'Test',
  questions: [
    { text: 'Q1', choices: ['a', 'b'], correctIndex: 0, timeLimitSec: 20 },
    { text: 'Q2', choices: ['a', 'b', 'c'], correctIndex: 2, timeLimitSec: 10 },
  ],
};

/** Connexion factice qui enregistre tout ce que le serveur lui envoie. */
function fakeConn(role: 'host' | 'player', playerId: string | null = null) {
  const received: any[] = [];
  const conn: Conn & { received: any[]; last(type: string): any } = {
    role,
    playerId,
    received,
    send: (payload) => void received.push(payload),
    close: () => {},
    last: (type) => [...received].reverse().find((m) => m.type === type),
  };
  return conn;
}

function setup(quiz: unknown = QUIZ) {
  const { pin, hostToken } = engine.createGame(quiz);
  const game = engine.getGame(pin);
  const host = fakeConn('host');
  engine.attach(game, host);
  return { pin, hostToken, game, host };
}

function addPlayer(game: Game, nickname: string) {
  const { playerId } = engine.joinGame(game.pin, nickname);
  const conn = fakeConn('player', playerId);
  engine.attach(game, conn);
  return { playerId, conn };
}

beforeEach(() => {
  for (const game of [...engine._registry().values()]) engine.destroyGame(game);
});

test('deux parties en parallele restent isolees', () => {
  const a = setup();
  const b = setup();

  assert.notEqual(a.pin, b.pin);

  const alice = addPlayer(a.game, 'alice');
  addPlayer(b.game, 'bob');

  engine.startGame(a.game);
  engine.submitAnswer(a.game, alice.playerId, 0);

  assert.equal(a.game.state, 'reveal');
  assert.equal(b.game.state, 'lobby', 'la partie B ne doit pas bouger');
  assert.equal(b.game.players.size, 1);
  assert.equal([...b.game.players.values()][0]?.score, 0);
});

test('repondre juste plus vite rapporte strictement plus de points', () => {
  assert.ok(engine.awardPoints(0, 20) > engine.awardPoints(5_000, 20));
  assert.equal(engine.awardPoints(0, 20), 1000);
  assert.equal(engine.awardPoints(20_000, 20), 100, 'plancher a 100 points');
});

test('une mauvaise reponse ne rapporte rien et la question se cloture quand tous ont repondu', () => {
  const { game } = setup();
  const alice = addPlayer(game, 'alice');
  const bob = addPlayer(game, 'bob');

  engine.startGame(game);
  engine.submitAnswer(game, alice.playerId, 0); // juste
  assert.equal(game.state, 'question', 'bob n a pas encore repondu');

  engine.submitAnswer(game, bob.playerId, 1); // faux
  assert.equal(game.state, 'reveal', 'cloture anticipee');

  assert.ok((game.players.get(alice.playerId)?.score ?? 0) > 0);
  assert.equal(game.players.get(bob.playerId)?.score, 0);

  const ended = alice.conn.last('question_ended');
  assert.equal(ended.correctIndex, 0);
  assert.deepEqual(ended.counts, [1, 1]);
});

test('en fin de question, chaque joueur recoit sa place et son ecart avec le joueur devant', () => {
  const { game, host } = setup();
  const alice = addPlayer(game, 'alice');
  const bob = addPlayer(game, 'bob');

  engine.startGame(game);
  engine.submitAnswer(game, alice.playerId, 0); // juste
  engine.submitAnswer(game, bob.playerId, 1); // faux

  const aliceScore = game.players.get(alice.playerId)?.score ?? 0;
  const first = alice.conn.last('question_ended').standing;
  assert.equal(first.yourRank, 1);
  assert.equal(first.gapToAhead, null, 'en tete : personne devant');
  assert.equal(first.ranking, undefined, 'le classement reste a l animateur');

  const second = bob.conn.last('question_ended').standing;
  assert.equal(second.yourRank, 2);
  assert.equal(second.gapToAhead, aliceScore);
  assert.equal(second.aheadNickname, 'alice');

  assert.equal(host.last('question_ended').standing, null);

  // Un rafraichissement pendant le reveal renvoie le meme classement.
  const back = fakeConn('player', bob.playerId);
  engine.attach(game, back);
  assert.deepEqual(back.last('state_sync').standing, second);
});

test('une seule reponse par joueur et par question', () => {
  const { game } = setup();
  const alice = addPlayer(game, 'alice');
  addPlayer(game, 'bob'); // evite la cloture anticipee

  engine.startGame(game);
  engine.submitAnswer(game, alice.playerId, 0);

  assert.throws(
    () => engine.submitAnswer(game, alice.playerId, 1),
    (err: GameError) => err.code === 'ALREADY_ANSWERED',
  );
});

test('le chrono cloture la question meme sans reponse', () => {
  const { game } = setup();
  const alice = addPlayer(game, 'alice');

  engine.startGame(game);
  engine.endQuestion(game); // simule l expiration du timer

  assert.equal(game.state, 'reveal');
  assert.equal(game.players.get(alice.playerId)?.score, 0);
  assert.equal(alice.conn.last('question_ended').yourPoints, 0);
});

test('un joueur qui se reconnecte retrouve son score et l etat courant', () => {
  const { game } = setup();
  const alice = addPlayer(game, 'alice');
  const bob = addPlayer(game, 'bob');

  engine.startGame(game);
  engine.submitAnswer(game, alice.playerId, 0);
  engine.submitAnswer(game, bob.playerId, 1);
  engine.nextQuestion(game);

  engine.detach(game, alice.conn);
  const back = fakeConn('player', alice.playerId);
  engine.attach(game, back);

  const sync = back.last('state_sync');
  assert.equal(sync.state, 'question');
  assert.equal(sync.index, 1);
  assert.ok(sync.yourScore > 0);
  assert.equal(sync.alreadyAnswered, false);
  assert.ok(sync.question.remainingMs > 0);
});

test('le parcours complet mene au podium', () => {
  const { game, host } = setup();
  const alice = addPlayer(game, 'alice');
  const bob = addPlayer(game, 'bob');

  engine.startGame(game);
  engine.submitAnswer(game, alice.playerId, 0);
  engine.submitAnswer(game, bob.playerId, 1);
  engine.nextQuestion(game);
  engine.submitAnswer(game, alice.playerId, 2);
  engine.submitAnswer(game, bob.playerId, 0);
  engine.nextQuestion(game);

  assert.equal(game.state, 'ended');
  const ended = host.last('game_ended');
  assert.equal(ended.podiumSize, 2, 'deux joueurs : deux marches');
  assert.deepEqual(ended.podium, [], 'rien n est devoile avant l animateur');

  engine.revealPodium(game);
  engine.revealPodium(game);
  const podium = bob.conn.last('podium_revealed').podium;
  assert.deepEqual(podium.map((e: any) => [e.place, e.nickname]), [[1, 'alice'], [2, 'bob']]);
  assert.deepEqual(alice.conn.last('podium_revealed'), host.last('podium_revealed'), 'meme affichage partout');
});

test('le podium se devoile une marche a la fois, de la 3e a la 1re, par l animateur', () => {
  const { game, host } = setup({ title: 'Podium', questions: [QUIZ.questions[0]] });
  const players = ['alice', 'bob', 'carol', 'dave'].map((n) => addPlayer(game, n));

  engine.startGame(game);
  // Plus on repond tard, moins on marque : alice > bob > carol > dave.
  for (const [i, p] of players.entries()) {
    game.questionStartedAt = Date.now() - i * 2_000;
    engine.submitAnswer(game, p.playerId, 0);
  }
  engine.nextQuestion(game);

  assert.equal(host.last('game_ended').podiumSize, 3, 'seul le top 3 est au podium');
  assert.equal(host.last('game_ended').leaderboard, undefined, 'le classement ne devoile rien');

  engine.revealPodium(game);
  assert.deepEqual(host.last('podium_revealed').podium.map((e: any) => e.nickname), ['carol']);
  engine.revealPodium(game);
  assert.deepEqual(host.last('podium_revealed').podium.map((e: any) => e.nickname), ['bob', 'carol']);

  // Un joueur qui se reconnecte en cours de devoilement n en voit pas plus que les autres.
  const back = fakeConn('player', players[0]!.playerId);
  engine.attach(game, back);
  const sync = back.last('state_sync');
  assert.deepEqual(sync.podium.map((e: any) => e.nickname), ['bob', 'carol']);
  assert.equal(sync.leaderboard, null);

  engine.revealPodium(game);
  assert.deepEqual(
    host.last('podium_revealed').podium.map((e: any) => [e.place, e.nickname]),
    [[1, 'alice'], [2, 'bob'], [3, 'carol']],
  );
  assert.throws(() => engine.revealPodium(game), (err: GameError) => err.code === 'BAD_STATE');
});

test('seul l animateur recoit le classement', () => {
  const { game, host } = setup();
  const alice = addPlayer(game, 'alice');

  engine.startGame(game);
  engine.submitAnswer(game, alice.playerId, 0);

  assert.equal(host.last('question_ended').leaderboard.length, 1);
  assert.equal(alice.conn.last('question_ended').leaderboard, null);
});

test('rejoindre : pseudo unique, lobby uniquement, PIN existant', () => {
  const { game } = setup();
  engine.joinGame(game.pin, 'alice');

  assert.throws(
    () => engine.joinGame(game.pin, 'Alice'),
    (err: GameError) => err.code === 'NICKNAME_TAKEN',
  );
  assert.throws(
    () => engine.joinGame('000000', 'bob'),
    (err: GameError) => err.code === 'GAME_NOT_FOUND',
  );

  engine.startGame(game);
  assert.throws(
    () => engine.joinGame(game.pin, 'bob'),
    (err: GameError) => err.code === 'GAME_ALREADY_STARTED',
  );
});

test('un quiz invalide est rejete', () => {
  assert.throws(() => engine.validateQuiz({ title: '', questions: [] }));
  assert.throws(() => engine.validateQuiz({ title: 'x', questions: [{ text: 'q', choices: ['a'], correctIndex: 0 }] }));
  assert.throws(() =>
    engine.validateQuiz({ title: 'x', questions: [{ text: 'q', choices: ['a', 'b'], correctIndex: 2 }] }),
  );
  const ok = engine.validateQuiz({ title: 'x', questions: [{ text: 'q', choices: ['a', 'b'], correctIndex: 1 }] });
  assert.equal(ok.questions[0]?.timeLimitSec, 20, 'valeur par defaut');
});

test('authenticate distingue host, joueur et token inconnu', () => {
  const { game, pin, hostToken } = setup();
  const { playerToken } = engine.joinGame(pin, 'alice');

  assert.equal(engine.authenticate(pin, hostToken)?.role, 'host');
  assert.equal(engine.authenticate(pin, playerToken)?.role, 'player');
  assert.equal(engine.authenticate(pin, 'nope'), null);
  assert.equal(engine.authenticate('000000', hostToken), null);
  assert.ok(game);
});

test('le balayage supprime les parties terminees, inactives ou sans animateur', () => {
  const ended = setup();
  addPlayer(ended.game, 'alice');
  engine.startGame(ended.game);
  engine.endQuestion(ended.game);
  engine.nextQuestion(ended.game);
  engine.endQuestion(ended.game);
  engine.nextQuestion(ended.game);
  assert.equal(ended.game.state, 'ended');

  const idle = setup();
  const orphan = setup();
  engine.detach(orphan.game, orphan.host);

  const now = Date.now();
  assert.deepEqual(engine.sweep(now), [], 'rien a nettoyer tout de suite');

  assert.deepEqual(engine.sweep(now + engine.HOST_GONE_TTL + 1_000), [orphan.pin]);
  assert.deepEqual(engine.sweep(now + engine.ENDED_TTL + 1_000), [ended.pin]);
  assert.deepEqual(engine.sweep(now + engine.IDLE_TTL + 1_000), [idle.pin]);
  assert.equal(engine._registry().size, 0);
});

test('le PIN d une partie detruite redevient introuvable', () => {
  const { game, pin } = setup();
  engine.destroyGame(game);
  assert.throws(
    () => engine.getGame(pin),
    (err: GameError) => err.code === 'GAME_NOT_FOUND',
  );
});
