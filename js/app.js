// Où êtes-vous ? — carte SVG, vue 3D (Three.js), déroulé des parties, statistiques et partage.
'use strict';
// ------------------------------------------------------------ Carte (SVG)
const f1 = n => n.toFixed(1);

// Masque raster (mer, forêts, lacs), calculé une fois par terrain, sur une zone qui couvre toute carte tournée.
function rasterMask(T, key, test) {
  T._masks = T._masks || {};
  if (T._masks[key]) return T._masks[key];
  const n = 480, x0 = -0.25 * L, ext = 1.5 * L, px = ext / n;
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(n, n), d = img.data;
  for (let r = 0; r < n; r++) {
    const y = x0 + ext - (r + 0.5) * px;
    for (let c = 0; c < n; c++) {
      const k = (r * n + c) * 4, w = test(x0 + (c + 0.5) * px, y) ? 255 : 0;
      d[k] = d[k + 1] = d[k + 2] = w; d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return (T._masks[key] = { url: cv.toDataURL(), x0, ext });
}
function maskDefs(T, o, key, test, rot) {
  const m = rasterMask(T, key, test), X = PAD + m.x0 / L * S, Y = PAD + (1 - (m.x0 + m.ext) / L) * S, W = m.ext / L * S;
  return `<mask id="${o.id}-${key}" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000"><image href="${m.url}" x="${f1(X)}" y="${f1(Y)}" width="${f1(W)}" height="${f1(W)}" preserveAspectRatio="none" transform="rotate(${rot} ${MID} ${MID})"/></mask>`;
}
// Contour d'un lac (marching squares sur la hauteur, limité à son disque).
function lakeOutline(T, k) {
  const H = T.H, segs = [], v = (i, j) => { const dx = X0 + i * CELL - k.x, dy = X0 + j * CELL - k.y; return dx * dx + dy * dy < k.r2 ? H[j * N + i] - k.level : 5; };
  const i0 = Math.max(0, Math.floor((k.x - k.R - X0) / CELL)), i1 = Math.min(SEG - 1, Math.ceil((k.x + k.R - X0) / CELL));
  const j0 = Math.max(0, Math.floor((k.y - k.R - X0) / CELL)), j1 = Math.min(SEG - 1, Math.ceil((k.y + k.R - X0) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1), x = X0 + i * CELL, y = X0 + j * CELL, e = [];
    if ((a > 0) !== (b > 0)) e.push([x - a / (b - a) * CELL, y]);
    if ((b > 0) !== (c > 0)) e.push([x + CELL, y - b / (c - b) * CELL]);
    if ((d > 0) !== (c > 0)) e.push([x - d / (c - d) * CELL, y + CELL]);
    if ((a > 0) !== (d > 0)) e.push([x, y - a / (d - a) * CELL]);
    if (e.length === 2) segs.push(e[0][0], e[0][1], e[1][0], e[1][1]);
    else if (e.length === 4) segs.push(e[0][0], e[0][1], e[1][0], e[1][1], e[2][0], e[2][1], e[3][0], e[3][1]);
  }
  return segs;
}
const polyD = (pts, rot) => 'M' + pts.map(([x, y]) => toSvg(x, y, rot).map(f1).join(' ')).join('L');

function drawMap(svg, T, lvls, o) {
  const rot = o.rot || 0, pts = o.pts || [], step = RELIEFS[T.kind].step;
  const mk = pts.map(p => toSvg(p.x, p.y, rot));
  let g = `<defs><clipPath id="${o.id}-clip"><rect x="${PAD}" y="${PAD}" width="${S}" height="${S}"/></clipPath>`;
  if (T.sea != null) g += maskDefs(T, o, 'sea', (x, y) => heightAt(T, x, y) < T.sea, rot);
  if (T.canopy) g += maskDefs(T, o, 'forest', (x, y) => canopyAt(T, x, y) > 7, rot);
  if (T.lakes && T.lakes.length) g += maskDefs(T, o, 'lake', (x, y) => !!lakeAt(T, x, y), rot);
  g += `</defs><rect x="0" y="0" width="1000" height="1000" fill="var(--map-bg)"/>`;
  g += `<g clip-path="url(#${o.id}-clip)" fill="none" stroke-linecap="round" stroke-linejoin="round">`;
  if (T.canopy) g += `<rect x="0" y="0" width="1000" height="1000" fill="var(--forest)" mask="url(#${o.id}-forest)"/>`;
  if (T.sea != null) g += `<rect x="0" y="0" width="1000" height="1000" fill="var(--water)" mask="url(#${o.id}-sea)"/>`;
  for (const ct of lvls) {
    let d = '';
    const s = ct.segs;
    for (let k = 0; k < s.length; k += 4) {
      const [ax, ay] = toSvg(s[k], s[k + 1], rot), [bx, by] = toSvg(s[k + 2], s[k + 3], rot);
      d += `M${f1(ax)} ${f1(ay)}L${f1(bx)} ${f1(by)}`;
    }
    if (!d) continue;
    if (ct.shore) g += `<path d="${d}" stroke="var(--shore)" stroke-width="3.6"/>`;
    else g += `<path d="${d}" stroke="${ct.index ? 'var(--contour-index)' : 'var(--contour)'}" stroke-width="${ct.index ? 3.4 : 1.9}" opacity="${ct.index ? 0.95 : 0.72}"/>`;
  }
  // Lacs (au-dessus des courbes du fond), routes, ligne électrique, maisons
  if (T.lakes && T.lakes.length) {
    g += `<rect x="0" y="0" width="1000" height="1000" fill="var(--water)" mask="url(#${o.id}-lake)"/>`;
    for (const k of T.lakes) {
      const sg = lakeOutline(T, k); let d = '';
      for (let q = 0; q < sg.length; q += 4) { const [ax, ay] = toSvg(sg[q], sg[q + 1], rot), [bx, by] = toSvg(sg[q + 2], sg[q + 3], rot); d += `M${f1(ax)} ${f1(ay)}L${f1(bx)} ${f1(by)}`; }
      if (d) g += `<path d="${d}" stroke="var(--shore)" stroke-width="3"/>`;
    }
  }
  for (const r of T.roads || []) { const d = polyD(r, rot); g += `<path d="${d}" stroke="var(--ink)" stroke-width="8"/><path d="${d}" stroke="var(--road)" stroke-width="4.2"/>`; }
  if (T.spans && T.spans.length) {
    g += `<path d="${T.spans.map(([a, b]) => polyD([[a.x, a.y], [b.x, b.y]], rot)).join('')}" stroke="var(--ink)" stroke-width="1.8" opacity=".85"/>`;
    for (const q of T.pylons) { const [x, y] = toSvg(q.x, q.y, rot); g += `<rect x="${f1(x - 3.5)}" y="${f1(y - 3.5)}" width="7" height="7" fill="var(--ink)"/>`; }
  }
  for (const h of T.houses || []) {
    const c = Math.cos(h.a), sn = Math.sin(h.a), w = h.w * 0.7, d = h.d * 0.7;
    const pts = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([u, v]) => [h.x + u * c - v * sn, h.y + u * sn + v * c]);
    g += `<path d="${polyD(pts, rot)}Z" fill="var(--ink)" stroke="none"/>`;
  }
  // Cotes des courbes maîtresses, orientées le long de la ligne
  if (o.labels !== false) {
    const rng = mulberry32(T.seed ^ 0x5bd1e995), cand = [];
    const low = lv => T.sea == null && lv <= BASE + 5;
    for (const ct of lvls) if (ct.index && !ct.shore) for (let k = 0; k < ct.segs.length; k += 4) cand.push([ct.lv, k, ct.segs]);
    for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
    cand.sort((a, b) => low(a[0]) - low(b[0]));   // la plaine en dernier
    const placed = [];
    for (const [lv, k, s] of cand) {
      if (placed.length >= 9 || (low(lv) && placed.length >= 4)) break;
      const [ax, ay] = toSvg(s[k], s[k + 1], rot), [bx, by] = toSvg(s[k + 2], s[k + 3], rot);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (mx < PAD + 70 || mx > PAD + S - 70 || my < PAD + 60 || my > PAD + S - 60) continue;
      if (mx > PAD + S - 190 && my < PAD + 190) continue;       // zone de la flèche N
      if (mx < PAD + 360 && my > PAD + S - 130) continue;       // zone de l'échelle
      if (placed.some(q => Math.hypot(q[0] - mx, q[1] - my) < 190)) continue;
      if (mk.some(q => Math.hypot(q[0] - mx, q[1] - my) < 95)) continue;
      if (T.lakes && lakeAt(T, (s[k] + s[k + 2]) / 2, (s[k + 1] + s[k + 3]) / 2)) continue;
      let ang = Math.atan2(by - ay, bx - ax) / DEG;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      placed.push([mx, my]);
      g += `<text x="${f1(mx)}" y="${f1(my)}" transform="rotate(${f1(ang)} ${f1(mx)} ${f1(my)})" fill="var(--contour-index)" stroke="var(--map-bg)" stroke-width="10" paint-order="stroke" font-size="25" font-weight="600" text-anchor="middle" dominant-baseline="central" font-family="Archivo, system-ui, sans-serif">${lv}</text>`;
    }
  }
  g += `</g>`;
  g += `<rect x="${PAD}" y="${PAD}" width="${S}" height="${S}" fill="none" stroke="var(--frame)" stroke-width="2"/>`;
  if (o.chrome !== false) {
    // Flèche du nord, à n'importe quel angle
    const cx = PAD + S - 95, cy = PAD + 95, a = rot * DEG;
    g += `<g transform="translate(${cx} ${cy})"><circle r="78" fill="var(--map-bg)" opacity=".85"/>` +
      `<g transform="rotate(${rot})" stroke="var(--ink)" stroke-width="4" fill="var(--ink)"><line x1="0" y1="40" x2="0" y2="-30"/><path d="M0 -46 L-11 -24 L11 -24 Z" stroke="none"/></g>` +
      `<text x="${f1(66 * Math.sin(a))}" y="${f1(-66 * Math.cos(a))}" fill="var(--ink)" font-size="30" font-weight="800" text-anchor="middle" dominant-baseline="central" font-family="Archivo, system-ui, sans-serif">N</text></g>`;
    // Échelle et équidistance
    const bar = S * 500 / L, bx = PAD + 34, by = PAD + S - 62;
    g += `<rect x="${bx - 14}" y="${by - 44}" width="${bar + 28}" height="94" fill="var(--map-bg)" opacity=".85"/>` +
      `<line x1="${bx}" y1="${by}" x2="${bx + bar}" y2="${by}" stroke="var(--ink)" stroke-width="5"/>` +
      `<line x1="${bx}" y1="${by - 10}" x2="${bx}" y2="${by + 8}" stroke="var(--ink)" stroke-width="3"/>` +
      `<line x1="${bx + bar}" y1="${by - 10}" x2="${bx + bar}" y2="${by + 8}" stroke="var(--ink)" stroke-width="3"/>` +
      `<text x="${bx}" y="${by - 24}" fill="var(--ink)" font-size="22" font-family="Archivo, system-ui, sans-serif">500 m</text>` +
      `<text x="${bx}" y="${by + 30}" fill="var(--ink)" font-size="20" font-family="Archivo, system-ui, sans-serif">courbes tous les ${step} m</text>`;
  }
  // Points candidats (cercles de poste, façon course d'orientation)
  mk.forEach(([x, y], i) => {
    g += `<g class="pt" data-i="${i}"><circle class="hit" cx="${f1(x)}" cy="${f1(y)}" r="62"/><circle class="ring" cx="${f1(x)}" cy="${f1(y)}" r="32"/><text x="${f1(x)}" y="${f1(y)}">${LETTERS[i]}</text></g>`;
  });
  g += `<g id="${o.id}-marks" clip-path="url(#${o.id}-clip)"></g>`;
  svg.innerHTML = g;
}

function conePath(p, az, rot) {
  const pts = [toSvg(p.x, p.y, rot)], R = L * 0.5;
  for (let k = 0; k <= 16; k++) {
    const a = (az + (k / 16 - 0.5) * HFOV) * DEG;
    pts.push(toSvg(p.x + Math.sin(a) * R, p.y + Math.cos(a) * R, rot));
  }
  return 'M' + pts.map(q => f1(q[0]) + ' ' + f1(q[1])).join('L') + 'Z';
}

// ------------------------------------------------------------ Vue 3D (Three.js)
const GL = { ok: false };
// Ciel et lumière selon le moment de la journée (l'après-midi reproduit l'ambiance d'origine).
const SKY = {
  matin:     { az: 105, el: 12, sun: 0xffe0b5, si: 0.95, hemi: 0.48, horizon: 0x9ea6b3, zenith: 0x4d6488 },
  midi:      { az: 180, el: 62, sun: 0xfffaf0, si: 1.0,  hemi: 0.55, horizon: 0x8795ad, zenith: 0x3b5783 },
  apresmidi: { az: 245, el: 30, sun: 0xfff0d8, si: 1.05, hemi: 0.5,  horizon: 0x71819b, zenith: 0x3a4c6c },
  soir:      { az: 262, el: 7,  sun: 0xffa56b, si: 0.95, hemi: 0.36, horizon: 0xb09283, zenith: 0x353d60 },
};
function initGL() {
  if (GL.ok) return true;
  const frame = document.getElementById('viewFrame');
  if (!window.THREE) { showNoGL(frame, 'Le moteur 3D n\u2019a pas pu être chargé (fichier vendor/three.min.js manquant ?). Rechargez la page.'); return false; }
  try {
    GL.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: true });
  } catch (e) { showNoGL(frame, 'Ce navigateur n\u2019affiche pas la 3D (WebGL indisponible).'); return false; }
  GL.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  GL.scene = new THREE.Scene();
  GL.scene.background = new THREE.Color(0x71819b);
  GL.scene.fog = new THREE.Fog(0x71819b, 40, 2050);
  GL.camera = new THREE.PerspectiveCamera(50, 1.6, 0.5, 9000);
  GL.hemi = new THREE.HemisphereLight(0xbfcadb, 0x3a4726, 0.5);
  GL.scene.add(GL.hemi);
  GL.sun = new THREE.DirectionalLight(0xfff0d8, 1.05);
  GL.scene.add(GL.sun);
  // Dôme de ciel dégradé (couleurs réécrites à chaque niveau)
  const sg = new THREE.SphereGeometry(6000, 32, 16);
  sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(sg.attributes.position.count * 3), 3));
  GL.sky = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  GL.sky.renderOrder = -1;
  GL.scene.add(GL.sky);
  // Mer et sol lointain
  const wg = new THREE.PlaneGeometry(EXT * 4, EXT * 4); wg.rotateX(-Math.PI / 2);
  GL.waterMat = new THREE.MeshLambertMaterial({ color: 0x4b7890 });
  GL.water = new THREE.Mesh(wg, GL.waterMat);
  GL.water.position.set(L / 2, SEA, -L / 2);
  GL.water.visible = false;
  GL.scene.add(GL.water);
  GL.skirtMat = new THREE.MeshLambertMaterial({ color: 0x3a4a22 });
  GL.skirt = new THREE.Mesh(skirtGeometry(), GL.skirtMat);
  GL.scene.add(GL.skirt);
  GL.material = new THREE.MeshLambertMaterial({ vertexColors: true });
  // Éléments de paysage : géométries partagées, instanciées à chaque niveau
  GL.feat = new THREE.Group();
  GL.scene.add(GL.feat);
  const shared = g => { g._shared = true; return g; };
  GL.geo = {
    cone: shared(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0)),
    ball: shared(new THREE.IcosahedronGeometry(1, 0)),
    trunk: shared(new THREE.CylinderGeometry(0.3, 0.45, 1, 5).translate(0, 0.5, 0)),
    box: shared(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),
    roof: shared(roofGeometry()),
    pylon: shared(new THREE.CylinderGeometry(0.3, 1.9, 1, 4).translate(0, 0.5, 0)),
    arm: shared(new THREE.BoxGeometry(1, 1, 1)),
  };
  GL.instMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  GL.roadMat = new THREE.MeshLambertMaterial({ color: 0x9a907c, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  GL.lakeMat = new THREE.MeshLambertMaterial({ color: 0x4b7890 });
  GL.cableMat = new THREE.LineBasicMaterial({ color: 0x2b3036 });
  GL.ok = true;
  new ResizeObserver(() => requestAnimationFrame(renderView)).observe(frame);
  return true;
}
function showNoGL(frame, msg) {
  const d = document.createElement('div'); d.className = 'nogl'; d.textContent = msg; frame.appendChild(d);
}
// Anneau plat autour du maillage : le sol continue jusqu'à l'horizon au lieu de s'arrêter net.
function skirtGeometry() {
  const a = X0, b = X0 + EXT, F = 30000, rects = [[-F, -F, F, a], [-F, b, F, F], [-F, a, a, b], [b, a, F, b]], pos = [];
  for (const [x0, y0, x1, y1] of rects) pos.push(x0, BASE, -y0, x1, BASE, -y0, x1, BASE, -y1, x0, BASE, -y0, x1, BASE, -y1, x0, BASE, -y1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}
function roofGeometry() {
  const P = { a: [-0.5, 0, 0.5], b: [0.5, 0, 0.5], c: [0.5, 0, -0.5], d: [-0.5, 0, -0.5], e: [-0.5, 1, 0], f: [0.5, 1, 0] };
  const tris = [['a', 'b', 'f'], ['a', 'f', 'e'], ['c', 'd', 'e'], ['c', 'e', 'f'], ['d', 'a', 'e'], ['b', 'c', 'f']];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat().flatMap(k => P[k])), 3));
  g.computeVertexNormals();
  return g;
}
// Couleur du sol selon le relief et la saison : roche sur les pentes, neige en altitude ou en hiver, sable au rivage.
function groundColor(T, h, slope, season = 'ete') {
  const R = RELIEFS[T.kind], t = clamp((h - BASE) / R.range, 0, 1);
  let r = 0.20 + 0.11 * t, g = 0.30 + 0.09 * t, b = 0.11 + 0.04 * t;
  if (season === 'automne') { r += 0.07; g -= 0.01; b -= 0.02; }
  let rock = [0.31, 0.31, 0.17], st = clamp(slope * 2.4, 0, 1) * 0.45;
  if (T.kind === 'montagne') { rock = [0.37, 0.36, 0.32]; st = clamp(slope * 1.5 - 0.1, 0, 1) * 0.85; }
  else if (T.kind === 'plateaux') { r += 0.05 * t; g -= 0.015 * t; rock = [0.47, 0.34, 0.22]; st = clamp(slope * 1.3 - 0.15, 0, 1) * 0.9; }
  r = lerp(r, rock[0], st); g = lerp(g, rock[1], st); b = lerp(b, rock[2], st);
  if (T.kind === 'montagne') {
    const sn = clamp((h - BASE - 0.72 * R.range) / 45, 0, 1) * (1 - clamp((slope - 0.55) * 2, 0, 1));
    r = lerp(r, 0.82, sn); g = lerp(g, 0.84, sn); b = lerp(b, 0.87, sn);
  }
  if (T.sea != null && h < T.sea + 4) {
    const s = clamp((T.sea + 4 - h) / 3, 0, 1);
    r = lerp(r, 0.62, s); g = lerp(g, 0.57, s); b = lerp(b, 0.40, s);
  }
  if (season === 'hiver') {
    const sn = 0.9 * (1 - clamp((slope - 0.45) * 2.2, 0, 1) * 0.75);
    r = lerp(r, 0.84, sn); g = lerp(g, 0.86, sn); b = lerp(b, 0.9, sn);
  }
  return [r, g, b];
}
function clearFeatures() {
  for (const c of [...GL.feat.children]) { GL.feat.remove(c); if (c.geometry && !c.geometry._shared) c.geometry.dispose(); if (c.dispose) c.dispose(); }
}
function instanced(geo, items, place) {
  if (!items.length) return;
  const m = new THREE.InstancedMesh(geo, GL.instMat, items.length), o = new THREE.Object3D(), col = new THREE.Color();
  items.forEach((it, i) => { place(it, o, col); o.updateMatrix(); m.setMatrixAt(i, o.matrix); m.setColorAt(i, col); });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  GL.feat.add(m);
}
function buildMesh(T, cond = COND_STD) {
  if (GL.mesh) { GL.scene.remove(GL.mesh); GL.mesh.geometry.dispose(); }
  const season = cond.saison, H = T.H, pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
  const rng = mulberry32(T.seed ^ 0x9e3779b9), patch = makeNoise(mulberry32(T.seed ^ 0x2545f491));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, h = H[k];
    pos[k * 3] = X0 + i * CELL; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -(X0 + j * CELL);
    const hx = H[j * N + Math.min(i + 1, SEG)] - H[j * N + Math.max(i - 1, 0)];
    const hy = H[Math.min(j + 1, SEG) * N + i] - H[Math.max(j - 1, 0) * N + i];
    const c = groundColor(T, h, Math.hypot(hx, hy) / (2 * CELL), season);
    const sp = (rng() - 0.5) * 0.03 + patch(i / 9, j / 9) * 0.05 + patch(i / 3.5 + 50, j / 3.5) * 0.025;
    col[k * 3] = c[0] + sp; col[k * 3 + 1] = c[1] + sp; col[k * 3 + 2] = c[2] + sp * 0.5;
  }
  const idx = new Uint32Array(SEG * SEG * 6); let q = 0;
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  GL.mesh = new THREE.Mesh(geo, GL.material);
  GL.scene.add(GL.mesh);
  GL.water.visible = T.sea != null;
  GL.skirt.visible = T.sea == null;
  GL.skirtMat.color.setRGB(...groundColor(T, BASE, 0, season));
  buildFeatures(T, season);
}
function buildFeatures(T, season) {
  clearFeatures();
  if (!T.el) return;
  const winter = season === 'hiver', autumn = season === 'automne', rng = mulberry32(T.seed ^ 0x7f4a7c15);
  // Lacs
  for (const k of T.lakes || []) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(k.R, 48).rotateX(-Math.PI / 2), GL.lakeMat);
    m.position.set(k.x, k.level, -k.y);
    GL.feat.add(m);
  }
  GL.lakeMat.color.set(winter ? 0xb9c6cf : GL.waterMat.color.getHex());
  // Routes : ruban drapé sur le relief
  GL.roadMat.color.setRGB(...(winter ? [0.6, 0.6, 0.62] : [0.6, 0.56, 0.48]));
  for (const r of T.roads || []) {
    const pts = [];
    for (let i = 0; i < r.length - 1; i++) {
      const [ax, ay] = r[i], [bx, by] = r[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
      for (let s = 0; s < n; s++) pts.push([lerp(ax, bx, s / n), lerp(ay, by, s / n)]);
    }
    pts.push(r[r.length - 1]);
    const pos = [], ix = [];
    pts.forEach(([x, y], i) => {
      const [px, py] = pts[Math.max(0, i - 1)], [nx, ny] = pts[Math.min(pts.length - 1, i + 1)], len = Math.hypot(nx - px, ny - py) || 1;
      const ox = -(ny - py) / len * 2.6, oy = (nx - px) / len * 2.6;
      for (const sgn of [-1, 1]) { const qx = x + sgn * ox, qy = y + sgn * oy; pos.push(qx, heightAt(T, qx, qy) + 0.5, -qy); }
      if (i) { const a = (i - 1) * 2; ix.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(ix); g.computeVertexNormals();
    GL.feat.add(new THREE.Mesh(g, GL.roadMat));
  }
  // Maisons : murs et toits
  const slate = T.kind === 'montagne';
  instanced(GL.geo.box, T.houses || [], (h, o, c) => {
    o.position.set(h.x, heightAt(T, h.x, h.y) - 0.8, -h.y); o.rotation.set(0, h.a, 0); o.scale.set(h.w, h.h + 0.8, h.d);
    c.setRGB(0.8, 0.76, 0.68);
  });
  instanced(GL.geo.roof, T.houses || [], (h, o, c) => {
    o.position.set(h.x, heightAt(T, h.x, h.y) + h.h, -h.y); o.rotation.set(0, h.a, 0); o.scale.set(h.w * 1.06, 2.2 + 0.3 * h.d, h.d * 1.14);
    if (winter) c.setRGB(0.88, 0.9, 0.93); else if (slate) c.setRGB(0.28, 0.3, 0.34); else c.setRGB(0.56, 0.27, 0.18);
  });
  // Pylônes et câbles
  if (T.pylons && T.pylons.length) {
    instanced(GL.geo.pylon, T.pylons, (p, o, c) => { o.position.set(p.x, heightAt(T, p.x, p.y), -p.y); o.rotation.set(0, p.a + Math.PI / 4, 0); o.scale.set(1, 30, 1); c.setRGB(0.36, 0.38, 0.4); });
    instanced(GL.geo.arm, T.pylons, (p, o, c) => { o.position.set(p.x, heightAt(T, p.x, p.y) + 25, -p.y); o.rotation.set(0, p.a + Math.PI / 2, 0); o.scale.set(13, 0.7, 0.7); c.setRGB(0.36, 0.38, 0.4); });
    const v = [];
    for (const [a, b] of T.spans) {
      const ha = heightAt(T, a.x, a.y), hb = heightAt(T, b.x, b.y), px = -Math.sin(a.a), py = Math.cos(a.a);
      for (const [off, z] of [[-6, 25], [6, 25], [0, 30]]) {
        for (let s = 0; s < 12; s++) {
          for (const t of [s / 12, (s + 1) / 12]) {
            const x = lerp(a.x, b.x, t) + px * off, y = lerp(a.y, b.y, t) + py * off;
            v.push(x, lerp(ha, hb, t) + z - 4 * (1 - (2 * t - 1) ** 2), -y);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    GL.feat.add(new THREE.LineSegments(g, GL.cableMat));
  }
  // Arbres : conifères et feuillus, teintés selon la saison
  if (T.canopy) {
    const conif = T.kind === 'montagne' ? 0.85 : T.kind === 'cretes' ? 0.5 : 0.35, cones = [], balls = [];
    const lim = Math.round(0.25 * L / CELL);
    for (let j = I0 - lim; j < I1 + lim; j++) for (let i = I0 - lim; i < I1 + lim; i++) {
      if (!T.canopy[j * N + i]) continue;
      const n = rng() < 0.35 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const x = X0 + (i + rng()) * CELL, y = X0 + (j + rng()) * CELL, h = 10 + 7 * rng(), tint = rng();
        if (canopyAt(T, x, y) < 10) continue;
        (rng() < conif ? cones : balls).push({ x, y, h, tint, z: heightAt(T, x, y) });
      }
    }
    const leaf = (t, c) => {
      if (winter) return c.setRGB(0.34 + 0.05 * t, 0.3 + 0.04 * t, 0.26 + 0.03 * t);
      if (autumn) { const p = [[0.56, 0.3, 0.08], [0.5, 0.17, 0.08], [0.62, 0.5, 0.12], [0.32, 0.34, 0.12]][Math.floor(t * 4)]; return c.setRGB(...p); }
      c.setRGB(0.15 + 0.06 * t, 0.29 + 0.07 * t, 0.11 + 0.03 * t);
    };
    instanced(GL.geo.cone, cones, (tr, o, c) => {
      o.position.set(tr.x, tr.z - 0.6, -tr.y); o.rotation.set(0, tr.tint * 6.28, 0); o.scale.set(tr.h * 0.27, tr.h, tr.h * 0.27);
      if (winter) c.setRGB(0.3 + 0.08 * tr.tint, 0.38 + 0.06 * tr.tint, 0.35 + 0.06 * tr.tint); else c.setRGB(0.09 + 0.04 * tr.tint, 0.2 + 0.06 * tr.tint, 0.1 + 0.03 * tr.tint);
    });
    instanced(GL.geo.trunk, balls, (tr, o, c) => { o.position.set(tr.x, tr.z - 0.5, -tr.y); o.rotation.set(0, 0, 0); o.scale.set(1, tr.h * 0.5, 1); c.setRGB(0.27, 0.21, 0.15); });
    instanced(GL.geo.ball, balls, (tr, o, c) => {
      const r = tr.h * (winter ? 0.3 : 0.36);
      o.position.set(tr.x, tr.z + tr.h - r, -tr.y); o.rotation.set(tr.tint * 3, tr.tint * 6.28, 0); o.scale.set(r, r * 1.15, r);
      leaf(tr.tint, c);
    });
  }
}
// Ambiance du niveau : ciel, brume, soleil. En extrême, le soleil prend un azimut au hasard.
function setAtmosphere(cond, sunAz) {
  const sk = SKY[cond.heure], B = COND.brume[cond.brume];
  const hz = new THREE.Color(sk.horizon), zn = new THREE.Color(sk.zenith);
  if (cond.saison === 'hiver') hz.lerp(new THREE.Color(0xaab1ba), 0.3);
  if (cond.brume === 'epaisse') { hz.lerp(new THREE.Color(0x9aa1a8), 0.45); zn.lerp(hz, 0.4); }
  if (cond.brume === 'claire') zn.lerp(new THREE.Color(0x2f5a96), 0.25);
  GL.scene.background.copy(hz);
  GL.scene.fog.color.copy(hz); GL.scene.fog.near = B.near; GL.scene.fog.far = B.far;
  const sp = GL.sky.geometry.attributes.position, sc = GL.sky.geometry.attributes.color;
  for (let i = 0; i < sp.count; i++) {
    const t = Math.pow(clamp(sp.getY(i) / 6000, 0, 1), 0.55), c = hz.clone().lerp(zn, t);
    sc.setXYZ(i, c.r, c.g, c.b);
  }
  sc.needsUpdate = true;
  const saz = (sunAz ?? sk.az) * DEG, sel = sk.el * DEG;
  GL.sun.position.set(Math.sin(saz) * Math.cos(sel), Math.sin(sel), -Math.cos(saz) * Math.cos(sel));
  GL.sun.color.setHex(sk.sun); GL.sun.intensity = sk.si;
  GL.hemi.intensity = sk.hemi;
  GL.waterMat.color.setHex(0x4b7890).lerp(hz, cond.heure === 'soir' ? 0.3 : 0.12);
}
function renderView() {
  const P = run && run.puzzle;
  if (!GL.ok || !P) return;
  const frame = document.getElementById('viewFrame'), w = frame.clientWidth, h = frame.clientHeight;
  if (!w || !h) return;
  GL.renderer.setSize(w, h, false);
  const cam = GL.camera, V = COND.hauteur[(P.cond || COND_STD).hauteur];
  cam.aspect = w / h;
  cam.fov = 2 * Math.atan(Math.tan(HFOV / 2 * DEG) / cam.aspect) / DEG;
  cam.updateProjectionMatrix();
  const p = P.pts[P.ans], e = heightAt(P.T, p.x, p.y) + V.eye, az = P.az * DEG;
  cam.position.set(p.x, e, -p.y);
  cam.lookAt(p.x + Math.sin(az), e + Math.tan(V.pitch * DEG), -p.y - Math.cos(az));
  GL.sky.position.copy(cam.position);
  GL.renderer.render(GL.scene, cam);
}

// ------------------------------------------------------------ Partie
const $ = id => document.getElementById(id);
const radio = n => document.querySelector(`input[name=${n}]:checked`).value;
let run = null;
let tickTimer = null, fbTimer = null;

const RADIO_KEYS = ['mode', 'diff', 'relief', 'rot', 'pression', 'tlim', 'retry', 'cond', 'hauteur', 'brume', 'heure', 'saison'];
function readSettings() {
  const el = [...document.querySelectorAll('input[name=el]:checked')].reduce((m, i) => m | +i.value, 0);
  return { levels: +$('levels').value, mode: radio('mode'), diff: radio('diff'), relief: radio('relief'), rot: radio('rot'),
    pression: radio('pression'), tlim: +radio('tlim'), retry: radio('retry'), el,
    cond: radio('cond'), hauteur: radio('hauteur'), brume: radio('brume'), heure: radio('heure'), saison: radio('saison') };
}
function applySettings(s) {
  $('levels').value = s.levels;
  for (const k of RADIO_KEYS) document.querySelector(`input[name=${k}][value="${s[k]}"]`).checked = true;
  document.querySelectorAll('input[name=el]').forEach(i => { i.checked = !!(s.el & +i.value); });
  syncSetup();
}
function diffForLevel(i, n, setting) {
  if (setting !== 'progressif') return setting;
  if (n === 1) return 'facile';
  const t = i / n;
  return t < 1 / 3 ? 'facile' : t < 2 / 3 ? 'normal' : 'difficile';
}
// En relief varié, chaque type revient avant qu'un autre se répète.
function reliefSequence(setting, n, rng) {
  if (setting !== 'varie') return Array(n).fill(setting);
  const out = [];
  while (out.length < n) {
    const bag = shuffle([...RELIEF_KEYS], rng);
    if (out.length && bag[0] === out[out.length - 1]) bag.push(bag.shift());
    out.push(...bag);
  }
  return out.slice(0, n);
}
function show(id) { for (const s of ['setup', 'game', 'stats']) $(s).hidden = s !== id; window.scrollTo(0, 0); }
const isFree = () => run.settings.mode === 'libre';
const usedMs = () => run.levels.reduce((s, l) => s + l.ms, 0);
const runScore = () => run.levels.reduce((s, l) => s + l.score, 0);

function startRun(seed = setupSeed) {
  const st = readSettings();
  const reliefs = reliefSequence(st.relief, st.levels, mulberry32(mix32(seed ^ 0xa5c3e1f7)));
  setupSeed = randomSeed();   // la prochaine partie lancée depuis l'accueil repart d'une autre graine
  run = {
    total: st.levels, cur: 0, seed, code: encodeCode(seed, st), settings: st, budget: st.tlim * st.levels * 1000,
    levels: Array.from({ length: st.levels }, (_, i) => ({
      n: i + 1, diffKey: diffForLevel(i, st.levels, st.diff), relief: reliefs[i], attempts: [], ms: 0,
      done: false, hit: false, dist: null, fail: null, score: 0, terrains: 0, rot: null, az: 0, cond: pickConditions(st, condRng(seed, i)),
    })),
    puzzle: null, locked: true, attemptStart: 0, eliminated: new Set(), ended: null, pin: null, pinSvg: null,
  };
  show('game');
  if (!initGL()) return;
  clearInterval(tickTimer); tickTimer = setInterval(tick, 200);
  startLevel(true);
}

function startLevel(newTerrain) {
  const lv = run.levels[run.cur];
  hideFeedback();
  run.eliminated.clear();
  updateHud();
  if (newTerrain) {
    $('loading').hidden = false;
    run.locked = true;
    setTimeout(() => {
      run.puzzle = buildPuzzle(lv.diffKey, lv.relief, run.settings.rot, levelRng(run.seed, run.cur, lv.terrains), { el: run.settings.el, cond: lv.cond });
      lv.terrains++;
      lv.az = run.puzzle.az;
      lv.rot = run.puzzle.rot;
      buildMesh(run.puzzle.T, lv.cond);
      setAtmosphere(lv.cond, DIFFS[lv.diffKey].facing === 'cache' ? mix32(run.puzzle.T.seed) % 360 : null);
      run.lvls = contours(run.puzzle.T, contourMargin(run.puzzle.rot));
      presentPuzzle();
      $('loading').hidden = true;
    }, 40);
  } else presentPuzzle();
}

function presentPuzzle() {
  const P = run.puzzle, free = isFree();
  drawMap($('map'), P.T, run.lvls, { id: 'm', rot: P.rot, pts: free ? [] : P.pts });
  run.pin = null; run.pinSvg = null;
  if (free) {
    $('answers').innerHTML = `<button class="btn primary" id="guessBtn" disabled>Valider cette position</button>`;
    $('guessBtn').addEventListener('click', guess);
    $('mapHint').textContent = 'Touchez la carte là où vous pensez être, puis validez.';
  } else {
    $('map').querySelectorAll('.pt').forEach(g => g.addEventListener('click', () => answer(+g.dataset.i)));
    $('answers').innerHTML = P.pts.map((_, i) => `<button class="ans" data-i="${i}" aria-label="Point ${LETTERS[i]}">${LETTERS[i]}</button>`).join('');
    $('answers').querySelectorAll('.ans').forEach(b => b.addEventListener('click', () => answer(+b.dataset.i)));
    $('mapHint').textContent = 'Touchez le point où vous vous trouvez.';
  }
  $('facing').innerHTML = DIFFS[P.diffKey].facing === 'cache' ? 'Direction du regard <b>inconnue</b>' : `Vous regardez vers l${P.az === 0 ? 'e <b>nord</b>' : P.az === 90 ? '\u2019<b>est</b>' : P.az === 180 ? 'e <b>sud</b>' : '\u2019<b>ouest</b>'}`;
  $('mapFrame').classList.toggle('free', free);
  $('mapFrame').classList.remove('locked');
  $('viewCap').textContent = viewCaption(P.cond || COND_STD);
  $('mapLegend').innerHTML = mapLegend(P.T);
  $('mapLegend').hidden = !P.T.el;
  $('mapHint').hidden = false;
  renderView();
  run.locked = false;
  run.attemptStart = performance.now();
  updateHud();
}

const COND_TXT = {
  hauteur: { debout: 'à hauteur d\u2019yeux', tour: 'du haut d\u2019une tour de 25 m', drone: 'depuis un drone à 120 m' },
  brume: { claire: 'par temps clair', legere: 'par légère brume', epaisse: 'dans une brume épaisse' },
  heure: { matin: 'le matin', midi: 'à midi', apresmidi: 'l\u2019après-midi', soir: 'au coucher du soleil' },
  saison: { ete: 'en été', automne: 'en automne', hiver: 'en hiver' },
};
const COND_SHORT = {
  hauteur: { debout: 'debout', tour: 'tour', drone: 'drone' }, brume: { claire: 'temps clair', legere: 'légère brume', epaisse: 'brume épaisse' },
  heure: { matin: 'matin', midi: 'midi', apresmidi: 'après-midi', soir: 'soir' }, saison: { ete: 'été', automne: 'automne', hiver: 'hiver' },
};
function viewCaption(c) {
  if (COND_KEYS.every(k => c[k] === COND_STD[k])) return 'Vue à hauteur d\u2019yeux depuis un endroit de la carte.';
  return `Vue ${COND_TXT.hauteur[c.hauteur]}, ${COND_TXT.heure[c.heure]}, ${COND_TXT.saison[c.saison]}, ${COND_TXT.brume[c.brume]}.`;
}
const condShort = c => COND_KEYS.map(k => COND_SHORT[k][c[k]]).join(', ');
function mapLegend(T) {
  if (!T.el) return '';
  const it = [];
  const sw = (inner, label) => it.push(`<span><svg viewBox="0 0 26 14" aria-hidden="true">${inner}</svg>${label}</span>`);
  if (T.canopy) sw('<rect x="1" y="1" width="24" height="12" rx="2" fill="var(--forest)" stroke="var(--rule)"/>', 'Forêt');
  if (T.lakes && T.lakes.length) sw('<rect x="1" y="1" width="24" height="12" rx="6" fill="var(--water)" stroke="var(--shore)" stroke-width="1.5"/>', 'Lac');
  if (T.roads && T.roads.length) sw('<path d="M1 7H25" stroke="var(--ink)" stroke-width="5"/><path d="M1 7H25" stroke="var(--road)" stroke-width="2.6"/>', 'Route');
  if (T.houses && T.houses.length) sw('<rect x="3" y="4" width="7" height="6" fill="var(--ink)"/><rect x="14" y="3" width="9" height="7" fill="var(--ink)"/>', 'Hameau');
  if (T.pylons && T.pylons.length) sw('<path d="M1 7H25" stroke="var(--ink)" stroke-width="1.2"/><rect x="4" y="4.5" width="5" height="5" fill="var(--ink)"/><rect x="17" y="4.5" width="5" height="5" fill="var(--ink)"/>', 'Ligne électrique');
  return it.join('');
}
function lock() {
  run.locked = true;
  $('mapFrame').classList.add('locked');
  $('mapHint').hidden = true;
  $('answers').querySelectorAll('button').forEach(b => b.disabled = true);
  if ($('guessBtn')) $('guessBtn').hidden = true;
}
function advance() { if (run.cur === run.total - 1) finishRun(); else { run.cur++; startLevel(true); } }
const nextLabel = () => run.cur === run.total - 1 ? 'Voir les statistiques' : 'Niveau suivant';
const levelScore = (lv, factor) => Math.round(1000 * DIFFS[lv.diffKey].mult * factor * clamp(1.15 - lv.ms / 1000 / 90, 0.4, 1));

// ---- Réponse parmi des points
function answer(i) {
  if (!run || run.locked || isFree() || run.eliminated.has(i)) return;
  const P = run.puzzle, lv = run.levels[run.cur], st = run.settings;
  const ms = performance.now() - run.attemptStart;
  const correct = i === P.ans;
  lv.attempts.push({ ms, choice: LETTERS[i], answer: LETTERS[P.ans], correct });
  lv.ms += ms;
  lock();
  const ptEls = $('map').querySelectorAll('.pt'), ansEls = $('answers').querySelectorAll('.ans');
  const mark = (k, cls) => { ptEls[k].classList.add(cls); ansEls[k].classList.add(cls); };

  if (correct) {
    lv.done = true;
    lv.score = Math.round(levelScore(lv, 1) / lv.attempts.length);
    revealCone('var(--ok)');
    mark(i, 'ok');
    showFeedback('ok', `Bien vu, vous étiez en ${LETTERS[i]}.<small>Réponse en ${fmtSec(ms)}, +${fmtInt(lv.score)} points</small>`, nextLabel(), 1700, advance);
  } else {
    mark(i, 'bad');
    shake();
    if (st.pression === 'mort') {
      lv.fail = 'mort'; run.ended = 'mort';
      revealCone('var(--ok)'); mark(P.ans, 'ok');
      showFeedback('bad', `Raté, vous étiez en ${LETTERS[P.ans]}, pas en ${LETTERS[i]}.<small>Mort subite : la partie s\u2019arrête ici.</small>`, 'Voir les statistiques', 0, finishRun);
    } else if (st.retry === 'nouveau') {
      revealCone('var(--ok)'); mark(P.ans, 'ok');
      showFeedback('bad', `Raté, vous étiez en ${LETTERS[P.ans]}, pas en ${LETTERS[i]}.<small>Le niveau recommence sur un nouveau terrain.</small>`,
        'Recommencer le niveau', 2800, () => startLevel(true));
    } else {
      run.eliminated.add(i);
      showFeedback('bad', `Ce n\u2019est pas ${LETTERS[i]}.<small>Même terrain, cherchez encore.</small>`, null, 0, null);
      setTimeout(() => {
        if (run.ended) return;
        ptEls[i].classList.remove('bad'); ansEls[i].classList.remove('bad');
        ptEls[i].classList.add('gone'); ansEls[i].classList.add('gone');
        ansEls.forEach((b, k) => b.disabled = run.eliminated.has(k));
        $('mapFrame').classList.remove('locked');
        $('mapHint').hidden = false;
        run.locked = false;
        run.attemptStart = performance.now();
        updateHud();
      }, 700);
    }
  }
  updateHud();
}

// ---- Clic libre, score à la distance
function onMapClick(e) {
  if (!run || run.locked || !isFree() || !run.puzzle) return;
  const svg = $('map'), pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const q = pt.matrixTransform(svg.getScreenCTM().inverse());
  if (q.x < PAD || q.x > PAD + S || q.y < PAD || q.y > PAD + S) return;
  setPin(q.x, q.y);
}
function setPin(X, Y) {
  run.pinSvg = [X, Y];
  run.pin = fromSvg(X, Y, run.puzzle.rot);
  const g = $('m-marks'), old = g.querySelector('.pin');
  if (old) old.remove();
  g.insertAdjacentHTML('beforeend', `<g class="pin" transform="translate(${f1(X)} ${f1(Y)})"><circle r="22"/><path d="M0 -38V-26M0 26V38M-38 0H-26M26 0H38"/><circle class="dot" r="4.5"/></g>`);
  $('guessBtn').disabled = false;
}
const distFactor = d => d <= 25 ? 1 : Math.exp(-(d - 25) / 230);
function guess() {
  if (!run || run.locked || !isFree() || !run.pin) return;
  const P = run.puzzle, lv = run.levels[run.cur], cfg = DIFFS[lv.diffKey], st = run.settings;
  const ms = performance.now() - run.attemptStart, tgt = P.pts[P.ans];
  const d = Math.hypot(run.pin.x - tgt.x, run.pin.y - tgt.y), hit = d <= cfg.tol;
  lv.ms += ms;
  lv.attempts.push({ ms, dist: d, correct: hit });
  lv.done = true; lv.dist = d; lv.hit = hit;
  lv.score = levelScore(lv, distFactor(d));
  lock();
  revealCone('var(--ok)');
  revealFree();
  if (!hit) shake();
  const pts = `+${fmtInt(lv.score)} point${lv.score > 1 ? 's' : ''}`;
  if (!hit && st.pression === 'mort') {
    lv.fail = 'mort'; run.ended = 'mort';
    showFeedback('bad', `Trop loin, ${fmtDist(d)} d\u2019écart.<small>Hors de la zone de ${cfg.tol} m : mort subite, la partie s\u2019arrête ici. ${pts}</small>`, 'Voir les statistiques', 0, finishRun);
  } else if (hit) {
    showFeedback('ok', `Bien vu, à ${fmtDist(d)} près.<small>Dans la zone de ${cfg.tol} m, ${pts}</small>`, nextLabel(), 3000, advance);
  } else {
    showFeedback('bad', `Trop loin, ${fmtDist(d)} d\u2019écart.<small>La zone de réussite fait ${cfg.tol} m, ${pts}</small>`, nextLabel(), 3400, advance);
  }
  updateHud();
}
// Montre la vraie position, la zone de réussite et l'écart avec le clic.
function revealFree() {
  const P = run.puzzle, g = $('m-marks'), tgt = P.pts[P.ans], [tx, ty] = toSvg(tgt.x, tgt.y, P.rot);
  const tol = DIFFS[P.diffKey].tol / L * S;
  let h = `<circle class="zone" cx="${f1(tx)}" cy="${f1(ty)}" r="${f1(tol)}"/>`;
  if (run.pinSvg) {
    const [px, py] = run.pinSvg, len = Math.hypot(px - tx, py - ty);
    if (len > 40) {
      const nx = -(py - ty) / len, ny = (px - tx) / len, mx = (px + tx) / 2 + nx * 26, my = (py + ty) / 2 + ny * 26;
      h += `<line class="gap" x1="${f1(px)}" y1="${f1(py)}" x2="${f1(tx)}" y2="${f1(ty)}"/>` +
        `<text class="gap-label" x="${f1(mx)}" y="${f1(my)}">${fmtDist(Math.hypot(run.pin.x - tgt.x, run.pin.y - tgt.y))}</text>`;
    }
  }
  h += `<g class="truth" transform="translate(${f1(tx)} ${f1(ty)})"><circle r="30"/><circle class="dot" r="5"/></g>`;
  g.insertAdjacentHTML('afterbegin', h);
}

// ---- Pression : temps écoulé
function timeUp(global) {
  const P = run.puzzle, lv = run.levels[run.cur], st = run.settings, free = isFree();
  const ms = Math.max(0, global ? run.budget - usedMs() : st.tlim * 1000 - lv.ms);
  lv.ms += ms;
  lv.attempts.push({ ms, timeout: true, correct: false, choice: '\u2013', answer: LETTERS[P.ans] });
  lv.fail = 'temps';
  lock();
  revealCone('var(--ok)');
  if (free) revealFree();
  else { $('map').querySelectorAll('.pt')[P.ans].classList.add('ok'); $('answers').querySelectorAll('.ans')[P.ans].classList.add('ok'); }
  shake();
  const where = free ? 'la bonne position est en vert' : `vous étiez en ${LETTERS[P.ans]}`;
  if (global) {
    run.ended = 'temps';
    showFeedback('bad', `Temps écoulé, ${where}.<small>Le chrono de la partie est à zéro.</small>`, 'Voir les statistiques', 0, finishRun);
  } else {
    showFeedback('bad', `Temps écoulé, ${where}.<small>Niveau perdu, on passe au suivant.</small>`, nextLabel(), 2800, advance);
  }
  updateHud();
}

function revealCone(color) {
  const P = run.puzzle;
  const clip = $('map').querySelector('g[clip-path]');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', conePath(P.pts[P.ans], P.az, P.rot));
  path.setAttribute('fill', color); path.setAttribute('fill-opacity', '.2');
  path.setAttribute('stroke', color); path.setAttribute('stroke-width', '3'); path.setAttribute('stroke-dasharray', '10 8');
  clip.appendChild(path);
}
function shake() {
  $('mapFrame').classList.add('shake');
  setTimeout(() => $('mapFrame').classList.remove('shake'), 400);
}

function showFeedback(kind, html, btnLabel, autoMs, action) {
  clearTimeout(fbTimer);
  const fb = $('feedback');
  fb.className = 'feedback ' + kind; fb.hidden = false;
  $('fbText').innerHTML = html;
  const btn = $('fbBtn'), bar = $('fbBar');
  bar.style.transition = 'none'; bar.style.width = '0';
  if (btnLabel) {
    btn.hidden = false; btn.textContent = btnLabel;
    const go = () => { clearTimeout(fbTimer); fbTimer = null; btn.onclick = null; fb._go = null; action(); };
    btn.onclick = go;
    fb._go = go;
    if (autoMs) {
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = `width ${autoMs}ms linear`; bar.style.width = '100%'; }));
      fbTimer = setTimeout(go, autoMs);
    }
  } else { btn.hidden = true; fb._go = null; }
}
function hideFeedback() { clearTimeout(fbTimer); $('feedback').hidden = true; $('feedback')._go = null; }

function updateHud() {
  if (!run) return;
  const lv = run.levels[run.cur], free = isFree();
  $('hudLevel').textContent = `Niveau ${run.cur + 1}`;
  $('hudOf').textContent = `sur ${run.total}`;
  $('hudDiff').textContent = DIFFS[lv.diffKey].name;
  $('hudDiff').dataset.k = lv.diffKey;
  $('hudRelief').textContent = RELIEFS[lv.relief].name;
  $('hudTry').innerHTML = free ? `Score <b>${fmtInt(runScore())}</b>`
    : `Essai <b>${Math.max(1, lv.attempts.length + (run.locked && lv.attempts.length ? 0 : 1))}</b>`;
  $('pips').innerHTML = run.levels.map((l, i) => {
    const c = l.fail ? 'fail' : l.done ? (free && !l.hit ? 'miss' : 'done') : i === run.cur ? 'cur' : '';
    return `<li class="${c}"></li>`;
  }).join('');
  tick();
}
function tick() {
  if (!run || $('game').hidden) return;
  const lv = run.levels[run.cur], st = run.settings;
  const live = run.locked ? 0 : performance.now() - run.attemptStart;
  let ms = lv.ms + live, left = null, frac = 1;
  if (st.pression === 'niveau') { left = st.tlim * 1000 - ms; frac = left / (st.tlim * 1000); }
  else if (st.pression === 'global') { left = run.budget - usedMs() - live; frac = left / run.budget; }
  if (left !== null && left <= 0 && !run.locked && !run.ended) { timeUp(st.pression === 'global'); return; }
  const count = left !== null, warn = count && left < 10000;
  $('hudTimeLbl').textContent = !count ? 'Temps' : st.pression === 'global' ? 'Partie' : 'Reste';
  $('hudTime').textContent = count ? fmtClock(Math.max(0, left), true) : fmtClock(ms);
  $('hudTime').classList.toggle('warn', warn);
  $('clock').hidden = !count;
  if (count) { $('clockBar').style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%'; $('clock').classList.toggle('warn', warn); }
}

let quitArmed = false;
function quit() {
  const b = $('quitBtn');
  if (!quitArmed) {
    quitArmed = true; b.textContent = 'Confirmer l\u2019abandon'; b.classList.add('danger');
    setTimeout(() => { quitArmed = false; b.textContent = 'Abandonner'; b.classList.remove('danger'); }, 3000);
    return;
  }
  quitArmed = false; b.textContent = 'Abandonner'; b.classList.remove('danger');
  if (!run.locked) { const lv = run.levels[run.cur]; lv.ms += performance.now() - run.attemptStart; }
  if (!run.ended) run.ended = 'abandon';
  finishRun();
}

// ------------------------------------------------------------ Statistiques
function fmtSec(ms) {
  const s = ms / 1000;
  if (s < 60) return s.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '\u202fs';
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  return `${m}\u202fmin\u202f${String(r).padStart(2, '0')}\u202fs`;
}
function fmtClock(ms, up) { const s = up ? Math.ceil(ms / 1000) : Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
const fmtDist = m => m < 1000 ? `${Math.round(m)}\u202fm` : (m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + '\u202fkm';
const fmtInt = n => n.toLocaleString('fr-FR');
const pct = x => Math.round(x * 100) + '\u202f%';
const plural = (n, w) => `${n} ${w}${n > 1 ? (w.endsWith('eau') ? 'x' : 's') : ''}`;
const agree = (n, w) => w + (n > 1 ? 's' : '');
const rotLabel = l => l.rot ? `, carte à ${l.rot}°` : '';
const realErrors = l => l.attempts.filter(a => !a.correct && !a.timeout).length;

function groupRows(levels, groups, free) {
  return groups.map(([label, test]) => {
    const g = levels.filter(test);
    if (!g.length) return null;
    if (free) {
      const shots = g.filter(l => l.done), hits = shots.filter(l => l.hit).length;
      const avgD = shots.length ? shots.reduce((s, l) => s + l.dist, 0) / shots.length : 0;
      const avgT = g.reduce((s, l) => s + l.ms, 0) / g.length;
      return `<tr><td>${label}</td><td class="r">${g.length}</td><td class="r">${pct(hits / g.length)}</td><td class="r">${shots.length ? fmtDist(avgD) : '–'}</td><td class="r">${fmtSec(avgT)}</td></tr>`;
    }
    const done = g.filter(l => l.done), first = done.filter(l => l.attempts.length === 1).length;
    const errs = g.reduce((s, l) => s + realErrors(l), 0);
    const avg = done.length ? done.reduce((s, l) => s + l.ms, 0) / done.length : 0;
    return `<tr><td>${label}</td><td class="r">${done.length}/${g.length}</td><td class="r">${done.length ? pct(first / done.length) : '–'}</td><td class="r">${errs}</td><td class="r">${done.length ? fmtSec(avg) : '–'}</td></tr>`;
  }).filter(Boolean).join('');
}
const groupHead = (first, free) => free
  ? `<tr><th>${first}</th><th class="r">Joués</th><th class="r">Dans la zone</th><th class="r">Écart moyen</th><th class="r">Temps moyen</th></tr>`
  : `<tr><th>${first}</th><th class="r">Réussis</th><th class="r">1er essai</th><th class="r">Erreurs</th><th class="r">Temps moyen</th></tr>`;

function finishRun() {
  clearInterval(tickTimer); hideFeedback();
  run.locked = true;
  const st = run.settings, free = st.mode === 'libre';
  const played = run.levels.filter(l => l.attempts.length || l.done);
  const totalMs = played.reduce((s, l) => s + l.ms, 0);
  const score = runScore();
  const lost = played.filter(l => l.fail === 'temps').length;
  const at = `au niveau ${run.cur + 1}. `;
  const endTxt = { abandon: 'Partie abandonnée ' + at, mort: 'Mort subite ' + at, temps: 'Temps écoulé ' + at }[run.ended] || '';
  const lostTxt = lost ? ` ${plural(lost, 'niveau')} ${agree(lost, 'perdu')} au chrono.` : '';
  const fig = (dt, dd, sub, minor) => `<div${minor ? ' class="minor"' : ''}><dt>${dt}</dt><dd>${dd}${sub ? `<small>${sub}</small>` : ''}</dd></div>`;
  let F = '', rank, avgTime, avgDist = 0;

  if (free) {
    const shots = played.filter(l => l.done), hits = shots.filter(l => l.hit);
    avgDist = shots.length ? shots.reduce((s, l) => s + l.dist, 0) / shots.length : 0;
    avgTime = played.length ? totalMs / played.length : 0;
    const byD = [...shots].sort((a, b) => a.dist - b.dist);
    const hitRate = played.length ? hits.length / played.length : 0;
    let streak = 0, best = 0;
    for (const l of run.levels) { if (l.hit) { streak++; best = Math.max(best, streak); } else if (l.attempts.length) streak = 0; }
    if (!shots.length) rank = 'Partie trop courte pour un classement';
    else if (avgDist <= 70 && hitRate >= 0.9) rank = 'Cartographe d\u2019élite';
    else if (avgDist <= 140) rank = 'Orienteur confirmé';
    else if (avgDist <= 260) rank = 'Randonneur attentif';
    else rank = 'Promeneur égaré, mais tenace';
    $('statsSummary').textContent = endTxt + (shots.length
      ? `${plural(played.length, 'niveau')} ${agree(played.length, 'joué')} sur ${run.total}, à ${fmtDist(avgDist)} en moyenne de la vraie position.`
      : `Aucune position validée sur ${plural(run.total, 'niveau')}.`) + lostTxt;
    F += fig('Dans la zone', played.length ? pct(hitRate) : '–', `${hits.length} sur ${plural(played.length, 'niveau')}`);
    F += fig('Écart moyen', shots.length ? fmtDist(avgDist) : '–', 'entre le clic et la vraie position');
    F += fig('Clic le plus précis', byD.length ? fmtDist(byD[0].dist) : '–', byD.length ? `niveau ${byD[0].n}, ${RELIEFS[byD[0].relief].name.toLowerCase()}` : '');
    F += fig('Temps total', fmtSec(totalMs), 'chronos cumulés');
    F += fig('Temps moyen par niveau', played.length ? fmtSec(avgTime) : '–', 'de l\u2019affichage à la validation', true);
    if (byD.length > 1) F += fig('Clic le plus éloigné', fmtDist(byD[byD.length - 1].dist), `niveau ${byD[byD.length - 1].n}`, true);
    F += fig('Meilleure série', String(best), 'niveaux d\u2019affilée dans la zone', true);
    if (st.pression === 'niveau' || st.pression === 'global') F += fig('Temps écoulés', String(lost), 'niveaux perdus au chrono', true);
  } else {
    const done = run.levels.filter(l => l.done);
    const answers = played.reduce((s, l) => s + l.attempts.filter(a => !a.timeout).length, 0);
    const errors = played.reduce((s, l) => s + realErrors(l), 0);
    const first = done.filter(l => l.attempts.length === 1);
    avgTime = done.length ? done.reduce((s, l) => s + l.ms, 0) / done.length : 0;
    const avgAnswer = answers ? played.reduce((s, l) => s + l.attempts.filter(a => !a.timeout).reduce((t, a) => t + a.ms, 0), 0) / answers : 0;
    let streak = 0, best = 0;
    for (const l of run.levels) { if (l.done && l.attempts.length === 1) { streak++; best = Math.max(best, streak); } else if (l.attempts.length) streak = 0; }
    const byMs = [...done].sort((a, b) => a.ms - b.ms);
    const tough = [...done].sort((a, b) => b.attempts.length - a.attempts.length || b.ms - a.ms)[0];
    const firstRate = done.length ? first.length / done.length : 0;
    if (!done.length) rank = 'Partie trop courte pour un classement';
    else if (firstRate >= 0.9 && avgTime < 25000) rank = 'Cartographe d\u2019élite';
    else if (firstRate >= 0.75) rank = 'Orienteur confirmé';
    else if (firstRate >= 0.5) rank = 'Randonneur attentif';
    else rank = 'Promeneur égaré, mais tenace';
    $('statsSummary').textContent = endTxt
      + `${plural(done.length, 'niveau')} ${agree(done.length, 'réussi')} sur ${run.total}, en ${fmtSec(totalMs)} de réflexion, dont ${first.length} du premier coup.` + lostTxt;
    F += fig('Réussite au premier essai', done.length ? pct(firstRate) : '–', `${first.length} sur ${plural(done.length, 'niveau')}`);
    F += fig('Temps total', fmtSec(totalMs), 'chronos cumulés des réponses');
    F += fig('Temps moyen par niveau', done.length ? fmtSec(avgTime) : '–', 'niveaux réussis');
    F += fig('Erreurs', String(errors), `sur ${plural(answers, 'réponse')}`);
    F += fig('Précision globale', answers ? pct(done.length / answers) : '–', 'bonnes réponses sur réponses données', true);
    F += fig('Temps moyen par réponse', answers ? fmtSec(avgAnswer) : '–', 'de l\u2019affichage au choix', true);
    F += fig('Meilleure série', String(best), 'niveaux d\u2019affilée sans erreur', true);
    if (byMs.length) F += fig('Niveau le plus rapide', fmtSec(byMs[0].ms), `niveau ${byMs[0].n}, ${DIFFS[byMs[0].diffKey].name.toLowerCase()}`, true);
    if (byMs.length > 1) F += fig('Niveau le plus long', fmtSec(byMs[byMs.length - 1].ms), `niveau ${byMs[byMs.length - 1].n}, ${DIFFS[byMs[byMs.length - 1].diffKey].name.toLowerCase()}`, true);
    if (tough && tough.attempts.length > 1) F += fig('Niveau le plus coriace', plural(tough.attempts.length, 'essai'), `niveau ${tough.n}`, true);
    if (st.pression === 'niveau' || st.pression === 'global') F += fig('Temps écoulés', String(lost), 'niveaux perdus au chrono', true);
  }
  $('rank').textContent = rank;
  $('score').textContent = fmtInt(score);
  $('figures').innerHTML = F;

  $('byDiff').innerHTML = groupHead('Difficulté', free) + groupRows(played, Object.keys(DIFFS).map(k => [DIFFS[k].name, l => l.diffKey === k]), free);
  $('byRelief').innerHTML = groupHead('Relief', free) + groupRows(played, RELIEF_KEYS.map(k => [RELIEFS[k].name, l => l.relief === k]), free);
  $('byOri').innerHTML = groupHead('Situation', free) + groupRows(played, [
    ['Carte nord en haut', l => !l.rot],
    ['Carte en quart de tour', l => l.rot && l.rot % 90 === 0],
    ['Carte à angle libre', l => l.rot % 90 !== 0],
    ['Regard vers le nord', l => DIFFS[l.diffKey].facing === 'cardinal' && l.az === 0],
    ['Regard vers est, sud ou ouest', l => DIFFS[l.diffKey].facing === 'cardinal' && l.az !== 0],
    ['Direction inconnue', l => DIFFS[l.diffKey].facing === 'cache'],
  ], free);

  const showVue = st.cond !== 'standard', vueTh = showVue ? '<th>Vue</th>' : '', vueTd = l => showVue ? `<td>${condShort(l.cond)}</td>` : '';
  let T;
  if (free) {
    T = `<tr><th>Niveau</th><th>Terrain</th>${vueTh}<th>Difficulté</th><th class="r">Écart</th><th class="r">Temps</th><th class="r">Score</th><th>Résultat</th></tr>`;
    for (const l of run.levels) {
      if (!l.attempts.length && !l.done) { T += `<tr class="tag-muted"><td>${l.n}</td><td>${RELIEFS[l.relief].name}</td>${vueTd(l)}<td>${DIFFS[l.diffKey].name}</td><td class="r">–</td><td class="r">–</td><td class="r">–</td><td>non joué</td></tr>`; continue; }
      const res = l.fail === 'temps' ? '<span class="tag-bad">temps écoulé</span>'
        : !l.done ? '<span class="tag-muted">abandon</span>'
        : l.hit ? `<span class="tag-ok">dans la zone ✓</span>` : `<span class="tag-bad">hors zone ✗</span>${l.fail === 'mort' ? ' <span class="tag-muted">(mort subite)</span>' : ''}`;
      T += `<tr><td>${l.n}</td><td>${RELIEFS[l.relief].name}${rotLabel(l)}</td>${vueTd(l)}<td>${DIFFS[l.diffKey].name}</td><td class="r">${l.done ? fmtDist(l.dist) : '–'}</td><td class="r">${fmtSec(l.ms)}</td><td class="r">${l.done ? fmtInt(l.score) : '–'}</td><td>${res}</td></tr>`;
    }
  } else {
    T = `<tr><th>Niveau</th><th>Terrain</th>${vueTh}<th>Difficulté</th><th class="r">Points</th><th class="r">Essais</th><th class="r">Temps</th><th class="r">Score</th><th>Réponses</th></tr>`;
    for (const l of run.levels) {
      if (!l.attempts.length && !l.done) { T += `<tr class="tag-muted"><td>${l.n}</td><td>${RELIEFS[l.relief].name}</td>${vueTd(l)}<td>${DIFFS[l.diffKey].name}</td><td class="r">${DIFFS[l.diffKey].nPts}</td><td class="r">–</td><td class="r">–</td><td class="r">–</td><td>non joué</td></tr>`; continue; }
      const hist = l.attempts.map(a => a.timeout ? `<span class="tag-bad">temps écoulé</span>` : a.correct ? `<span class="tag-ok">${a.choice} ✓</span>` : `<span class="tag-bad">${a.choice} ✗</span>`).join(', ')
        + (l.done || l.fail === 'temps' ? '' : l.fail === 'mort' ? ' <span class="tag-muted">(mort subite)</span>' : ' <span class="tag-muted">(abandon)</span>');
      T += `<tr><td>${l.n}</td><td>${RELIEFS[l.relief].name}${rotLabel(l)}</td>${vueTd(l)}<td>${DIFFS[l.diffKey].name}</td><td class="r">${DIFFS[l.diffKey].nPts}</td><td class="r">${l.attempts.length}</td><td class="r">${fmtSec(l.ms)}</td><td class="r">${l.done ? fmtInt(l.score) : '–'}</td><td>${hist}</td></tr>`;
    }
  }
  $('levelTable').innerHTML = T;
  $('runCode').textContent = run.code;
  $('runHint').textContent = 'Le lien ouvre directement ces terrains et ces réglages. Le code, lui, se colle sur l\u2019accueil.';
  show('stats');
  renderCharts(free, avgTime, avgDist);
}

const TIME_STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 1200];
const DIST_STEPS = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
const tickTime = v => v >= 60 && v % 60 === 0 ? v / 60 + '\u202fmin' : Math.round(v) + '\u202fs';
const tickDist = v => v >= 1000 ? (v / 1000).toLocaleString('fr-FR') + '\u202fkm' : v + '\u202fm';

function renderCharts(free, avgTime, avgDist) {
  const W = Math.max(300, Math.round($('charts').clientWidth || 640)), lv = run.levels;
  const has = test => lv.some(test);
  const legend = items => `<div class="legend">${items.filter(i => i[2]).map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('')}</div>`;
  const block = (title, svg, leg) => `<div class="chart"><h3>${title}</h3>${svg}${leg}</div>`;
  const unplayed = l => !l.attempts.length && !l.done;
  let color, leg;
  if (free) {
    color = l => unplayed(l) || (!l.done && !l.fail) ? 'var(--rule)' : l.fail === 'temps' ? 'var(--bad)' : l.hit ? 'var(--ok)' : 'var(--miss)';
    leg = legend([['var(--ok)', 'Dans la zone', true], ['var(--miss)', 'Hors zone', has(l => l.done && !l.hit)],
      ['var(--bad)', 'Temps écoulé', has(l => l.fail === 'temps')], ['var(--rule)', 'Non joué', has(l => !l.done && l.fail !== 'temps')]]);
  } else {
    color = l => l.done ? (l.attempts.length === 1 ? 'var(--ok)' : 'var(--overprint)') : l.fail ? 'var(--bad)' : 'var(--rule)';
    leg = legend([['var(--ok)', 'Réussi du premier coup', true], ['var(--overprint)', 'Réussi après erreur', has(l => l.done && l.attempts.length > 1)],
      ['var(--bad)', 'Perdu au chrono ou en mort subite', has(l => !!l.fail)], ['var(--rule)', 'Non terminé', has(l => !l.done && !l.fail)]]);
  }
  let h = '';
  if (free) h += block('Écart par niveau', chartSvg(lv, W, {
    val: l => l.done ? l.dist : 0, min: 50, steps: DIST_STEPS, tick: tickDist, color, aria: 'Écart entre le clic et la vraie position, par niveau',
    title: l => `Niveau ${l.n} : ${l.done ? fmtDist(l.dist) : 'pas de clic'}`, avg: avgDist, avgLabel: `moyenne ${fmtDist(avgDist)}`,
  }), leg);
  h += block('Temps par niveau', chartSvg(lv, W, {
    val: l => l.ms / 1000, min: 5, steps: TIME_STEPS, tick: tickTime, color, aria: 'Temps de réflexion par niveau',
    title: l => `Niveau ${l.n} : ${fmtSec(l.ms)}${free ? '' : ', ' + plural(l.attempts.length, 'essai')}`,
    badge: free ? null : l => { const e = realErrors(l); return e ? `×${e + 1}` : ''; },
    avg: avgTime / 1000, avgLabel: `moyenne ${fmtSec(avgTime)}`,
  }), leg);
  $('charts').innerHTML = h;
}
function chartSvg(levels, W, o) {
  const Hh = 220, left = 46, bottom = 28, top = 18, n = levels.length;
  const raw = Math.max(o.min, ...levels.map(o.val));
  const step = o.steps.find(st => raw / st <= 5) || o.steps[o.steps.length - 1] * 2;
  const ticks = Math.ceil(raw / step), max = ticks * step;
  const iw = W - left - 8, ih = Hh - bottom - top, bw = Math.min(iw / n, 90), gap = Math.min(10, bw * 0.25);
  const y = v => top + ih - v / max * ih;
  let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${o.aria}">`;
  for (let k = 0; k <= ticks; k++) {
    const v = max * k / ticks, yy = y(v);
    s += `<line x1="${left}" x2="${W - 8}" y1="${f1(yy)}" y2="${f1(yy)}" stroke="var(--rule)" stroke-width="1"/>`;
    s += `<text x="${left - 6}" y="${f1(yy)}" font-size="11" fill="var(--muted)" text-anchor="end" dominant-baseline="central">${o.tick(v)}</text>`;
  }
  levels.forEach((l, i) => {
    const x = left + i * bw + gap / 2, w = bw - gap, v = o.val(l);
    const hgt = Math.max(v > 0 ? 2 : 0, top + ih - y(v));
    s += `<rect x="${f1(x)}" y="${f1(top + ih - hgt)}" width="${f1(w)}" height="${f1(hgt)}" rx="2" fill="${o.color(l)}"><title>${o.title(l)}</title></rect>`;
    const b = o.badge && o.badge(l);
    if (b) s += `<text x="${f1(x + w / 2)}" y="${f1(top + ih - hgt - 7)}" font-size="11" font-weight="700" fill="var(--bad)" text-anchor="middle">${b}</text>`;
    if (n <= 20 || (i + 1) % 5 === 0 || i === 0) s += `<text x="${f1(x + w / 2)}" y="${Hh - 10}" font-size="11" fill="var(--muted)" text-anchor="middle">${l.n}</text>`;
  });
  if (o.avg > 0) {
    const yy = y(o.avg);
    s += `<line x1="${left}" x2="${W - 8}" y1="${f1(yy)}" y2="${f1(yy)}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    s += `<text x="${W - 10}" y="${f1(yy - 6)}" font-size="11" fill="var(--ink)" text-anchor="end">${o.avgLabel}</text>`;
  }
  return s + '</svg>';
}

// ------------------------------------------------------------ Accueil
const MODE_HINTS = {
  points: 'Choisissez le bon point parmi ceux proposés sur la carte.',
  libre: 'Aucun point proposé : touchez la carte là où vous pensez être. Plus vous tombez près, plus vous marquez.',
};
const RELIEF_HINTS = {
  varie: 'Un relief différent à chaque niveau, tiré parmi les cinq.',
  collines: 'Buttes arrondies et vallons doux, courbes tous les 10 m.',
  montagne: 'Sommets et versants raides, courbes tous les 20 m.',
  cretes: 'Longues arêtes presque parallèles, séparées par des vallées.',
  plateaux: 'Tables au sommet plat, bordées de falaises.',
  ile: 'Une île entourée de mer : le rivage sert de repère.',
};
const ROT_HINTS = {
  auto: 'Nord en haut en facile, quart de tour au hasard en normale et difficile, angle libre en extrême.',
  nord: 'Le nord reste toujours en haut de la carte.',
  quart: 'La carte peut être tournée de 90, 180 ou 270°.',
  libre: 'La carte est tournée d\u2019un angle quelconque, par exemple 37°. Nettement plus dur.',
};
const RETRY_HINTS = {
  nouveau: 'On vous montre la bonne réponse, puis le niveau reprend sur un autre terrain.',
  meme: 'Le niveau reprend sur le même terrain, le point choisi est barré.',
};
function diffHint(s) {
  if (s.diff === 'progressif') return 'Commence en facile et se durcit au fil des niveaux.';
  const c = DIFFS[s.diff], parts = [s.mode === 'libre' ? `zone de réussite de ${c.tol} m` : `${c.nPts} points`];
  if (s.rot === 'auto') parts.push({ nord: 'nord en haut de la carte', quart: 'carte tournée d\u2019un quart de tour', libre: 'carte à angle libre' }[c.rot]);
  parts.push({ nord: 'regard vers le nord', cardinal: 'regard vers un point cardinal au hasard', cache: 'direction du regard inconnue' }[c.facing]);
  const t = parts.join(', ') + '.' + (c.facing === 'cache' ? ' Il faut trouver où vous êtes et vers où vous regardez.' : '');
  return t[0].toUpperCase() + t.slice(1);
}
function pressHint(s) {
  if (s.pression === 'niveau') return `${s.tlim} s pour chaque niveau. Une fois le temps écoulé, le niveau est perdu.`;
  if (s.pression === 'global') return `${fmtClock(s.tlim * s.levels * 1000)} pour ${s.levels > 1 ? `les ${s.levels} niveaux` : 'le niveau'}. Le chrono ne tourne que pendant la recherche, et la partie s\u2019arrête à zéro.`;
  if (s.pression === 'mort') return s.mode === 'libre' ? 'Le premier clic hors de la zone de réussite termine la partie.' : 'La première mauvaise réponse termine la partie.';
  return 'Pas de limite. Répondre vite rapporte quand même plus de points.';
}
function syncSetup(e) {
  const s = readSettings();
  $('levelsOut').textContent = s.levels;
  $('modeHint').textContent = MODE_HINTS[s.mode];
  $('diffHint').textContent = diffHint(s);
  $('reliefHint').textContent = RELIEF_HINTS[s.relief];
  $('rotHint').textContent = ROT_HINTS[s.rot];
  $('pressHint').textContent = pressHint(s);
  $('retryHint').textContent = RETRY_HINTS[s.retry];
  $('tlimField').hidden = !(s.pression === 'niveau' || s.pression === 'global');
  $('condFields').hidden = s.cond !== 'perso';
  $('condHint').textContent = { standard: 'À hauteur d\u2019yeux, l\u2019après-midi, en été, par légère brume.', perso: 'Réglez chaque condition, ou laissez le hasard choisir pour certaines.', hasard: 'Hauteur, brume, moment de la journée et saison changent à chaque niveau.' }[s.cond];
  $('elHint').textContent = !s.el ? 'Terrain nu : seuls le relief et les courbes vous guident.'
    : 'Ils apparaissent dans la vue et sur la carte, avec une légende sous la carte. Les forêts cachent aussi une partie du paysage.';
  $('retryField').hidden = s.mode === 'libre' || s.pression === 'mort';
  if (e && e.target && ['relief', 'rot', 'mode', 'el'].includes(e.target.name)) drawHero();
  refreshCode();
}
// ---- Code de partie (base 32 de Crockford)
// Version 2, 15 caractères : version (4 bits) + graine (32) + réglages (35) + contrôle (4).
// Les codes de 11 caractères de la version précédente restent acceptés (sans paysage, conditions standard).
const CODE_ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_V1 = [
  ['levels', 5, null, 1], ['mode', 1, ['points', 'libre']], ['diff', 3, ['progressif', 'facile', 'normal', 'difficile', 'extreme']],
  ['relief', 3, ['varie', ...RELIEF_KEYS]], ['rot', 2, ['auto', 'nord', 'quart', 'libre']],
  ['pression', 2, ['aucune', 'niveau', 'global', 'mort']], ['tlim', 2, [20, 45, 90]], ['retry', 1, ['nouveau', 'meme']],
];
const CODE_FIELDS = [...CODE_V1,
  ['el', 5, null, 0], ['cond', 2, ['standard', 'perso', 'hasard']], ['hauteur', 2, ['debout', 'tour', 'drone', 'hasard']],
  ['brume', 2, ['claire', 'legere', 'epaisse', 'hasard']], ['heure', 3, ['matin', 'midi', 'apresmidi', 'soir', 'hasard']],
  ['saison', 2, ['ete', 'automne', 'hiver', 'hasard']],
];
const V1_DEFAULTS = { el: 0, cond: 'standard', hauteur: 'debout', brume: 'legere', heure: 'apresmidi', saison: 'ete' };
const randomSeed = () => (Math.floor(Math.random() * 2 ** 32) ^ Date.now()) >>> 0;
function codeCheck(v, nib = 13) { let c = 5n; for (let i = 0n; i < BigInt(nib); i++) { c = (c * 7n + (v & 15n) + i) & 15n; v >>= 4n; } return c; }
function encodeCode(seed, st) {
  let v = (1n << 32n) | BigInt(seed >>> 0);
  for (const [k, bits, vals, off] of CODE_FIELDS) v = (v << BigInt(bits)) | BigInt(vals ? vals.indexOf(st[k]) : st[k] - off);
  v = (v << 4n) | codeCheck(v, 18);
  let out = '';
  for (let i = 0; i < 15; i++) { out = CODE_ABC[Number(v & 31n)] + out; v >>= 5n; }
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10)}`;
}
function decodeCode(str) {
  const t = str.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (t.length !== 11 && t.length !== 15) return null;
  const v1 = t.length === 11, fields = v1 ? CODE_V1 : CODE_FIELDS;
  let v = 0n;
  for (const ch of t) { const d = CODE_ABC.indexOf(ch); if (d < 0) return null; v = (v << 5n) | BigInt(d); }
  const chk = v & 15n; v >>= 4n;
  if (codeCheck(v, v1 ? 13 : 18) !== chk) return null;
  const st = v1 ? { ...V1_DEFAULTS } : {};
  for (let f = fields.length - 1; f >= 0; f--) {
    const [k, bits, vals, off] = fields[f], x = Number(v & ((1n << BigInt(bits)) - 1n));
    v >>= BigInt(bits);
    if (vals) { if (x >= vals.length) return null; st[k] = vals[x]; } else { if (k === 'levels' && x > 29) return null; st[k] = x + off; }
  }
  if (!v1 && (v >> 32n) !== 1n) return null;
  return { seed: Number(v & 0xFFFFFFFFn), settings: st };
}
let setupSeed = randomSeed();
const SEED_HINT = 'Envoyez le lien ou le code à un ami : il retrouve les mêmes terrains et les mêmes réglages. Collez ici le code reçu pour relever un défi.';
// Lien de partage : la page lit ?code=… (ou #…) à l'ouverture.
const shareUrl = code => `${location.origin}${location.pathname}?code=${code}`;
function seedHint(text, cls) { const h = $('seedHint'); h.textContent = text; h.className = 'hint' + (cls ? ' ' + cls : ''); }
function refreshCode() {
  const inp = $('seedCode');
  if (document.activeElement === inp) return;
  inp.value = encodeCode(setupSeed, readSettings());
  inp.removeAttribute('aria-invalid');
}
function loadCode(raw, lead) {
  const dec = decodeCode(raw);
  if (!dec) return false;
  const inp = $('seedCode');
  setupSeed = dec.seed;
  applySettings(dec.settings);
  inp.value = encodeCode(setupSeed, dec.settings);
  inp.removeAttribute('aria-invalid');
  const st = dec.settings;
  seedHint(`${lead} : ${plural(st.levels, 'niveau')}, ${st.relief === 'varie' ? 'relief varié' : RELIEFS[st.relief].name.toLowerCase()}, difficulté ${st.diff === 'progressif' ? 'progressive' : DIFFS[st.diff].name.toLowerCase()}. Lancez la partie quand vous voulez.`, 'ok');
  drawHero();
  return true;
}
function onCodeInput() {
  const inp = $('seedCode'), raw = inp.value.trim();
  if (loadCode(raw, 'Code reconnu')) return;
  if (raw.replace(/[\s-]/g, '').length >= 11) {
    inp.setAttribute('aria-invalid', 'true');
    seedHint('Ce code ne correspond à aucune partie. Vérifiez qu\u2019il a été recopié en entier, sans faute.', 'bad');
  } else {
    inp.removeAttribute('aria-invalid');
    seedHint(raw ? 'Un code compte 15 caractères, par exemple 3K7QM-2XA9T-BW4RD.' : SEED_HINT);
  }
}
async function copyText(text, btn, hintFn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
  }
  const label = btn.textContent;
  btn.textContent = ok ? 'Copié' : 'Copie bloquée';
  setTimeout(() => { btn.textContent = label; }, 1600);
  if (!ok) hintFn('La copie automatique est bloquée ici : sélectionnez le code et copiez-le à la main.');
}

// L'aperçu de l'accueil suit le relief, la rotation et le mode choisis.
let heroNonce = 0;
function drawHero() {
  const s = readSettings();
  const rng = mulberry32(((Date.now() & 0xffff) + 7) ^ (++heroNonce * 0x9e37));
  const kind = s.relief === 'varie' ? RELIEF_KEYS[Math.floor(rng() * RELIEF_KEYS.length)] : s.relief;
  const T = addFeatures(makeTerrain(Math.floor(rng() * 2 ** 31), kind), s.el);
  const rot = s.rot === 'libre' ? pickRot('libre', null, rng) : s.rot === 'quart' ? 90 * (1 + Math.floor(rng() * 3)) : 0;
  const pts = s.mode === 'points' ? (placePoints(rng, 3, { rot, T, spread: RELIEFS[kind].spread }) || []) : [];
  drawMap($('heroMap'), T, contours(T, contourMargin(rot)), { id: 'h', rot, pts });
}

$('levels').addEventListener('input', syncSetup);
document.querySelectorAll('.settings input[type=radio], .settings input[type=checkbox]').forEach(r => r.addEventListener('change', syncSetup));
$('startBtn').addEventListener('click', () => startRun());
$('quitBtn').addEventListener('click', quit);
$('map').addEventListener('click', onMapClick);
$('replayBtn').addEventListener('click', () => { applySettings(run.settings); startRun(); });
$('sameBtn').addEventListener('click', () => { applySettings(run.settings); startRun(run.seed); });
$('menuBtn').addEventListener('click', () => { show('setup'); seedHint(SEED_HINT); refreshCode(); drawHero(); });
$('seedCode').addEventListener('input', onCodeInput);
$('seedCode').addEventListener('blur', () => { if (!decodeCode($('seedCode').value)) { refreshCode(); seedHint(SEED_HINT); } });
$('seedNew').addEventListener('click', () => { setupSeed = randomSeed(); refreshCode(); seedHint('Nouvelle graine tirée. ' + SEED_HINT); drawHero(); });
$('seedCopy').addEventListener('click', e => copyText($('seedCode').value, e.currentTarget, t => seedHint(t, 'bad')));
$('runCopy').addEventListener('click', e => copyText(run.code, e.currentTarget, t => { $('runHint').textContent = t; }));
$('seedLink').addEventListener('click', e => copyText(shareUrl(encodeCode(setupSeed, readSettings())), e.currentTarget, t => seedHint(t, 'bad')));
$('runLink').addEventListener('click', e => copyText(shareUrl(run.code), e.currentTarget, t => { $('runHint').textContent = t; }));
document.addEventListener('keydown', e => {
  if ($('game').hidden || !run) return;
  if ((e.key === 'Enter' || e.key === ' ') && $('feedback')._go && document.activeElement !== $('fbBtn')) { e.preventDefault(); $('feedback')._go(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || run.locked || !run.puzzle) return;
  if (isFree()) {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) {
      e.preventDefault();
      const step = e.shiftKey ? 40 : 10, [x, y] = run.pinSvg || [MID, MID];
      setPin(clamp(x + d[0] * step, PAD, PAD + S), clamp(y + d[1] * step, PAD, PAD + S));
    } else if (e.key === 'Enter' && run.pin && document.activeElement !== $('guessBtn')) { e.preventDefault(); guess(); }
    return;
  }
  const k = e.key.toLowerCase();
  const i = 'abcde'.indexOf(k) >= 0 ? 'abcde'.indexOf(k) : '12345'.indexOf(k);
  if (i >= 0 && i < run.puzzle.pts.length) answer(i);
});
syncSetup();
seedHint(SEED_HINT);
// Ouverture depuis un lien partagé
(() => {
  const q = new URLSearchParams(location.search).get('code') || decodeURIComponent(location.hash.slice(1));
  if (!q) { drawHero(); return; }
  if (!loadCode(q, 'Partie partagée chargée')) {
    drawHero();
    seedHint('Le lien contient un code invalide, sans doute tronqué. Demandez-le à nouveau ou collez le code ici.', 'bad');
  }
  history.replaceState(null, '', location.pathname);   // un rechargement repart d'une partie neuve
})();
