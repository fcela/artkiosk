// Repo Market Tectonics — SOFR/BGCR/TGCR as a single deforming surface
// where the three rates ride along three ridges, and volume gives each
// ridge its height. The cross-profile at any time coordinate encodes:
//   - ridge HEIGHT  = that rate's own daily volume (per-ridge). SOFR is the
//     deepest market and tallest ridge; the calm/quiet days sag to the floor.
//   - ridge COLOR   = that rate's value on a shared cool→warm diverging
//     scale (deep blue ~0% → teal ~2% → orange/red ~5.25%). Sept 2019 reads
//     as a tall red spike above two low blue ridges.
//   - mesh WIDTH    = f(spread): narrow when rates converge, wide when they
//     diverge. Sept 2019 blows the cross-section apart laterally.
//   - cross-section SHEAR = f(spread): the peaks actually slide apart in
//     z when the rates diverge, not just spread visually.
//
// Sept 2019: SOFR volume spikes AND its rate jumps to 5.25% while BGCR/TGCR
// sit near 2% — the SOFR ridge shoots up red, the surface tears open wide,
// and the other two ridges stay low and cool.
// March 2020: all three collapse to ~0% and volume drops — the whole surface
// flattens thin and smooth, calm after the storm.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const DATA_URL = new URL('./data/repo_tectonics.json', document.baseURI).href;

// --- Tuning ---
const VOL_GAIN       = 34.0;   // ridge height = volume normalized 0..1 * this
const VOL_FLOOR      = 2.5;    // base floor so even flat days have a sliver
const BASE_WIDTH     = 52.0;
const SPREAD_WIDTH   = 30.0;
const SPREAD_DEFORM  = 6.0;
const TIME_SPAN      = 800.0;
const SCROLL_SPEED   = 14.0;
const VOL_BUDGET     = 22.0;
const CROSS_CS       = 56;
const PEAK_Z         = [0.17, 0.50, 0.83]; // z-fractions for SOFR, BGCR, TGCR

// Rate colormap range — the published min/max over the whole series.
// (computed once and stored as globals in buildSurface for reuse by grid)
let RATE_MIN = Infinity, RATE_MAX = -Infinity, RATE_SPAN = 1;


// --- Event annotations -------------------------------------------------------
// Canvas-textured sprites anchored to the surface at known dates. Each has
// a thin drop-line connecting the label to the mesh.

const EVENTS = [
  { date: '2018-04-02', label: 'SOFR LAUNCHED',
    note: 'OFR publishes first rate' },
  { date: '2019-09-17', label: 'REPO STRESS',
    note: 'SOFR spikes to 5.25%' },
  { date: '2020-03-02', label: 'EMERGENCY CUT',
    note: 'Fed slashes to zero' },
  { date: '2020-03-16', label: 'QE EXPANSION',
    note: 'Unlimited asset purchases' },
  { date: '2022-03-16', label: 'HIKING BEGINS',
    note: 'Fed fights inflation' },
  { date: '2023-07-26', label: 'PEAK RATE',
    note: '5.25 \u2013 5.50%' },
  { date: '2024-09-18', label: 'CUTS BEGIN',
    note: 'First cut, 50 bp' },
];

// --- State -------------------------------------------------------------------
let scene, camera, renderer, labelRenderer, controls, clock;
let surfaceMesh, faceMat;
let eventGroup;      // scrolls with the surface
let eventEntries = [];
let surfaceBreaks = []; // adaptive time-breaks from buildSurface, used for sprite alignment
let gridGroup = null;
let axisGroup = null;
let laneLabelGroup = null;  // fixed lane-name key, NOT attached to axisGroup
let data = null;
let timePhase = 0;

// --- Helpers -----------------------------------------------------------------

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060e);

  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 5000);
  camera.position.set(-380, 42, 96);
  camera.lookAt(40, 14, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  document.body.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(innerWidth, innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  document.body.appendChild(labelRenderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxDistance = 900;
  controls.minDistance = 50;
  controls.target.set(40, 14, 0);
  controls.maxPolarAngle = Math.PI * 0.85;

  scene.add(new THREE.AmbientLight(0x2a3550, 1.4));
  const sun = new THREE.DirectionalLight(0xeef4ff, 1.2);
  sun.position.set(200, 320, 140);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6688bb, 0.5);
  fill.position.set(-150, 80, -120);
  scene.add(fill);
  const rim = new THREE.PointLight(0x55ccaa, 0.6, 900, 1.5);
  rim.position.set(0, 120, -150);
  scene.add(rim);

  clock = new THREE.Clock();
  addEventListener('resize', onResize);

  fetch(DATA_URL).then(r => r.json()).then(d => {
    data = d;
    buildSurface();
    buildGrid();
    buildAxis();
    buildEventLabels();
    document.getElementById('loading').classList.add('hidden');
    animate();
  }).catch(err => {
    const el = document.getElementById('loading');
    if (el) el.textContent = 'failed to load data';
    console.error('tectonics data load failed', err);
  });
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
}

function dailySpread(row) {
  return Math.max(
    Math.abs(row.sofr_rate - row.bgcr_rate),
    Math.abs(row.sofr_rate - row.tgcr_rate),
    Math.abs(row.bgcr_rate - row.tgcr_rate),
  );
}

// Cool→warm diverging colormap. Domain is the global RATE range so the
// colour means the same thing for every ridge and across time.
//   0.0 → deep blue    (low rate, ~0%)
//   0.5 → teal         (mid, ~2.5%)
//   1.0 → warm orange  (high, ~5%):
// Smoothstops for banding control; linear is too posterized.
function rateColor(rate) {
  const t = Math.max(0, Math.min(1, (rate - RATE_MIN) / (RATE_SPAN || 1)));
  // Three-stop ramp: dark blue → teal → warm orange-red.
  // Anchor colors chosen to read as "cold monetary policy" → "hot stress".
  const c0 = [0.08, 0.22, 0.55]; // deep blue
  const c1 = [0.18, 0.70, 0.62]; // teal
  const c2 = [0.96, 0.55, 0.18]; // warm orange
  const c3 = [0.96, 0.30, 0.22]; // red (peak stress)
  let r, g, b;
  if (t < 0.5) {
    const u = t / 0.5;
    r = c0[0] + (c1[0] - c0[0]) * u;
    g = c0[1] + (c1[1] - c0[1]) * u;
    b = c0[2] + (c1[2] - c0[2]) * u;
  } else {
    const u = (t - 0.5) / 0.5;
    // blend c1→c2→c3 so the very top goes slightly red
    if (u < 0.7) {
      const v = u / 0.7;
      r = c1[0] + (c2[0] - c1[0]) * v;
      g = c1[1] + (c2[1] - c1[1]) * v;
      b = c1[2] + (c2[2] - c1[2]) * v;
    } else {
      const v = (u - 0.7) / 0.3;
      r = c2[0] + (c3[0] - c2[0]) * v;
      g = c2[1] + (c3[1] - c2[1]) * v;
      b = c2[2] + (c3[2] - c2[2]) * v;
    }
  }
  return [r, g, b];
}

// --- Surface geometry --------------------------------------------------------

function buildSurface() {
  const n = data.length;

  // Adaptive time-breaks driven by SOFR volume (proxy for market activity).
  // The mesh still uses more polygons on heavy days, so the surface detail
  // itself breathes with volume — but the ridge *height* is the principal
  // volume signal now, not the polygon count.
  const MAX_STRIDE = Math.max(6, Math.floor(n / 200));
  const breaks = [0];
  let i = 0;
  while (i < n - 1) {
    const v = Math.min(Math.max(data[i].sofr_vol, 1), 3500);
    let stride = Math.max(1, Math.round(VOL_BUDGET / (v + VOL_BUDGET * 0.2)));
    stride = Math.min(stride, MAX_STRIDE);
    i += stride;
    if (i >= n - 1) { breaks.push(n - 1); break; }
    breaks.push(i);
  }
  if (breaks[breaks.length - 1] !== n - 1) breaks.push(n - 1);

  // Global rate range for the colormap. Stored on the module-level globals
  // so buildEventLabels() and buildGrid() reuse the exact same domain.
  RATE_MIN = Infinity; RATE_MAX = -Infinity;
  for (const row of data) {
    for (const r of [row.sofr_rate, row.bgcr_rate, row.tgcr_rate]) {
      if (r < RATE_MIN) RATE_MIN = r; if (r > RATE_MAX) RATE_MAX = r;
    }
  }
  RATE_SPAN = RATE_MAX - RATE_MIN || 1;

  // Per-ridge volume is normalized against a SHARED range across all three
  // rates so a tall SOFR ridge genuinely towers over a thin BGCR ridge on
  // the same scale. (Each-rate normalized separately would erase the SOFR-
  // dominates-the-market story.)
  let vMin = Infinity, vMax = -Infinity;
  for (const row of data) {
    for (const v of [row.sofr_vol, row.bgcr_vol, row.tgcr_vol]) {
      if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    }
  }
  const vSpan = vMax - vMin || 1;

  const M = breaks.length;
  const CS = CROSS_CS;
  const total = M * CS;
  const pos   = new Float32Array(total * 3);
  const spArr = new Float32Array(total);
  const rateArr = new Float32Array(total);
  const tArr = new Float32Array(total);
  const colArr = new Float32Array(total * 3);

  for (let m = 0; m < M; m++) {
    const idx = breaks[m];
    const row = data[idx];
    const x = (m / (M - 1)) * TIME_SPAN - TIME_SPAN / 2;
    const sp = dailySpread(row);
    const spreadNorm = Math.min(sp / 0.25, 1.0);

    // Per-ridge volume heights — the principal new signal.
    const volN = (rt) => ((rt - vMin) / vSpan);
    const sofrY = VOL_FLOOR + volN(row.sofr_vol) * VOL_GAIN;
    const bgcrY = VOL_FLOOR + volN(row.bgcr_vol) * VOL_GAIN;
    const tgcrY = VOL_FLOOR + volN(row.tgcr_vol) * VOL_GAIN;

    const halfW = BASE_WIDTH + sp * SPREAD_WIDTH;

    for (let k = 0; k < CS; k++) {
      const t = k / (CS - 1);
      const j = m * CS + k;
      const p3 = j * 3;

      const peakS = 0.17, peakB = 0.50, peakT = 0.83;
      const sigma = 0.13 + spreadNorm * 0.03;
      const gauss = (tp, tc) => { const d = tp - tc; return Math.exp(-d * d / (2 * sigma * sigma)); };

      const baseFloor = Math.min(sofrY, bgcrY, tgcrY) * 0.18;
      const h = baseFloor + sofrY * gauss(t, peakS) + bgcrY * gauss(t, peakB) + tgcrY * gauss(t, peakT);

      const troughPenalty = spreadNorm * 1.2 *
        Math.exp(-((t - (peakS + peakB) / 2) ** 2) / 0.012) *
        Math.exp(-((t - (peakB + peakT) / 2) ** 2) / 0.012);
      const shear = spreadNorm * SPREAD_DEFORM * Math.sin(t * Math.PI);

      pos[p3 + 0] = x;
      pos[p3 + 1] = h - troughPenalty;
      pos[p3 + 2] = (t - 0.5) * halfW * 2 + shear;
      spArr[j] = sp;
      rateArr[j] = (row.sofr_rate + row.bgcr_rate + row.tgcr_rate) / 3;
      tArr[j] = t;

      // Colour = local rate of the nearest ridge, blended across the troughs.
      // Each ridge paints with its own rate's colour; gaussian weighting
      // hands the colour over smoothly at the boundaries. Same idea as the
      // old per-ridge identity palette, but the colour now means "rate here"
      // instead of "which ridge am I?" — so Sept 2019 paints one ridge red
      // and two ridges blue on the same surface.
      const wS = Math.exp(-((t - 0.17) ** 2) / 0.015);
      const wB = Math.exp(-((t - 0.50) ** 2) / 0.015);
      const wT = Math.exp(-((t - 0.83) ** 2) / 0.015);
      const wSum = wS + wB + wT + 0.001;
      const cS = rateColor(row.sofr_rate);
      const cB = rateColor(row.bgcr_rate);
      const cT = rateColor(row.tgcr_rate);
      // Small brightness lift near the ridge crest so colour reads cleanly
      // against neighbouring ridges; pure multiply would muddy the troughs.
      const crest = Math.max(wS, wB, wT) / wSum;
      const bright = 0.55 + 0.45 * crest;
      colArr[p3 + 0] = ((cS[0] * wS + cB[0] * wB + cT[0] * wT) / wSum) * bright;
      colArr[p3 + 1] = ((cS[1] * wS + cB[1] * wB + cT[1] * wT) / wSum) * bright;
      colArr[p3 + 2] = ((cS[2] * wS + cB[2] * wB + cT[2] * wT) / wSum) * bright;
    }
  }

  surfaceBreaks = breaks;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('spread',   new THREE.BufferAttribute(spArr, 1));
  geom.setAttribute('rate',     new THREE.BufferAttribute(rateArr, 1));
  geom.setAttribute('tCross',   new THREE.BufferAttribute(tArr, 1));
  geom.setAttribute('color',    new THREE.BufferAttribute(colArr, 3));

  const idxCount = (M - 1) * (CS - 1) * 6;
  const indices = new Uint32Array(idxCount);
  let p = 0;
  for (let m = 0; m < M - 1; m++) {
    for (let k = 0; k < CS - 1; k++) {
      const a = m * CS + k, b = m * CS + k + 1;
      const c = (m + 1) * CS + k, d = (m + 1) * CS + k + 1;
      indices[p++] = a; indices[p++] = c; indices[p++] = b;
      indices[p++] = b; indices[p++] = c; indices[p++] = d;
    }
  }
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();

  // --- Material: single opaque surface with vertex colors ---
  // A touch of emissive so peaks in the warm-red range glow; reads as
  // stress. EmissiveIntensity is set but the colour is multiplied into the
  // material via a custom callback below — using `emissiveIntensity` alone
  // needs an emissive colour we don't compute, so we keep it dark.
  faceMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.6,
    metalness: 0.12,
  });

  surfaceMesh = new THREE.Mesh(geom, faceMat);
  surfaceMesh.castShadow = false;
  surfaceMesh.receiveShadow = true;
  scene.add(surfaceMesh);
}

// --- Event sprites -----------------------------------------------------------

function dateToIdx(dateStr) {
  for (let i = 0; i < data.length; i++) {
    if (data[i].date === dateStr) return i;
  }
  let best = 0, bestDist = Infinity;
  const target = new Date(dateStr).getTime();
  for (let i = 0; i < data.length; i++) {
    const d = Math.abs(new Date(data[i].date).getTime() - target);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

function buildEventLabels() {
  const n = data.length;
  const M = surfaceBreaks.length;

  // Volume global range — must match the values used to build the surface
  // so event markers sit above the right ridge height.
  let vMin = Infinity, vMax = -Infinity;
  for (const row of data) {
    for (const v of [row.sofr_vol, row.bgcr_vol, row.tgcr_vol]) {
      if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    }
  }
  const vSpan = vMax - vMin || 1;
  const volN = (rt) => ((rt - vMin) / vSpan);

  eventGroup = new THREE.Group();
  scene.add(eventGroup);

  for (const ev of EVENTS) {
    const idx = dateToIdx(ev.date);
    const row = data[idx];
    // Anchor the marker on top of the TALLEST ridge at that date — usually
    // SOFR, but always the one whose volume is highest, which is the
    // visually-dominant peak the viewer's eye lands on.
    const sofrY = VOL_FLOOR + volN(row.sofr_vol) * VOL_GAIN;
    const bgcrY = VOL_FLOOR + volN(row.bgcr_vol) * VOL_GAIN;
    const tgcrY = VOL_FLOOR + volN(row.tgcr_vol) * VOL_GAIN;
    const surfaceY = Math.max(sofrY, bgcrY, tgcrY) * 1.0; // peak of buildSurface

    let bestM = 0, bestDist = Infinity;
    for (let m = 0; m < M; m++) {
      const d = Math.abs(surfaceBreaks[m] - idx);
      if (d < bestDist) { bestDist = d; bestM = m; }
    }
    const x = (bestM / (M - 1)) * TIME_SPAN - TIME_SPAN / 2;

    // Vector label (DOM element, not bitmap). Sits well above the ridges
    // so perspective never overlaps it with passing ridge peaks.
    const el = document.createElement('div');
    el.className = 'ev-label';
    el.innerHTML = `<span class="ev-title">${ev.label}</span><br><span class="ev-note">${ev.note}</span>`;
    const labelObj = new CSS2DObject(el);
    labelObj.position.set(x, surfaceY + 52, 0);
    eventGroup.add(labelObj);

    // Drop-line: drawn vertically from the label down to the ridge at the
    // same x and z=0 (the middle of the cross-section). It points at the
    // ridge directly; `depthTest: false` keeps it visible when ridges pass
    // between camera and line.
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([x, surfaceY + 44, 0, x, surfaceY + 2, 0]), 3));
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
      color: 0x6a9ac0, transparent: true, opacity: 0.55, depthTest: false,
    }));
    eventGroup.add(line);

    // Surface marker dot — tinted by the prevailing rate's colour so it
    // reads as part of the surface, not a foreign accent.
    const avgRate = (row.sofr_rate + row.bgcr_rate + row.tgcr_rate) / 3;
    const [r, g, b] = rateColor(avgRate);
    const markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([x, surfaceY + 2, 0]), 3));
    const marker = new THREE.Points(markerGeo, new THREE.PointsMaterial({
      color: new THREE.Color(r, g, b), size: 5.0, transparent: true, opacity: 0.95,
      depthTest: false, sizeAttenuation: false,
    }));
    eventGroup.add(marker);

    eventEntries.push({ labelObj, line, marker });
  }
}

// --- Rate gridlines & year timeline (scroll with surface) -------------------

function buildGrid() {
  // Volume gridlines. The Y axis now means volume, so the horizontal lines
  // sit at neat round volume figures ($ billions). A label on each would be
  // ideal, but the kiosk view reads as ambient — a tone of gridlines without
  // numbers is enough to suggest scale without becoming a chart.
  let vMin = Infinity, vMax = -Infinity;
  for (const row of data) {
    for (const v of [row.sofr_vol, row.bgcr_vol, row.tgcr_vol]) {
      if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    }
  }
  const halfW = BASE_WIDTH + SPREAD_WIDTH;

  gridGroup = new THREE.Group();
  scene.add(gridGroup);

  // Nine round-number volume ticks between observed min and max.
  // The actual max is ~3500 (billions USD of daily repo turnover); we use
  // 0.5, 1, 1.5, 2, 2.5, 3, 3.5 values.
  const vSpan = (vMax - vMin) || 1;
  const ticks = [500, 1000, 1500, 2000, 2500, 3000, 3500];
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x16223a, transparent: true, opacity: 0.45,
  });
  for (const s of ticks) {
    if (s < vMin - 50 || s > vMax + 50) continue;
    const y = VOL_FLOOR + ((s - vMin) / vSpan) * VOL_GAIN;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -TIME_SPAN / 2, y, -halfW - 10,
       TIME_SPAN / 2, y, -halfW - 10,
    ]), 3));
    gridGroup.add(new THREE.Line(g, lineMat));
  }
}

function buildAxis() {
  axisGroup = new THREE.Group();
  scene.add(axisGroup);

  const halfW = BASE_WIDTH + SPREAD_WIDTH;
  const n = data.length;
  const M = surfaceBreaks.length;

  // Year tick lines: a flat timeline rule laid in front of the surface
  // rather than across it, so the years read as a single baseline instead
  // of slicing through the ridges.
  const TICK_Z = -halfW - 18;
  const tickMat = new THREE.LineBasicMaterial({
    color: 0x2a3a52, transparent: true, opacity: 0.55,
  });
  // A long baseline onto which the per-year ticks attach.
  const ruleGeo = new THREE.BufferGeometry();
  ruleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -TIME_SPAN / 2, -6, TICK_Z,
     TIME_SPAN / 2, -6, TICK_Z,
  ]), 3));
  axisGroup.add(new THREE.Line(ruleGeo, new THREE.LineBasicMaterial({
    color: 0x1a2638, transparent: true, opacity: 0.4,
  })));

  const years = [];
  let lastYear = null;
  for (let i = 0; i < n; i++) {
    const yr = parseInt(data[i].date.slice(0, 4), 10);
    if (yr !== lastYear) {
      years.push({ idx: i, year: yr });
      lastYear = yr;
    }
  }

  const tickBaseY = -6;
  for (const { idx, year } of years) {
    let bestM = 0, bestDist = Infinity;
    for (let m = 0; m < M; m++) {
      const d = Math.abs(surfaceBreaks[m] - idx);
      if (d < bestDist) { bestDist = d; bestM = m; }
    }
    const x = (bestM / (M - 1)) * TIME_SPAN - TIME_SPAN / 2;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      x, tickBaseY, TICK_Z,
      x, tickBaseY + 4, TICK_Z,
    ]), 3));
    axisGroup.add(new THREE.Line(g, tickMat));

    const el = document.createElement('div');
    el.className = 'year-label';
    el.textContent = String(year);
    const labelObj = new CSS2DObject(el);
    // Sit the year text on the same baseline rule, just below the tick.
    // Keeping it on the timeline rule (not down at y=-4) means it scrolls
    // through the same visual band as the rest of the surface and reads at
    // the same apparent speed as the event markers.
    labelObj.position.set(x, tickBaseY - 3, TICK_Z);
    labelObj.renderOrder = -1;
    axisGroup.add(labelObj);
  }

  // --- Lane labels: SOFR / BGCR / TGCR --------------------------------------
  // The three ridges occupy three z-bands along the cross-section (z axis).
  // Each band gets a name label at a fixed x — the trailing right edge of
  // the visible band — and at the lane's centre z. These are KEYS: they do
  // not scroll with the timeline, so they live in a separate non-scrolling
  // group added directly to the scene.
  // We add the group inside buildAxis for setup convenience but attach it
  // to the scene root (not axisGroup), so animate()'s axisGroup.x shift
  // does not touch it.
  laneLabelGroup = new THREE.Group();
  scene.add(laneLabelGroup);

  const laneHalfW = BASE_WIDTH + SPREAD_WIDTH; // matches buildSurface
  const LANE_LABEL_X = TIME_SPAN / 2 + 28;     // just past the trailing edge
  const peakS = 0.17, peakB = 0.50, peakT = 0.83;
  for (const { name, peak } of [
    { name: 'SOFR', peak: peakS },
    { name: 'BGCR', peak: peakB },
    { name: 'TGCR', peak: peakT },
  ]) {
    const z = (peak - 0.5) * laneHalfW * 2;
    const el = document.createElement('div');
    el.className = 'lane-label';
    el.textContent = name;
    const labelObj = new CSS2DObject(el);
    labelObj.position.set(LANE_LABEL_X, VOL_FLOOR - 4, z);
    laneLabelGroup.add(labelObj);
  }
}

// --- Animation loop ----------------------------------------------------------

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  timePhase = (timePhase + dt * SCROLL_SPEED) % TIME_SPAN;
  const offsetX = -timePhase + TIME_SPAN / 2;

  if (surfaceMesh) {
    surfaceMesh.position.x = offsetX;
  }
  if (eventGroup) eventGroup.position.x = offsetX;
  if (gridGroup)  gridGroup.position.x = offsetX;
  if (axisGroup)  axisGroup.position.x = offsetX;

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

init();
