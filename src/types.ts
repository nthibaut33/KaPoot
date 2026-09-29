export interface Question {
  text: string;
  choices: string[];
  correctIndex: number;
  timeLimitSec: number;
}

export interface Quiz {
  title: string;
  questions: Question[];
}

export interface Player {
  id: string;
  token: string;
  nickname: string;
  score: number;
  connected: boolean;
}

export interface Answer {
  choiceIndex: number;
  answeredAtMs: number;
  points: number;
}

export type GameState = 'lobby' | 'question' | 'reveal' | 'ended';

/** Une connexion cliente. Abstrait le WebSocket pour garder le moteur testable. */
export interface Conn {
  role: 'host' | 'player';
  playerId: string | null;
  send(payload: unknown): void;
  close(code: number, reason: string): void;
}

export interface Game {
  pin: string;
  hostToken: string;
  quiz: Quiz;
  state: GameState;
  currentIndex: number;
  questionStartedAt: number | null;
  players: Map<string, Player>;
  answers: Map<string, Answer>;
  conns: Set<Conn>;
  createdAt: number;
  lastActivityAt: number;
  hostDisconnectedAt: number | null;
  timer: NodeJS.Timeout | null;
  /** Nombre de marches du podium deja devoilees par l animateur (etat `ended`). */
  podiumRevealed: number;
}

export interface PodiumEntry {
  place: number;
  nickname: string;
  score: number;
}

export interface LeaderboardEntry {
  nickname: string;
  score: number;
}

export class GameError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
