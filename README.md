# KaPoot

Clone minimal de Kahoot. **Tout vit en mémoire** : aucune base de données, aucun fichier. Un redémarrage du serveur efface toutes les parties. Plusieurs quiz tournent en parallèle, isolés par leur code PIN.

Les specs complètes sont dans [SPECS.md](SPECS.md).

## Démarrer

```bash
npm install
npm start            # http://localhost:3000  (PORT=xxxx pour changer)
```

Node 22.6+ requis : les fichiers `.ts` sont exécutés directement, sans étape de build.

| Commande | Effet |
|---|---|
| `npm start` | Lance le serveur |
| `npm run dev` | Idem avec rechargement à chaud |
| `npm test` | Tests du moteur de jeu |
| `npm run test:e2e` | Tests end-to-end multijoueurs (Playwright) |
| `npm run sandbox` | Ouvre une partie pour un testeur humain |
| `npm run typecheck` | Vérification TypeScript |

## Jouer

1. L'animateur ouvre `/host.html`, ajuste le quiz JSON (un exemple est pré-rempli) et crée la partie.
2. Les joueurs ouvrent `/`, saisissent le code PIN affiché et leur pseudo.
3. L'animateur démarre, puis enchaîne les questions depuis sa console.

Une question se termine quand le chrono expire **ou** quand tous les joueurs connectés ont répondu. Une bonne réponse rapporte entre 1000 et 100 points, dégressifs selon le temps de réaction.

## Architecture

```
src/types.ts    Types partagés + GameError
src/games.ts    Moteur : registre Map<pin, Game>, règles, diffusion
src/server.ts   HTTP (Express) + WebSocket (ws)
public/         Client : index (joueur), host.html, play.html
test/           Tests du moteur
e2e/            Tests end-to-end multijoueurs (Playwright)
```

Le moteur ne connaît pas les WebSockets : il manipule une interface `Conn` (`send` / `close`), ce qui permet de le tester sans serveur. `src/server.ts` branche les vraies sockets dessus.

Les tests e2e simulent plusieurs joueurs dans une même partie : un `BrowserContext` Playwright par participant (chacun a son propre `sessionStorage`, donc sa propre identité). Pour monter à plusieurs dizaines de joueurs, `e2e/fixtures/bot.ts` ouvre de vraies WebSockets sans navigateur.

## Tester à la main

`npm run sandbox` monte une partie réelle, ouvre la console animateur dans une vraie fenêtre et affiche dans le terminal le code PIN ainsi que les URL joignables depuis le réseau local :

```
  ┌─────────────────────┐
  │  Code PIN : 727132  │
  └─────────────────────┘

  Rejoindre depuis un navigateur ou un telephone :
    http://localhost:3100
    http://10.202.10.45:3100
```

Le testeur rejoint depuis son propre navigateur ou son téléphone et joue librement ; la session reste ouverte jusqu'à `Ctrl+C`. Rien n'est assertionné : c'est un bac à sable d'exploration, pas de la non-régression (il est d'ailleurs exclu de `npm run test:e2e`).

Pour remplir le lobby avec des joueurs fictifs :

```bash
KAPOOT_BOTS=5 npm run sandbox                          # 5 bots qui répondent juste
KAPOOT_BOTS=5 KAPOOT_BOT_ANSWER=never npm run sandbox  # 5 bots passifs : la question ira au bout du chrono
```

| Variable | Effet | Défaut |
|---|---|---|
| `KAPOOT_BOTS` | Nombre de joueurs fictifs (max 99) | `0` |
| `KAPOOT_BOT_ANSWER` | `correct`, `wrong` ou `never` | `correct` |
| `KAPOOT_BOT_DELAY_MS` | Délai de réponse des bots | `3000` |

Depuis un téléphone, le pare-feu Windows doit autoriser le port 3100 sur le réseau privé.

## Limites assumées

Un seul processus (l'état vit dans la heap, pas de scaling horizontal), pas de comptes, pas d'images dans les questions, QCM uniquement. Les parties sont nettoyées automatiquement : 5 min après la fin, 60 min d'inactivité, ou 2 min après la déconnexion de l'animateur.
