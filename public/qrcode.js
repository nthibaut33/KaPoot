/**
 * Generateur de QR code minimal, sans dependance.
 * Mode octet, correction d erreur L, versions 1 a 6 (jusqu a 133 caracteres) :
 * largement suffisant pour une URL de partie.
 */

// --- Arithmetique dans GF(256) -------------------------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Polynome generateur de Reed-Solomon pour `degree` symboles de correction. */
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Symboles de correction d erreur d un bloc de donnees. */
function ecBytes(data, degree) {
  const gen = generatorPoly(degree);
  const rest = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rest.shift();
    rest.push(0);
    for (let i = 0; i < degree; i++) rest[i] ^= mul(gen[i + 1], factor);
  }
  return rest;
}

// --- Tables des versions (niveau de correction L) ------------------------
// capacity : octets de donnees ; ecPerBlock : symboles de correction par bloc.
const VERSIONS = [
  null,
  { capacity: 19, ecPerBlock: 7, blocks: 1 },
  { capacity: 34, ecPerBlock: 10, blocks: 1 },
  { capacity: 55, ecPerBlock: 15, blocks: 1 },
  { capacity: 80, ecPerBlock: 20, blocks: 1 },
  { capacity: 108, ecPerBlock: 26, blocks: 1 },
  { capacity: 136, ecPerBlock: 18, blocks: 2 },
];

// Centre du motif d alignement, absent en version 1.
const ALIGN_CENTER = [null, null, 18, 22, 26, 30, 34];

const MASKS = [
  (y, x) => (y + x) % 2 === 0,
  (y) => y % 2 === 0,
  (y, x) => x % 3 === 0,
  (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

/** Flux binaire : entete, donnees, terminateur et remplissage. */
function buildData(bytes, version) {
  const { capacity } = VERSIONS[version];
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // mode octet
  push(bytes.length, 8); // compteur sur 8 bits en versions 1 a 9
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity * 8 - bits.length)); // terminateur
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }
  for (let i = 0; data.length < capacity; i++) data.push(i % 2 === 0 ? 0xec : 0x11);
  return data;
}

/** Decoupe en blocs, calcule la correction et entrelace le tout. */
function interleave(data, version) {
  const { ecPerBlock, blocks } = VERSIONS[version];
  const size = data.length / blocks;
  const dataBlocks = [];
  const ecBlocks = [];
  for (let i = 0; i < blocks; i++) {
    const block = data.slice(i * size, (i + 1) * size);
    dataBlocks.push(block);
    ecBlocks.push(ecBytes(block, ecPerBlock));
  }

  const out = [];
  for (let i = 0; i < size; i++) for (const block of dataBlocks) out.push(block[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const block of ecBlocks) out.push(block[i]);
  return out;
}

/** Trame fixe : reperes, separateurs, alignement, synchronisation, zones reservees. */
function buildFrame(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const place = (y, x, dark) => {
    if (y < 0 || x < 0 || y >= size || x >= size) return;
    modules[y][x] = dark;
    reserved[y][x] = true;
  };

  for (const [oy, ox] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const ring = Math.max(Math.abs(y - 3), Math.abs(x - 3));
        place(oy + y, ox + x, ring !== 2 && ring <= 3);
      }
    }
  }

  const center = ALIGN_CENTER[version];
  if (center) {
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) {
        place(center + y, center + x, Math.max(Math.abs(y), Math.abs(x)) !== 1);
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    place(6, i, i % 2 === 0);
    place(i, 6, i % 2 === 0);
  }

  // Zones d information de format, remplies apres le choix du masque.
  // L indice 6 est saute : il appartient aux motifs de synchronisation.
  for (let i = 0; i < 9; i++) {
    if (i === 6) continue;
    place(8, i, false);
    place(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    place(8, size - 1 - i, false);
    place(size - 1 - i, 8, false);
  }
  place(size - 8, 8, true); // module toujours sombre

  return { modules, reserved, size };
}

/** Remplit la zone de donnees en zigzag, du bas a droite vers le haut. */
function placeData(modules, reserved, size, codewords) {
  let bit = 0;
  const nextBit = () => {
    const byte = codewords[bit >> 3];
    const value = byte === undefined ? 0 : (byte >> (7 - (bit & 7))) & 1;
    bit++;
    return value === 1;
  };

  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // la colonne 6 porte la synchronisation
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (!reserved[y][x]) modules[y][x] = nextBit();
      }
    }
    upward = !upward;
  }
}

function applyMask(modules, reserved, size, mask) {
  const fn = MASKS[mask];
  const out = modules.map((row) => row.slice());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!reserved[y][x] && fn(y, x)) out[y][x] = !out[y][x];
    }
  }
  return out;
}

/** Information de format : niveau L + masque, protege par un code BCH(15,5). */
function writeFormat(modules, size, mask) {
  const data = (0b01 << 3) | mask;
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
  }
  const bits = ((data << 10) | rem) ^ 0x5412;
  // Le bit de poids fort occupe la premiere position de chaque copie.
  const at = (i) => ((bits >> (14 - i)) & 1) === 1;

  for (let i = 0; i <= 5; i++) modules[8][i] = at(i);
  modules[8][7] = at(6);
  modules[8][8] = at(7);
  modules[7][8] = at(8);
  for (let i = 9; i <= 14; i++) modules[14 - i][8] = at(i);

  for (let i = 0; i <= 7; i++) modules[size - 1 - i][8] = at(i);
  for (let i = 8; i <= 14; i++) modules[8][size - 15 + i] = at(i);
}

/** Score de penalite standard : plus il est bas, plus le code est lisible. */
function penalty(modules, size) {
  let score = 0;
  let dark = 0;

  const runScore = (line) => {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  };

  for (let i = 0; i < size; i++) {
    runScore(modules[i]);
    runScore(modules.map((row) => row[i]));
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) dark++;
      if (y + 1 < size && x + 1 < size) {
        const v = modules[y][x];
        if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) score += 3;
      }
    }
  }

  score += 10 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5);
  return score;
}

/**
 * Matrice de booleens (true = module sombre) encodant `text`.
 * Leve une erreur si le texte depasse la capacite de la version 6.
 */
export function encodeQr(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = VERSIONS.findIndex((v, i) => i > 0 && bytes.length + 2 <= v.capacity);
  if (version < 1) throw new Error('Texte trop long pour un QR code');

  const codewords = interleave(buildData(bytes, version), version);
  const { modules, reserved, size } = buildFrame(version);
  placeData(modules, reserved, size, codewords);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMask(modules, reserved, size, mask);
    writeFormat(candidate, size, mask);
    const score = penalty(candidate, size);
    if (!best || score < best.score) best = { score, modules: candidate };
  }
  return best.modules;
}

/** QR code en SVG, avec la marge claire de 4 modules exigee par la norme. */
export function qrSvg(text, { quietZone = 4 } = {}) {
  const modules = encodeQr(text);
  const size = modules.length;
  const total = size + quietZone * 2;
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) path += `M${x + quietZone} ${y + quietZone}h1v1h-1z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/>` +
    '</svg>'
  );
}
