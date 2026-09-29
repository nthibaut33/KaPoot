import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { GameError } from './types.ts';
import type { Conn, Game } from './types.ts';
import * as engine from './games.ts';

const PORT = Number(process.env.PORT ?? 3000);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.use(express.json({ limit: '128kb' }));
app.use(express.static(publicDir));

function send(res: express.Response, run: () => unknown): void {
  try {
    res.json(run());
  } catch (err) {
    if (err instanceof GameError) {
      res.status(err.status).json({ code: err.code, message: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ code: 'INTERNAL', message: 'Erreur interne' });
  }
}

app.post('/api/games', (req, res) => {
  send(res, () => engine.createGame(req.body?.quiz));
});

app.post('/api/games/:pin/players', (req, res) => {
  send(res, () => engine.joinGame(req.params.pin, req.body?.nickname));
});

app.get('/api/games/:pin', (req, res) => {
  send(res, () => engine.publicInfo(req.params.pin));
});

// --- WebSocket -------------------------------------------------------------

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const pin = url.searchParams.get('pin') ?? '';
  const token = url.searchParams.get('token') ?? '';
  const identity = engine.authenticate(pin, token);
  if (!identity) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    bind(ws, engine.getGame(pin), identity);
  });
});

function bind(ws: WebSocket, game: Game, identity: { role: 'host' | 'player'; playerId: string | null }): void {
  const conn: Conn = {
    role: identity.role,
    playerId: identity.playerId,
    send(payload) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
    },
    close(code, reason) {
      try {
        ws.close(code, reason);
      } catch {
        ws.terminate();
      }
    },
  };

  engine.attach(game, conn);

  ws.on('message', (raw) => {
    let msg: { type?: string; choiceIndex?: unknown };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      conn.send({ type: 'error', code: 'BAD_MESSAGE', message: 'JSON invalide' });
      return;
    }

    try {
      handle(game, conn, msg);
    } catch (err) {
      if (err instanceof GameError) {
        conn.send({ type: 'error', code: err.code, message: err.message });
        return;
      }
      console.error(err);
      conn.send({ type: 'error', code: 'INTERNAL', message: 'Erreur interne' });
    }
  });

  ws.on('close', () => engine.detach(game, conn));
  ws.on('error', () => engine.detach(game, conn));
}

function handle(game: Game, conn: Conn, msg: { type?: string; choiceIndex?: unknown }): void {
  switch (msg.type) {
    case 'start':
      requireHost(conn);
      engine.startGame(game);
      return;
    case 'next':
      requireHost(conn);
      engine.nextQuestion(game);
      return;
    case 'reveal_podium':
      requireHost(conn);
      engine.revealPodium(game);
      return;
    case 'answer':
      if (conn.role !== 'player' || !conn.playerId) {
        throw new GameError('FORBIDDEN', 403, 'Reserve aux joueurs');
      }
      engine.submitAnswer(game, conn.playerId, msg.choiceIndex);
      return;
    default:
      throw new GameError('BAD_MESSAGE', 400, `Type de message inconnu : ${msg.type}`);
  }
}

function requireHost(conn: Conn): void {
  if (conn.role !== 'host') throw new GameError('FORBIDDEN', 403, "Reserve a l'animateur");
}

engine.startSweeper();

server.listen(PORT, () => {
  console.log(`KaPoot en ecoute sur http://localhost:${PORT}`);
});
