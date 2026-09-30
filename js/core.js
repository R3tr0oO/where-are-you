// Où êtes-vous ? — génération du terrain, des éléments de paysage et des puzzles.
// Aucune dépendance au DOM : ce fichier peut être testé seul (Node).
'use strict';
// CORE-START ================================================================
// Monde : x = est, y = nord, en mètres. La carte couvre [0, L] x [0, L].
const DEG = Math.PI / 180;
const L = 1600;               // côté de la carte (m)
const SEG = 256;              // segments du maillage
const EXT = 2 * L;            // étendue du maillage (la carte est au centre)
const X0 = -L / 2;            // origine du maillage
const CELL = EXT / SEG;       // 12,5 m
const N = SEG + 1;
const BASE = 100;             // altitude de la plaine
const SEA = BASE;             // niveau de la mer (île)
const EYE = 2;                // hauteur des yeux (m, marge incluse)
const HFOV = 72;              // champ de vision horizontal (°)
const FAR_VIEW = 2100;        // portée utile de la vue (m)
const I0 = Math.round((0 - X0) / CELL), I1 = Math.round((L - X0) / CELL);
const LETTERS = 'ABCDE';
const PAD = 40, S = 920, MID = PAD + S / 2;   // cadre de la carte dans le SVG 1000 x 1000

const DIFFS = {
  facile:    { name: 'Facile',    nPts: 3, rot: 'nord',  facing: 'nord',     minDist: 1.6,  mult: 1,   tol: 250 },
  normal:    { name: 'Normale',   nPts: 4, rot: 'quart', facing: 'nord',     minDist: 1.3,  mult: 1.5, tol: 175 },
  difficile: { name: 'Difficile', nPts: 5, rot: 'quart', facing: 'cardinal', minDist: 1.05, mult: 2,   tol: 120 },
  // extrême : aucune indication de direction, la vue peut regarder n'importe où (pas de 2°)
  extreme:   { name: 'Extrême',   nPts: 5, rot: 'libre', facing: 'cache',    minDist: 0.95, mult: 3,   tol: 100 },
};
// step : équidistance des courbes ; maxElev : angle max toléré dans la vue ; near : part max d'horizon bouché ;
// spread : écart minimal entre points (relatif) ; range : dénivelé typique pour les couleurs.
const RELIEFS = {
  collines: { name: 'Collines douces',   step: 10, maxElev: 12, near: 0.25, spread: 1,    range: 170 },
  montagne: { name: 'Montagne escarpée', step: 20, maxElev: 21, near: 0.32, spread: 1,    range: 380 },
  cretes:   { name: 'Longues crêtes',    step: 10, maxElev: 15, near: 0.28, spread: 1,    range: 150 },
  plateaux: { name: 'Plateaux',          step: 10, maxElev: 14, near: 0.28, spread: 0.95, range: 130 },
  ile:      { name: 'Île',               step: 10, maxElev: 13, near: 0.25, spread: 0.72, range: 150 },
};
const RELIEF_KEYS = Object.keys(RELIEFS);

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Mélange stable d'un navigateur à l'autre (un tri à comparateur aléatoire ne l'est pas).
function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function mix32(h) { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
// Chaque niveau (et chaque nouveau terrain après une erreur) a sa propre graine : la partie est rejouable à l'identique.
const levelRng = (seed, i, k) => mulberry32(mix32(seed ^ mix32(Math.imul(i + 1, 0x9E3779B1) ^ Math.imul(k + 1, 0x7FEB352D))));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

function makeNoise(rng) {
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const gx = [1, -1, 1, -1, 1, -1, 0, 0], gy = [1, 1, -1, -1, 0, 0, 1, -1];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const h = (k, dx, dy) => gx[k & 7] * dx + gy[k & 7] * dy;
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const u = fade(xf), v = fade(yf);
    return lerp(lerp(h(aa, xf, yf), h(ba, xf - 1, yf), u), lerp(h(ab, xf, yf - 1), h(bb, xf - 1, yf - 1), u), v);
  };
}

// Relief paramétrable : chaque type combine des bosses gaussiennes allongées et du bruit fractal.
function makeTerrain(seed, kind = 'collines', opt = {}) {
  const rng = mulberry32(seed);
  const noise = makeNoise(rng);
  const bumps = [];
  const addBump = (amp, sMaj, ratio, o = {}) => {
    const a = o.angle ?? rng() * Math.PI, sMin = sMaj * ratio;
    bumps.push({ cx: o.cx ?? L * (0.12 + 0.76 * rng()), cy: o.cy ?? L * (0.12 + 0.76 * rng()), amp,
      c: Math.cos(a), s: Math.sin(a), ix: 1 / (sMaj * sMaj), iy: 1 / (sMin * sMin), r2: (3.4 * sMaj) ** 2,
      wig: o.wig || 0, mod: o.mod || 0, k: rng() * 90 });
  };
  const bumpSum = (x, y) => {
    let h = 0;
    for (const b of bumps) {
      const dx = x - b.cx, dy = y - b.cy;
      if (dx * dx + dy * dy > b.r2) continue;
      const u = dx * b.c + dy * b.s;
      let v = -dx * b.s + dy * b.c, amp = b.amp;
      if (b.wig) v += b.wig * noise(u / 380 + b.k, b.k);                 // crête sinueuse
      if (b.mod) amp *= 1 + b.mod * noise(u / 240 + b.k + 40, b.k + 7);  // sommets et cols le long de la crête
      h += amp * Math.exp(-0.5 * (u * u * b.ix + v * v * b.iy));
    }
    return h;
  };
  const fbm = (x, y) => noise(x / 420, y / 420) * 0.6 + noise(x / 190 + 17, y / 190) * 0.28 + noise(x / 85, y / 85 + 31) * 0.12;
  // atténuation hors de la carte : le relief informatif reste dans le cadre
  const inside = (x, y) => {
    const ox = Math.max(0, -x, x - L), oy = Math.max(0, -y, y - L);
    return 1 - smooth(clamp(Math.hypot(ox, oy) / (0.3 * L), 0, 1));
  };
  const R = n => Math.floor(rng() * n);
  let fn;

  if (kind === 'montagne') {
    for (let i = 0, n = 2 + R(2); i < n; i++) addBump(120 + 140 * rng(), 260 + 220 * rng(), 0.45 + 0.45 * rng());
    for (let i = 0, n = 3 + R(3); i < n; i++) addBump(40 + 80 * rng(), 70 + 90 * rng(), 0.5 + 0.5 * rng());
    const ridged = (x, y) => {
      let s = 0, a = 1, f = 1 / 520, tot = 0;
      for (let o = 0; o < 4; o++) {
        const n = 1 - Math.abs(noise(x * f + o * 13.1, y * f - o * 7.7));
        s += a * n * n; tot += a; a *= 0.5; f *= 2.05;
      }
      return s / tot;
    };
    fn = (x, y) => {
      const w = inside(x, y), m = bumpSum(x, y), r = ridged(x, y);
      return BASE + m * (0.55 + 0.75 * r) + w * (r * 70 - 22) * clamp(m / 120 + 0.25, 0, 1) + w * fbm(x, y) * 14;
    };
  } else if (kind === 'cretes') {
    const ang = rng() * Math.PI, ax = Math.cos(ang), ay = Math.sin(ang), px = -ay, py = ax;
    const nR = 3 + R(2);
    for (let i = 0; i < nR; i++) {
      const t = ((i + 0.5) / nR - 0.5) * 0.92 * L + (rng() - 0.5) * 0.08 * L, sh = (rng() - 0.5) * 0.3 * L;
      addBump(60 + 80 * rng(), 520 + 380 * rng(), 0.075 + 0.07 * rng(),
        { angle: ang + (rng() - 0.5) * 0.35, cx: L / 2 + px * t + ax * sh, cy: L / 2 + py * t + ay * sh, wig: 45 + 50 * rng(), mod: 0.6 });
    }
    for (let i = 0, n = 2 + R(3); i < n; i++) addBump(15 + 30 * rng(), 60 + 80 * rng(), 0.5 + 0.5 * rng());
    fn = (x, y) => BASE + bumpSum(x, y) + inside(x, y) * fbm(x, y) * 16;
  } else if (kind === 'plateaux') {
    for (let i = 0, n = 3 + R(3); i < n; i++) addBump(0.8 + 0.5 * rng(), 170 + 200 * rng(), 0.45 + 0.5 * rng());
    const h1 = 40 + 35 * rng(), h2 = 25 + 35 * rng();
    fn = (x, y) => {
      const w = inside(x, y);
      const f = bumpSum(x, y) + w * 0.2 * noise(x / 260 + 5, y / 260) + 0.07 * noise(x / 90, y / 90 + 9);
      const e = 0.035 * noise(x / 60 + 3, y / 60 - 3);                 // bords déchiquetés
      const t1 = smooth(clamp((f - 0.42 - e) / 0.06, 0, 1));
      const t2 = smooth(clamp((f - 0.95 - e) / 0.06, 0, 1));
      return BASE + h1 * t1 + h2 * t2 + w * fbm(x, y) * 8 + 4 * t1 * noise(x / 140, y / 140);
    };
  } else if (kind === 'ile') {
    const cx = L * (0.44 + 0.12 * rng()), cy = L * (0.44 + 0.12 * rng()), Rr = L * (0.28 + 0.08 * rng());
    for (let i = 0, n = 3 + R(3); i < n; i++) {
      const a = rng() * 2 * Math.PI, r = Rr * 0.55 * Math.sqrt(rng());
      addBump(35 + 90 * rng(), 90 + 150 * rng(), 0.4 + 0.6 * rng(), { cx: cx + Math.cos(a) * r, cy: cy + Math.sin(a) * r });
    }
    const islets = [];
    for (let i = 0, n = R(3); i < n; i++) {
      const a = rng() * 2 * Math.PI, r = Rr * (1.3 + 0.3 * rng()), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (x > 0.1 * L && x < 0.9 * L && y > 0.1 * L && y < 0.9 * L) islets.push({ x, y, amp: 40 + 35 * rng(), is: 1 / (45 + 35 * rng()) ** 2 });
    }
    fn = (x, y) => {
      const d = Math.hypot(x - cx, y - cy) / Rr * (1 + 0.22 * noise(x / 360 + 11, y / 360) + 0.1 * noise(x / 140, y / 140 + 21));
      const coast = 1 - smooth(clamp((d - 0.72) / 0.45, 0, 1));
      let h = SEA - 30 + coast * (42 + bumpSum(x, y) + 10 * fbm(x, y)) + 3 * fbm(x * 1.7, y * 1.7);
      for (const s of islets) { const dx = x - s.x, dy = y - s.y; h += s.amp * Math.exp(-0.5 * (dx * dx + dy * dy) * s.is); }
      return h;
    };
  } else {
    kind = 'collines';
    for (let i = 0, n = 3 + R(3); i < n; i++) addBump(45 + 95 * rng(), 140 + 230 * rng(), 0.3 + 0.6 * rng());
    for (let i = 0, n = 3 + R(5); i < n; i++) addBump(12 + 30 * rng(), 55 + 110 * rng(), 0.45 + 0.55 * rng());
    fn = (x, y) => BASE + bumpSum(x, y) + inside(x, y) * fbm(x, y) * 22;
  }

  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const y = X0 + j * CELL;
    for (let i = 0; i < N; i++) H[j * N + i] = fn(X0 + i * CELL, y);
  }
  // Par temps clair, on voit jusqu'au bord du maillage : on l'aplanit en douceur pour qu'il se fonde dans la plaine.
  if (opt.taper && kind !== 'ile') {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = X0 + i * CELL, y = X0 + j * CELL, ox = Math.max(0, -x, x - L), oy = Math.max(0, -y, y - L);
      const t = 1 - smooth(clamp((Math.hypot(ox, oy) - 0.28 * L) / (0.2 * L), 0, 1));
      if (t < 1) H[j * N + i] = BASE + (H[j * N + i] - BASE) * t;
    }
  }
  return { seed, kind, H, sea: kind === 'ile' ? SEA : null };
}

function heightAt(T, x, y) {
  const fx = clamp((x - X0) / CELL, 0, SEG - 1e-4), fy = clamp((y - X0) / CELL, 0, SEG - 1e-4);
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, H = T.H, k = j * N + i;
  return lerp(lerp(H[k], H[k + 1], tx), lerp(H[k + N], H[k + N + 1], tx), ty);
}
function gridAt(G, x, y) {
  const fx = clamp((x - X0) / CELL, 0, SEG - 1e-4), fy = clamp((y - X0) / CELL, 0, SEG - 1e-4);
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * N + i;
  return lerp(lerp(G[k], G[k + 1], tx), lerp(G[k + N], G[k + N + 1], tx), ty);
}
const canopyAt = (T, x, y) => T.canopy ? gridAt(T.canopy, x, y) : 0;
function lakeAt(T, x, y) {
  if (!T.lakes) return null;
  for (const k of T.lakes) { const dx = x - k.x, dy = y - k.y; if (dx * dx + dy * dy < k.r2 && heightAt(T, x, y) < k.level) return k; }
  return null;
}
const isWet = (T, x, y) => (T.sea != null && heightAt(T, x, y) < T.sea + 1) || !!lakeAt(T, x, y);
const slopeAt = (T, x, y) => Math.hypot(heightAt(T, x + 12, y) - heightAt(T, x - 12, y), heightAt(T, x, y + 12) - heightAt(T, x, y - 12)) / 24;
// Surface visible : la mer et les lacs masquent le fond, les forêts ajoutent la hauteur des arbres.
function surfAt(T, x, y) {
  let h = heightAt(T, x, y);
  if (T.sea != null && h < T.sea) h = T.sea;
  if (T.lakes) for (const k of T.lakes) { const dx = x - k.x, dy = y - k.y; if (dx * dx + dy * dy < k.r2 && h < k.level) h = k.level; }
  if (T.canopy) h += gridAt(T.canopy, x, y);
  return h;
}

// ---------- Éléments de paysage
const ELEMENTS = [['foret', 'Forêts'], ['lac', 'Lacs'], ['route', 'Routes'], ['hameau', 'Hameaux'], ['ligne', 'Lignes électriques']];
const EL = { foret: 1, lac: 2, route: 4, hameau: 8, ligne: 16 };
const EL_ALL = 31;
const CANOPY = 14;   // hauteur moyenne des arbres (m)

function markDisk(G, x, y, r) {
  const i0 = Math.max(0, Math.floor((x - r - X0) / CELL)), i1 = Math.min(SEG, Math.ceil((x + r - X0) / CELL));
  const j0 = Math.max(0, Math.floor((y - r - X0) / CELL)), j1 = Math.min(SEG, Math.ceil((y + r - X0) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const dx = X0 + i * CELL - x, dy = X0 + j * CELL - y;
    if (dx * dx + dy * dy <= r * r) G[j * N + i] = 1;
  }
}
// Lacs : une cuvette creusée là où le terrain est assez plat, remplie jusqu'au plus bas de son bord.
function makeLakes(T, rng) {
  T.lakes = [];
  const want = 1 + (rng() < 0.5 ? 1 : 0);
  for (let t = 0; t < 40 && T.lakes.length < want; t++) {
    const x = L * (0.15 + 0.7 * rng()), y = L * (0.15 + 0.7 * rng()), s = 55 + 50 * rng(), depth = 14 + 12 * rng();
    if (T.lakes.some(k => Math.hypot(k.x - x, k.y - y) < 2.2 * (k.s + s) + 60)) continue;
    const h0 = heightAt(T, x, y);
    if (T.sea != null && h0 < T.sea + 8) continue;
    if (slopeAt(T, x, y) > (T.sea != null ? 0.24 : 0.18)) continue;
    let ring = Infinity;
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * 2 * Math.PI;
      for (const rr of [1.8, 1.95, 2.1]) ring = Math.min(ring, heightAt(T, x + Math.cos(a) * rr * s, y + Math.sin(a) * rr * s) - depth * Math.exp(-0.5 * rr * rr));
    }
    const level = ring - 1;
    if (level < h0 - depth + 4) continue;
    const H = T.H, r3 = 3 * s;
    const i0 = Math.max(0, Math.floor((x - r3 - X0) / CELL)), i1 = Math.min(SEG, Math.ceil((x + r3 - X0) / CELL));
    const j0 = Math.max(0, Math.floor((y - r3 - X0) / CELL)), j1 = Math.min(SEG, Math.ceil((y + r3 - X0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = X0 + i * CELL - x, dy = X0 + j * CELL - y;
      H[j * N + i] -= depth * Math.exp(-0.5 * (dx * dx + dy * dy) / (s * s));
    }
    T.lakes.push({ x, y, s, R: 2 * s, r2: 4 * s * s, level });
  }
}
// Routes : plus court chemin sur une grille grossière, qui évite l'eau et les fortes pentes, puis lissé.
function roadPath(T, ax, ay, bx, by) {
  const G = 70, x0 = -0.14 * L, st = 1.28 * L / (G - 1), n = G * G;
  const hs = new Float32Array(n), wet = new Uint8Array(n);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = x0 + i * st, y = x0 + j * st, k = j * G + i;
    hs[k] = heightAt(T, x, y); wet[k] = isWet(T, x, y) ? 1 : 0;
  }
  const cell = (x, y) => clamp(Math.round((y - x0) / st), 0, G - 1) * G + clamp(Math.round((x - x0) / st), 0, G - 1);
  const src = cell(ax, ay), dst = cell(bx, by);
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const hk = [], hc = [];
  const push = (c, k) => { let i = hc.length; hc.push(c); hk.push(k); while (i > 0) { const p = (i - 1) >> 1; if (hc[p] <= hc[i]) break; [hc[p], hc[i]] = [hc[i], hc[p]]; [hk[p], hk[i]] = [hk[i], hk[p]]; i = p; } };
  const pop = () => {
    const c = hc[0], k = hk[0], lc = hc.pop(), lk = hk.pop();
    if (hc.length) {
      hc[0] = lc; hk[0] = lk; let i = 0;
      for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < hc.length && hc[a] < hc[m]) m = a; if (b < hc.length && hc[b] < hc[m]) m = b; if (m === i) break; [hc[m], hc[i]] = [hc[i], hc[m]]; [hk[m], hk[i]] = [hk[i], hk[m]]; i = m; }
    }
    return [c, k];
  };
  dist[src] = 0; push(0, src);
  while (hc.length) {
    const [d, k] = pop();
    if (k === dst) break;
    if (d > dist[k]) continue;
    const ci = k % G, cj = (k - ci) / G;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= G || nj >= G) continue;
      const nk = nj * G + ni, step = di && dj ? st * Math.SQRT2 : st, sl = Math.abs(hs[nk] - hs[k]) / step;
      const c = d + step * (1 + 55 * sl * sl + (sl > 0.22 ? 25 : 0)) + (wet[nk] ? 1e7 : 0);
      if (c < dist[nk]) { dist[nk] = c; prev[nk] = k; push(c, nk); }
    }
  }
  if (!(dist[dst] < 1e7)) return null;
  let pts = [];
  for (let k = dst; k >= 0; k = prev[k]) { const i = k % G; pts.push([x0 + i * st, x0 + (k - i) / G * st]); if (k === src) break; }
  pts.reverse();
  for (let it = 0; it < 3; it++) {
    const o = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    o.push(pts[pts.length - 1]); pts = o;
  }
  return pts;
}
function makeRoads(T, rng) {
  T.roadsAll = [];
  const edge = (side, t) => [[-0.12 * L, t], [1.12 * L, t], [t, -0.12 * L], [t, 1.12 * L]][side];
  const land = () => { for (let g = 0; g < 80; g++) { const x = L * (0.1 + 0.8 * rng()), y = L * (0.1 + 0.8 * rng()); if (!isWet(T, x, y) && (T.sea == null || heightAt(T, x, y) > T.sea + 3)) return [x, y]; } return null; };
  let a, b;
  if (T.sea != null) {
    a = land(); b = null;
    for (let g = 0; g < 30 && a; g++) { const c = land(); if (c && Math.hypot(c[0] - a[0], c[1] - a[1]) > 0.3 * L) { b = c; break; } }
  } else {
    const s1 = Math.floor(rng() * 4), s2 = rng() < 0.65 ? s1 ^ 1 : (s1 < 2 ? 2 : 0) + Math.floor(rng() * 2);
    a = edge(s1, L * (0.15 + 0.7 * rng())); b = edge(s2, L * (0.15 + 0.7 * rng()));
  }
  const r1 = a && b ? roadPath(T, a[0], a[1], b[0], b[1]) : null;
  if (!r1) return;
  T.roadsAll.push(r1);
  if (rng() < 0.6) {
    const m = r1[Math.floor((0.35 + 0.3 * rng()) * (r1.length - 1))];
    const c = T.sea != null ? land() : edge(Math.floor(rng() * 4), L * (0.15 + 0.7 * rng()));
    const r2 = c && Math.hypot(c[0] - m[0], c[1] - m[1]) > 0.3 * L ? roadPath(T, m[0], m[1], c[0], c[1]) : null;
    if (r2) T.roadsAll.push(r2);
  }
}
function roadDist(T, x, y) {
  let md = Infinity;
  for (const r of T.roadsAll || []) for (const [px, py] of r) { const d = (px - x) ** 2 + (py - y) ** 2; if (d < md) md = d; }
  return Math.sqrt(md);
}
// Hameaux : quelques maisons le long d'une route, sur un terrain plat.
function makeHamlets(T, rng) {
  T.houses = []; T.hamlets = [];
  const roads = T.roadsAll || [];
  if (!roads.length) return;
  const want = 1 + (rng() < 0.55 ? 1 : 0);
  for (let t = 0; t < 90 && T.hamlets.length < want; t++) {
    const relax = t < 40 ? 1 : 1.8;   // relief tourmenté : on accepte ensuite des pentes plus fortes
    const rd = roads[Math.floor(rng() * roads.length)], i = Math.floor((0.15 + 0.7 * rng()) * (rd.length - 1));
    const [x, y] = rd[i];
    if (x < 0.1 * L || x > 0.9 * L || y < 0.1 * L || y > 0.9 * L) continue;
    if (slopeAt(T, x, y) > (T.sea != null ? 0.17 : 0.12) * relax || isWet(T, x, y)) continue;
    if (T.hamlets.some(h => Math.hypot(h.x - x, h.y - y) < 380)) continue;
    const q1 = rd[Math.max(0, i - 3)], q2 = rd[Math.min(rd.length - 1, i + 3)], ang = Math.atan2(q2[1] - q1[1], q2[0] - q1[0]);
    const want2 = 4 + Math.floor(rng() * 5), start = T.houses.length;
    for (let k = 0; k < 80 && T.houses.length - start < want2; k++) {
      const along = (rng() - 0.5) * 150, side = (rng() < 0.5 ? -1 : 1) * (13 + 32 * rng());
      const hx = x + Math.cos(ang) * along - Math.sin(ang) * side, hy = y + Math.sin(ang) * along + Math.cos(ang) * side;
      const w = 9 + 6 * rng(), d = 7 + 3 * rng(), hh = 5 + 3 * rng(), turn = rng() < 0.7 ? 0 : Math.PI / 2, jit = (rng() - 0.5) * 0.2;
      if (slopeAt(T, hx, hy) > 0.2 * Math.min(relax, 1.4) || isWet(T, hx, hy)) continue;
      if (T.houses.some(h => Math.hypot(h.x - hx, h.y - hy) < 17)) continue;
      if (roadDist(T, hx, hy) < 10) continue;
      T.houses.push({ x: hx, y: hy, a: ang + turn + jit, w, d, h: hh });
    }
    if (T.houses.length - start >= 3) T.hamlets.push({ x, y });
    else T.houses.length = start;
  }
}
// Ligne électrique : droite qui traverse la carte, un pylône tous les 170 m, coupée au-dessus de l'eau.
function makePowerLine(T, rng) {
  T.pylons = []; T.spans = [];
  const a = rng() * Math.PI, dx = Math.cos(a), dy = Math.sin(a), off = (rng() - 0.5) * 0.5 * L;
  const cx = L / 2 - dy * off, cy = L / 2 + dx * off;
  let prev = null;
  for (let t = -0.95 * L; t <= 0.95 * L; t += 170) {
    const x = cx + dx * t, y = cy + dy * t;
    if (x < -0.2 * L || x > 1.2 * L || y < -0.2 * L || y > 1.2 * L || isWet(T, x, y) || (T.houses || []).some(h => Math.hypot(h.x - x, h.y - y) < 25)) { prev = null; continue; }
    const p = { x, y, a };
    T.pylons.push(p);
    if (prev) T.spans.push([prev, p]);
    prev = p;
  }
}
// Forêts : taches de bruit, hors de l'eau, des clairières des hameaux, des routes et au-dessus de la limite des arbres.
function makeForest(T, rng, excl) {
  const noise = makeNoise(rng), R = RELIEFS[T.kind], H = T.H, c = new Float32Array(N * N);
  const lim = Math.round(0.25 * L / CELL);
  for (let j = I0 - lim; j <= I1 + lim; j++) for (let i = I0 - lim; i <= I1 + lim; i++) {
    const k = j * N + i;
    if (excl[k]) continue;
    const x = X0 + i * CELL, y = X0 + j * CELL, h = H[k];
    if (T.sea != null && h < T.sea + 3) continue;
    if (T.kind === 'montagne' && h > BASE + 0.6 * R.range) continue;
    if (Math.hypot(H[k + 1] - H[k - 1], H[k + N] - H[k - N]) / (2 * CELL) > 1) continue;
    const f = noise(x / 330, y / 330) + 0.45 * noise(x / 120 + 19, y / 120) + 0.18 * noise(x / 45, y / 45 + 7);
    if (f > (T.sea != null ? -0.05 : 0.1)) c[k] = CANOPY;
  }
  T.canopy = c;
}
function addFeatures(T, el) {
  if (!el) return T;
  T.el = el;
  const sub = salt => mulberry32(mix32(T.seed ^ salt));
  if (el & EL.lac) makeLakes(T, sub(0x1a2b3c4d));
  if (el & (EL.route | EL.hameau)) makeRoads(T, sub(0x2b3c4d5e));
  if (el & EL.hameau) makeHamlets(T, sub(0x3c4d5e6f));
  if (el & EL.ligne) makePowerLine(T, sub(0x4d5e6f70));
  T.roads = el & EL.route ? T.roadsAll : null;
  if (el & EL.foret) {
    const ex = new Uint8Array(N * N);
    for (const r of T.roads || []) for (const [x, y] of r) markDisk(ex, x, y, 11);
    for (const h of T.hamlets || []) markDisk(ex, h.x, h.y, 60);
    for (const h of T.houses || []) markDisk(ex, h.x, h.y, 16);
    for (const [p, q] of T.spans || []) for (let t = 0; t <= 1; t += 0.05) markDisk(ex, lerp(p.x, q.x, t), lerp(p.y, q.y, t), 9);
    for (const k of T.lakes || []) markDisk(ex, k.x, k.y, 1.85 * k.s);
    makeForest(T, sub(0x5e6f7081), ex);
  }
  return T;
}

// ---------- Conditions de vue
const COND = {
  hauteur: { debout: { eye: EYE, pitch: -1 }, tour: { eye: 25, pitch: -4 }, drone: { eye: 120, pitch: -15 } },
  brume: { claire: { near: 250, far: 4200, prof: 2600 }, legere: { near: 40, far: 2050, prof: FAR_VIEW }, epaisse: { near: 10, far: 760, prof: 850 } },
  heure: { matin: {}, midi: {}, apresmidi: {}, soir: {} },
  saison: { ete: {}, automne: {}, hiver: {} },
};
const COND_KEYS = ['hauteur', 'brume', 'heure', 'saison'];
const COND_STD = { hauteur: 'debout', brume: 'legere', heure: 'apresmidi', saison: 'ete' };
function pickConditions(st, rng) {
  const out = {};
  for (const k of COND_KEYS) {
    const keys = Object.keys(COND[k]), r = keys[Math.floor(rng() * keys.length)];
    out[k] = st.cond === 'standard' ? COND_STD[k] : st.cond === 'hasard' || st[k] === 'hasard' ? r : st[k];
  }
  return out;
}
const condRng = (seed, i) => mulberry32(mix32(seed ^ mix32(Math.imul(i + 1, 0x2545F491) ^ 0x51ed27)));

// Carte : rotation d'un angle quelconque (degrés, sens horaire à l'écran) autour du centre.
function toSvg(x, y, rot = 0) {
  const cu = x / L - 0.5, cv = 0.5 - y / L, a = rot * DEG, c = Math.cos(a), s = Math.sin(a);
  return [MID + (c * cu - s * cv) * S, MID + (s * cu + c * cv) * S];
}
function fromSvg(X, Y, rot = 0) {
  const u = (X - MID) / S, v = (Y - MID) / S, a = rot * DEG, c = Math.cos(a), s = Math.sin(a);
  return { x: (c * u + s * v + 0.5) * L, y: (0.5 - (-s * u + c * v)) * L };
}
const contourMargin = rot => rot % 90 ? 28 : 0;   // une carte à angle libre montre les abords

// Profil d'horizon : angle d'élévation max (°) pour chaque direction du champ de vision.
function horizonProfile(T, p, azDeg, eye = EYE, far = FAR_VIEW) {
  const e = heightAt(T, p.x, p.y) + eye, n = 37, ang = new Float32Array(n), dist = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = (azDeg + (k / (n - 1) - 0.5) * HFOV) * DEG, sx = Math.sin(a), sy = Math.cos(a);
    let best = -90, bd = 0;
    for (let d = 15; d < far; d *= 1.035) {
      const v = Math.atan2(surfAt(T, p.x + sx * d, p.y + sy * d) - e, d);
      if (v > best) { best = v; bd = d; }
    }
    ang[k] = best / DEG; dist[k] = bd;
  }
  return { ang, dist };
}
const PANO = 180;   // un rayon tous les 2°, l'écart entre deux échantillons d'un profil
function panorama(T, p, eye = EYE, far = FAR_VIEW) {
  const e = heightAt(T, p.x, p.y) + eye, ang = new Float32Array(PANO);
  for (let k = 0; k < PANO; k++) {
    const a = k * 2 * DEG, sx = Math.sin(a), sy = Math.cos(a);
    let best = -90;
    for (let d = 15; d < far; d *= 1.035) { const v = Math.atan2(surfAt(T, p.x + sx * d, p.y + sy * d) - e, d); if (v > best) best = v; }
    ang[k] = best / DEG;
  }
  return ang;
}
// Écart minimal entre une vue et ce qu'on verrait depuis un autre point, dans n'importe quelle direction.
function panoDist(pr, pano) {
  const n = pr.ang.length; let md = Infinity;
  for (let s = 0; s < PANO; s++) {
    let t = 0;
    for (let k = 0; k < n && t < md * n; k++) t += Math.abs(pr.ang[k] - pano[(s + k) % PANO]);
    if (t / n < md) md = t / n;
  }
  return md;
}
function profileDist(a, b) { let s = 0; for (let k = 0; k < a.ang.length; k++) s += Math.abs(a.ang[k] - b.ang[k]); return s / a.ang.length; }
function profileOK(pr, rel, eye = EYE) {
  let mn = Infinity, mx = -Infinity, near = 0;
  for (let k = 0; k < pr.ang.length; k++) {
    const v = pr.ang[k]; if (v < mn) mn = v; if (v > mx) mx = v;
    if (pr.dist[k] < 220) near++;
  }
  // ni bouchée par la pente toute proche, ni sans relief lisible (vu d'en haut, la vue plonge : seul le masque compte)
  if (eye > 50) return near / pr.ang.length < rel.near;
  return mx < rel.maxElev && mx - mn > (eye > 10 ? 0.8 : 1.2) && near / pr.ang.length < rel.near;
}
// Un point doit rester lisible dans le cadre tourné, hors de la flèche du nord et de l'échelle.
function inFrame(p, rot) {
  const [sx, sy] = toSvg(p.x, p.y, rot);
  if (sx < PAD + 0.09 * S || sx > PAD + 0.91 * S || sy < PAD + 0.09 * S || sy > PAD + 0.91 * S) return false;
  if (Math.hypot(sx - (PAD + S - 95), sy - (PAD + 95)) < 125) return false;
  if (sx < PAD + 360 && sy > PAD + S - 130) return false;
  return true;
}
function placePoints(rng, n, o = {}) {
  const rot = o.rot || 0, T = o.T;
  const minD = L * (n <= 3 ? 0.28 : n === 4 ? 0.24 : 0.21) * (o.spread ?? 1), pts = [];
  for (let g = 0; g < 900 && pts.length < n; g++) {
    const p = { x: L * (0.08 + 0.84 * rng()), y: L * (0.08 + 0.84 * rng()) };
    if (!inFrame(p, rot)) continue;
    if (T && T.sea != null && heightAt(T, p.x, p.y) < T.sea + 4) continue;   // sur la terre ferme
    if (T && T.el && !spotOK(T, p)) continue;
    if (pts.every(q => Math.hypot(q.x - p.x, q.y - p.y) >= minD)) pts.push(p);
  }
  return pts.length === n ? pts : null;
}
function spotOK(T, p) {
  if (lakeAt(T, p.x, p.y) || lakeAt(T, p.x + 20, p.y) || lakeAt(T, p.x - 20, p.y) || lakeAt(T, p.x, p.y + 20) || lakeAt(T, p.x, p.y - 20)) return false;
  if (T.canopy) { if (canopyAt(T, p.x, p.y) > 0.5) return false; for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; if (canopyAt(T, p.x + 16 * Math.cos(a), p.y + 16 * Math.sin(a)) > 4) return false; } }
  if ((T.houses || []).some(h => Math.hypot(h.x - p.x, h.y - p.y) < 20)) return false;
  if ((T.pylons || []).some(q => Math.hypot(q.x - p.x, q.y - p.y) < 12)) return false;
  return true;
}
function pickRot(setting, cfg, rng) {
  if (setting === 'auto') setting = cfg ? cfg.rot : 'nord';
  if (setting === 'libre') { let a; do a = Math.floor(rng() * 360); while (a % 90 < 10 || a % 90 > 80); return a; }
  if (setting === 'quart') return 90 * Math.floor(rng() * 4);
  return 0;
}

// Génère un puzzle jouable : la vue depuis la bonne réponse doit se distinguer nettement des autres points
// (en clic libre, ces autres points servent de leurres invisibles pour écarter les vues ambiguës).
function buildPuzzle(diffKey, reliefKey, rotSetting, rng, opts = {}) {
  const cfg = DIFFS[diffKey], rel = RELIEFS[reliefKey], cond = opts.cond || COND_STD, el = opts.el || 0;
  const eye = COND.hauteur[cond.hauteur].eye, far = COND.brume[cond.brume].prof;
  // de haut ou dans la brume, les vues se ressemblent davantage : le seuil s'adapte
  const sepMin = cfg.minDist * (eye > 50 ? 0.45 : eye > 10 ? 0.8 : 1) * (far < 1000 ? 0.75 : 1);
  let best = null, loose = null;
  for (let t = 0; t < 40; t++) {
    const T = addFeatures(makeTerrain(Math.floor(rng() * 2 ** 31), reliefKey, { taper: cond.brume === 'claire' }), el);
    const hidden = cfg.facing === 'cache';
    const az = cfg.facing === 'cardinal' ? 90 * Math.floor(rng() * 4) : hidden ? 2 * Math.floor(rng() * PANO) : 0;
    const rot = pickRot(rotSetting, cfg, rng);
    for (let k = 0; k < 10; k++) {
      const pts = placePoints(rng, cfg.nPts, { rot, T, spread: rel.spread });
      if (!pts) continue;
      const prof = pts.map(p => horizonProfile(T, p, az, eye, far));
      const order = shuffle(pts.map((_, i) => i), rng);
      let panos = null;
      for (const a of order) {
        let md = Infinity;
        for (let j = 0; j < pts.length; j++) if (j !== a) md = Math.min(md, profileDist(prof[a], prof[j]));
        if (!loose || md > loose.sep) loose = { T, pts, ans: a, az, rot, diffKey, relief: reliefKey, cond, sep: md };
        if (!profileOK(prof[a], rel, eye)) continue;
        if (hidden) {
          // même direction = borne haute : inutile de calculer les panoramas si elle échoue déjà
          if (md < sepMin && best && best.sep >= md) continue;
          panos = panos || pts.map(p => panorama(T, p, eye, far));
          for (let j = 0; j < pts.length; j++) if (j !== a) md = Math.min(md, panoDist(prof[a], panos[j]));
        }
        const cand = { T, pts, ans: a, az, rot, diffKey, relief: reliefKey, cond, sep: md };
        if (md >= sepMin) return cand;
        if (!best || md > best.sep) best = cand;
      }
    }
  }
  return best || loose || buildPuzzle(diffKey, 'collines', rotSetting, rng, opts);
}

// Courbes de niveau (marching squares). margin : cellules en plus autour de la carte.
function contours(T, margin = 0) {
  const H = T.H, step = RELIEFS[T.kind].step;
  const ja = Math.max(0, I0 - margin), jb = Math.min(SEG, I1 + margin);
  let mn = Infinity, mx = -Infinity;
  for (let j = ja; j <= jb; j++) for (let i = ja; i <= jb; i++) { const v = H[j * N + i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  let lo = Math.ceil((mn + 0.01) / step) * step;
  if (T.sea != null) lo = Math.max(lo, T.sea);        // rien sous la mer, le rivage d'abord
  const lvls = [];
  for (let lv = lo; lv < mx; lv += step) lvls.push({ lv, index: lv % (step * 5) === 0, shore: T.sea != null && lv === T.sea, segs: [] });
  for (let j = ja; j < jb; j++) for (let i = ja; i < jb; i++) {
    const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i + 1], d = H[(j + 1) * N + i];
    const cmin = Math.min(a, b, c, d), cmax = Math.max(a, b, c, d);
    const x = X0 + i * CELL, y = X0 + j * CELL;
    for (const ct of lvls) {
      const lv = ct.lv;
      if (lv < cmin || lv >= cmax) continue;
      const A = a > lv, B = b > lv, C = c > lv, D = d > lv;
      const e = [];
      e[0] = A !== B ? [x + (lv - a) / (b - a) * CELL, y] : null;
      e[1] = B !== C ? [x + CELL, y + (lv - b) / (c - b) * CELL] : null;
      e[2] = D !== C ? [x + (lv - d) / (c - d) * CELL, y + CELL] : null;
      e[3] = A !== D ? [x, y + (lv - a) / (d - a) * CELL] : null;
      const code = (A ? 1 : 0) | (B ? 2 : 0) | (C ? 4 : 0) | (D ? 8 : 0);
      let pairs;
      if (code === 5 || code === 10) {
        const up = (a + b + c + d) / 4 > lv;
        pairs = (code === 5) === up ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
      } else {
        const idx = [0, 1, 2, 3].filter(q => e[q]);
        pairs = idx.length === 2 ? [idx] : [];
      }
      for (const [p, q] of pairs) ct.segs.push(e[p][0], e[p][1], e[q][0], e[q][1]);
    }
  }
  return lvls;
}
// CORE-END ==================================================================
