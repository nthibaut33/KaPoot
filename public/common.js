export const $ = (sel) => document.querySelector(sel);

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Erreur serveur');
  return data;
}

/** Sauvegarde la session dans le navigateur pour survivre a un rafraichissement. */
export const session = {
  save(role, data) {
    sessionStorage.setItem(`kapoot:${role}`, JSON.stringify(data));
  },
  load(role) {
    try {
      return JSON.parse(sessionStorage.getItem(`kapoot:${role}`) || 'null');
    } catch {
      return null;
    }
  },
  clear(role) {
    sessionStorage.removeItem(`kapoot:${role}`);
  },
};

/** Connexion WebSocket avec reconnexion automatique. */
export function connect(pin, token, onMessage, onClosed) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws;
  let retries = 0;
  let stopped = false;

  const open = () => {
    ws = new WebSocket(`${proto}://${location.host}/ws?pin=${pin}&token=${token}`);
    ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
    ws.onopen = () => {
      retries = 0;
    };
    ws.onclose = (ev) => {
      if (stopped) return;
      // 4404 : la partie a ete detruite cote serveur, inutile d insister.
      if (ev.code === 4404 || retries >= 5) {
        onClosed?.(ev);
        return;
      }
      retries += 1;
      setTimeout(open, 500 * retries);
    };
  };

  open();

  return {
    send: (payload) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(payload)),
    stop: () => {
      stopped = true;
      ws?.close();
    },
  };
}

/** Barre de progression du chrono, pilotee par l horloge locale. */
export function countdown(barEl, remainingMs, totalMs) {
  const deadline = Date.now() + remainingMs;
  const tick = () => {
    const left = Math.max(0, deadline - Date.now());
    barEl.style.width = `${(left / totalMs) * 100}%`;
    if (left > 0) raf = requestAnimationFrame(tick);
  };
  let raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function renderLeaderboard(tableEl, entries) {
  tableEl.innerHTML = entries
    .map(
      (e, i) =>
        `<tr><td>${i + 1}. ${escapeHtml(e.nickname)}</td><td>${e.score}</td></tr>`,
    )
    .join('');
}

/**
 * Podium commun a l animateur et aux joueurs : 2e a gauche, 1re au centre, 3e a droite.
 * Les marches pas encore devoilees restent masquees.
 */
export function renderPodium(el, { podium, podiumSize }) {
  const byPlace = new Map(podium.map((e) => [e.place, e]));
  // Les marches se devoilent de bas en haut : la plus haute devoilee est la derniere arrivee.
  const latest = podium[0]?.place;
  el.innerHTML = [2, 1, 3]
    .filter((place) => place <= podiumSize)
    .map((place) => {
      const e = byPlace.get(place);
      const label = place === 1 ? '1re' : `${place}e`;
      return e
        ? `<div class="step p${place} revealed${place === latest ? ' latest' : ''}" data-place="${place}">` +
            `<span class="who">${escapeHtml(e.nickname)}</span>` +
            `<span class="pts">${e.score} pts</span>` +
            `<span class="block">${label}</span></div>`
        : `<div class="step p${place}" data-place="${place}">` +
            `<span class="who">?</span><span class="block">${label}</span></div>`;
    })
    .join('');
}

/** Libelle de la prochaine place a devoiler, ou null si le podium est complet. */
export function nextPodiumPlace({ podium, podiumSize }) {
  const next = podiumSize - podium.length;
  return next >= 1 ? next : null;
}

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
