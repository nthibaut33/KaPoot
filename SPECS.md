# KaPoot — Spécifications

Clone minimal de Kahoot. **Tout est en mémoire et éphémère** : aucune base de données, aucun fichier persisté. Un redémarrage du serveur efface toutes les parties.

## 1. Objectif

Permettre à un animateur de lancer un quiz auquel des joueurs rejoignent depuis leur navigateur via un code PIN, répondent à des questions chronométrées, et voient un classement. **Plusieurs parties tournent en parallèle**, isolées par leur PIN.

## 2. Hypothèses de stack (à valider)

- Serveur : Node.js + TypeScript, HTTP (Express/Fastify) + WebSocket (`ws` ou Socket.IO).
- Client : page web unique par rôle (host / player), vanilla ou framework léger.
- Un seul processus serveur (pas de scaling horizontal — l'état vit dans la heap).

## 3. Rôles

| Rôle | Description |
|---|---|
| **Host** | Crée la partie, fournit le quiz, contrôle l'avancement (démarrer, question suivante), voit les stats. |
| **Player** | Rejoint via PIN + pseudo, répond, voit son score. |

Pas de compte, pas d'authentification. L'identité tient dans un token de session opaque renvoyé à la connexion.

## 4. Modèle de données (en mémoire)

```ts
type Quiz = {
  title: string
  questions: Question[]
}

type Question = {
  text: string
  choices: string[]        // 2 à 4 réponses
  correctIndex: number
  timeLimitSec: number     // défaut 20
}

type Game = {
  pin: string              // 6 chiffres, unique parmi les parties actives
  hostToken: string
  quiz: Quiz
  state: 'lobby' | 'question' | 'reveal' | 'ended'
  currentIndex: number     // -1 en lobby
  questionStartedAt: number | null   // epoch ms
  players: Map<playerId, Player>
  answers: Map<playerId, Answer>     // vidée à chaque nouvelle question
  createdAt: number
  lastActivityAt: number
}

type Player = { id: string; token: string; nickname: string; score: number; connected: boolean }
type Answer  = { choiceIndex: number; answeredAtMs: number; points: number }
```

Registre global : `Map<pin, Game>`. C'est la seule source de vérité.

## 5. Règles métier

**PIN** — 6 chiffres aléatoires, régénéré en cas de collision avec une partie active. Libéré à la fin de la partie.

**Pseudo** — 1 à 20 caractères, unique au sein d'une partie (sinon erreur `NICKNAME_TAKEN`).

**Rejoindre** — possible uniquement en état `lobby`. Limite : 100 joueurs par partie.

**Score** — une réponse juste rapporte des points dégressifs selon le temps :
```
points = round(1000 * (1 - elapsedMs / (timeLimitSec * 1000)))   // borné à [100, 1000]
```
Réponse fausse ou absente : 0 point. Une seule réponse par joueur et par question (la première compte).

**Fin de question** — quand le chrono expire *ou* quand tous les joueurs connectés ont répondu. Le serveur passe alors en `reveal` et diffuse la bonne réponse + le classement.

**Fin de partie** — après la dernière question : état `ended`. Le podium ne contient que les 3 premiers (moins s'il y a moins de joueurs). L'animateur le dévoile marche par marche, de la 3e à la 1re place. Tous les écrans (animateur et joueurs) affichent le même podium, au même rythme. Les marches pas encore dévoilées ne quittent pas le serveur.

**Classement** — il n'est envoyé qu'à l'animateur. Un joueur ne reçoit que sa place et son écart avec le joueur juste devant.

**Nettoyage** — une partie est supprimée du registre : 5 min après `ended`, ou après 60 min sans activité (`lastActivityAt`), ou si le host se déconnecte plus de 2 min. Un balayage périodique (toutes les 60 s) applique ces règles.

**Déconnexion joueur** — le joueur garde sa place et son score ; il peut revenir avec son token tant que la partie vit.

## 6. API HTTP

| Méthode | Route | Corps / Réponse |
|---|---|---|
| `POST` | `/api/games` | `{ quiz }` → `{ pin, hostToken }` |
| `POST` | `/api/games/:pin/players` | `{ nickname }` → `{ playerId, playerToken }` |
| `GET` | `/api/games/:pin` | → `{ state, title, playerCount, questionCount }` (infos publiques du lobby) |

Erreurs : `404 GAME_NOT_FOUND`, `409 NICKNAME_TAKEN`, `409 GAME_ALREADY_STARTED`, `400 INVALID_QUIZ`, `429 GAME_FULL`.

## 7. Protocole WebSocket

Connexion : `WS /ws?pin=<pin>&token=<hostToken|playerToken>`. Le serveur résout le rôle depuis le token et rattache la socket à la partie. Token invalide → fermeture immédiate (code 4401).

**Client → serveur**

| Message | Rôle | Effet |
|---|---|---|
| `{ type: 'start' }` | host | `lobby` → `question` (index 0) |
| `{ type: 'next' }` | host | `reveal` → question suivante, ou `ended` |
| `{ type: 'reveal_podium' }` | host | En `ended` : dévoile la marche suivante du podium (3e → 2e → 1re) |
| `{ type: 'answer', choiceIndex }` | player | Enregistre la réponse si l'état est `question` et qu'aucune réponse n'existe déjà |

**Serveur → clients** (diffusé à toute la partie sauf mention)

| Message | Contenu |
|---|---|
| `player_joined` / `player_left` | `{ nickname, playerCount }` |
| `question_started` | `{ index, total, text, choices, timeLimitSec, serverTime }` — *sans* `correctIndex` |
| `answer_received` | `{ answeredCount }` |
| `question_ended` | `{ correctIndex, counts: number[], leaderboard: Top5 (host) \| null (joueur), isLast, yourScore, yourPoints, yourChoice, standing }` (les champs `your*` et `standing` sont personnalisés par socket ; pour un joueur, `standing = { yourRank, gapToAhead, aheadNickname }` : sa place et l'écart en points avec le joueur juste devant, `null` si en tête ; `standing` vaut `null` pour le host. Le classement n'est affiché que chez l'animateur) |
| `game_ended` | `{ podiumSize, podium: [], yourScore }` — `podiumSize` = nombre de marches (≤ 3), rien n'est encore dévoilé |
| `podium_revealed` | `{ podiumSize, podium: { place, nickname, score }[] }` — marches dévoilées, triées par place |
| `error` | `{ code, message }` |

À la (re)connexion, le serveur envoie un `state_sync` : `{ role, state, title, pin, index, total, playerCount, players, yourScore, leaderboard }`, complété selon l'état par `question` (avec `remainingMs`), `reveal`, ou `podiumSize` + `podium` (marches déjà dévoilées). `leaderboard` vaut `null` pour un joueur, et pour tous en `ended`. Le client se recale entièrement dessus.

## 8. Contraintes de parallélisme

- Aucun état global partagé entre parties hormis le registre `Map<pin, Game>`.
- Un timer (`setTimeout`) par partie active pour la fin de question ; annulé si tous ont répondu.
- Node étant mono-thread, aucun verrou n'est nécessaire ; toute mutation d'état est synchrone.

## 9. Hors périmètre (v1)

Persistance, comptes utilisateurs, images/médias dans les questions, types de questions autres que QCM, édition collaborative de quiz, reconnexion du host sur une autre machine, internationalisation, scaling multi-process.

## 10. Critères d'acceptation

1. Deux parties lancées simultanément avec des PIN différents n'interfèrent pas (scores, questions, chronos indépendants).
2. Un joueur qui répond juste plus vite qu'un autre marque strictement plus de points.
3. Un joueur qui ne répond pas dans le temps imparti marque 0 et la question se termine quand même.
4. Un joueur qui rafraîchit sa page retrouve son score et l'état courant.
5. Redémarrer le serveur efface toutes les parties ; un PIN existant renvoie alors `GAME_NOT_FOUND`.
6. Une partie terminée disparaît du registre dans les 5 minutes.
