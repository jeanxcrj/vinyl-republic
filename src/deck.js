// Interactive deck: one live turntable under every slide. Each slide names a camera pose (data-cam);
// the camera eases between poses when the slide changes. Arm, record and motor stay interactive throughout.
// Physics is the same as main.js (platter inertia, cue lever, groove tracking); camera is fixed per slide.
import { Renderer, CARD } from './render-deck.js';
import { TAU } from './dsp.js';
import { loadWordmark, drawLabsCard } from './label.js';
import { makeRecord } from './record.js';
import { enter as enterStory } from './story.js';
import {
  ALPHA_REST, ALPHA_MIN, R_DISC, R_LABEL, R_LEADIN, R_LOCK, PIVOT_X, PIVOT_Y,
  alphaForRadius, grooveRadius, thetaForRadius, stylusXY,
} from './geometry.js';

const $ = (id) => document.getElementById(id);
const RPM = 2.5;  // slowed right down for the slides (a real LP is 33 1/3)
const stage = $('stage'), canvas = $('gl'), W = 1920, H = 1080, W0 = 1920, H0 = 1080, LIFT = 0.005;

// Camera poses in world metres (origin at the spindle, +y away from the viewer, +z up).
// The canvas is shown mirrored (Figma 1:88 flips the turntable so the arm comes in from the lower left),
// so poses are framed for the un-mirrored image: x on screen = 1920 - x in Figma.
// cover: straight down, close on the record, turned 15 degrees (spindle at Figma x 408, y 564; ~3080 px/m).
// Slide 1 is drawn the right way round, slide 3 mirrored (arm from the left, as in Figma 1:123). The flip happens
// at the agenda, where the frame is all record and the label looks the same either way (see setMirror).
let MIRROR = false;
const POSES = {
  // cover (screenshot mock, 2026-11-12): close on the record, label top left, arm resting on the right; ~5980 px/m
  cover: { at: [0.0914, -0.0502, 0], dist: 0.3337, az: 0, el: 1.565, mirror: false, rest: true },   // straight bird's eye
  // agenda: straight over the spindle, the label ~800 px across, square to the screen so the printed agenda reads
  // labs (slide 1): straight down over the nameplate on the deck's right panel (CARD in render-deck.js), centred and
  // ~1300 px wide (~15500 px/m) so every line reads; the deck shows around it
  labs: { at: [0.214, -0.0971, 0], dist: 0.1302, az: 0, el: 1.565, mirror: false, labelMix: null },   // label is off screen here: keep whichever print it has, swap on the way out
  // logo (new slide 1, Nov 13): straight down on the label, which shows the Republic Labs lockup (label2, labelMix 1)
  logo: { at: [0, 0, 0], dist: 0.205, az: 0, el: 1.567, settle: true, mirror: false, labelMix: 1 },
  agenda: { at: [0, 0, 0], dist: 0.2519, az: 0, el: 1.567, settle: true, mirror: null },
  // wide: the whole deck from above; never a slide, only a waypoint the camera pulls back through
  wide: { at: [0.042, 0, -0.02], dist: 0.95, az: 0.12, el: 1.45 },
};
// phone (Figma 1:356): camera slides off the record across the desk; the paper fills the left, the deck blurs behind the haze
POSES.phone = { at: [0.52, 0, 0], dist: 0.45, az: 0, el: 1.565, mirror: true };   // only paper in frame: x 0.31..0.73, clear of the deck (ends 0.27) and the paper edge
POSES.connect = POSES.phone;
POSES.labsfan = POSES.labs;                         // slide 3: same shot of the plate, only the highlight changes                        // slide 5 keeps the desk shot; only the overlay changes
// play: down low by the stylus at the lead-in, where the needle drops and the record starts (reached via the wide shot)
{ const [sx, sy] = stylusXY(alphaForRadius(R_LEADIN - 0.0012)); POSES.play = { at: [sx - 0.0203, sy - 0.0124, 0], dist: 0.24, az: 0.55, el: 0.85, via: true, play: true, mirror: true }; }   // the framing of the 7:54 PM reference (the first needle shot)

// fan story (story.js): the problem keeps the cover shot; the product slides keep the desk shot; section titles get record shots
POSES.problem = POSES.cover;
for (const k of ['recognize', 'points', 'presale', 'board', 'label']) POSES[k] = POSES.phone;
POSES.gamify = { at: [0.0, 0.012, 0], dist: 0.2, az: 0.18, el: 0.9, mirror: true };      // low across the label, print upright
{ const [sx, sy] = stylusXY(alphaForRadius(0.11)); POSES.unlock = { at: [sx, sy, 0], dist: 0.2, az: -0.95, el: 0.62, mirror: true }; }  // low by the stylus, the other side
POSES.compound = { at: [0.03, 0.0, 0], dist: 0.52, az: 0.25, el: 1.08, mirror: false };   // unmirrored so the label prints the right way (the camera flips over the label on the way)    // the whole deck, record playing

for (const k in POSES) if (POSES[k].labelMix === undefined) POSES[k].labelMix = 0;

// ---------- stage: fit 1920 x 1080 into the window ----------
let scale = 1, drewStill = false;          // drewStill: the static desk shot is already on screen
function fit() {
  scale = Math.min(innerWidth / W, innerHeight / H);
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;   // #stage sits at 50% / 50%, origin centre
  if (renderer) renderer.pxScale = Math.min(2, devicePixelRatio || 1) * scale;
  drewStill = false;                                                  // redraw the held frame at the new size
}
let renderer = null;
addEventListener('resize', fit);

await loadWordmark('assets/republic-wordmark.png').catch(() => {});
await Promise.all(['400 46px "General Sans"', '500 34px "General Sans"', '700 31px "General Sans"'].map((f) => document.fonts.load(f))).catch(() => {});   // label is drawn in the deck face
renderer = new Renderer(canvas);
renderer.mirrorLabel = MIRROR;
renderer.logo = true;   // label2 = the Republic Labs lockup for slide 1
function setMirror(m) {                            // flip the canvas and pre-flip the label so the print still reads
  if (m === MIRROR) return;
  MIRROR = m; canvas.classList.toggle('mirror', m); renderer.mirrorLabel = m; renderer.setLabel([]); uploadDesk(m);
}
renderer.agenda = ['Identify Fans', 'Gamify Engagement', 'Unlock Early Access', 'Compound Value'];
const LABS = [                                                        // slide 2: the Republic Labs breakdown, printed on a card on the deck
  ['Internal Product Studio', 'Inventing the future of fandom & artist growth'],
  ['Automation', 'Machine learning automating work and accelerating decisions'],
  ['Audience Intelligence', 'Connected data revealing fans, behaviors and growth opportunities'],
  ['Creative Technology', 'Tools expanding creative possibilities and scaling output'],
  ['New Marketing Systems', 'Systems finding audiences and scaling demand'],
  ['New Fan Products', 'Delighting fans and deepening artist relationships'],
  ['New Revenue Models', 'New products, services and models growing artist value'],
];
renderer.setCard(drawLabsCard(LABS));
const FAN = 5;                                                        // 'New fan products': the pillar this deck clicks into
fit();
const rec = makeRecord();
renderer.setRecord(rec, rec.vis);
// the desk paper under the deck, as on the sandbox page (1.5 m wide, centred on the deck)
const desk = new Image(); desk.src = 'assets/desk-paper.png';
function uploadDesk(m) {                            // mirrored canvas: flip the paper too, so the album art never reads backwards
  if (!desk.naturalWidth) return;
  const W = 1.5, H = W * desk.naturalHeight / desk.naturalWidth;
  let src = desk;
  if (m) { src = document.createElement('canvas'); src.width = desk.naturalWidth; src.height = desk.naturalHeight; const x = src.getContext('2d'); x.translate(src.width, 0); x.scale(-1, 1); x.drawImage(desk, 0, 0); }
  renderer.setDesk(src, [0.042 - W / 2, -H / 2, W, H]);
}
await desk.decode().then(() => uploadDesk(MIRROR)).catch(() => {});

// ---------- state: opens playing, needle a little way into side A ----------
const S = {
  motor: true, rpm: RPM, thp: 0, w: RPM * TAU / 60,
  al: ALPHA_REST, zt: 0, zTarget: 0, down: true, theta: 0, cue: null, hand: false, scratch: null,   // needle already in the groove (set below)
  cam: { ...POSES.logo, at: POSES.logo.at.slice() }, camT: POSES.logo, labelMix: 1,
};
S.theta = thetaForRadius(rec.rTab, 0.138);                       // opens playing, headshell over the lower record (8:14 PM reference)
S.al = alphaForRadius(grooveRadius(rec.rTab, S.theta));
document.documentElement.classList.add('ready');

const radiusOfAl = (al) => { const [x, y] = stylusXY(al); return Math.hypot(x, y); };
const onRecord = (r) => r > R_LOCK - 0.0005 && r < R_DISC - 0.0008;
const armAngle = (p) => { const a = Math.atan2(p[1] - PIVOT_Y, p[0] - PIVOT_X); return a < 0 ? a + TAU : a; };
const clampAl = (a) => Math.max(ALPHA_MIN, Math.min(ALPHA_REST, a));
const lift = () => { S.zTarget = LIFT; S.down = false; };
const lower = () => { if (onRecord(radiusOfAl(S.al))) S.zTarget = 0; };
const cueTo = (al) => { lift(); S.cue = { al: clampAl(al) }; };
const rest = () => { lift(); S.cue = { al: ALPHA_REST, park: true }; };

// ---------- slides ----------
// the fan story slides (class "story") are still in progress: left out of the live site, kept locally (add ?story to preview)
// story slides are live now (were hidden on vercel.app until ready)
// if (/vercel\.app$/.test(location.hostname) && !/[?&]story\b/.test(location.search)) for (const el of document.querySelectorAll('.slide.story')) el.remove();
const slides = [...document.querySelectorAll('.slide')];
let cur = 0;
// coast the platter to a stop exactly upright (thp a multiple of a turn), starting at its current speed
const GLIDE = 2.6;                                  // seconds for a slide change (camera, record and fades together)
const OUT = 1.6, HOLD = 0.45, IN = 2.1;              // pull-back-and-go-in moves (to / from a pose with via)
function settle(T = GLIDE) {
  S.motor = false;
  const w0 = Math.max(0, S.w);
  const D = Math.ceil((S.thp + Math.max(0.5, w0 * T * 0.45)) / TAU) * TAU - S.thp;   // stop upright, never runs backwards
  S.settle = { thp0: S.thp, w0, D, T, t0: performance.now() };
}
// slide nav: prev / numbered slides / next
const nav = $('nav'), mk = (label, cls, fn, aria) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.setAttribute('aria-label', aria); b.addEventListener('click', fn); nav.append(b); return b; };
const prevB = mk('‹', 'arrow', () => go(cur - 1), 'Previous slide');
// a pass-through slide (data-auto) shares one number with the slide it runs into: 4 = phone -> connect
const navOf = [], dots = [];
slides.forEach((sl, i) => { navOf[i] = dots.length; if (sl.dataset.auto) return;
  const first = i > 0 && slides[i - 1].dataset.auto ? i - 1 : i, n = dots.length + 1;
  dots.push(mk(String(n).padStart(2, '0'), '', () => go(first), `Slide ${n}`)); });
const nextB = mk('›', 'arrow', () => go(cur + 1), 'Next slide');
let autoTimer = 0;
// world point on the nameplate -> stage px (1920 x 1080), through the live camera
function plateToStage(px, py) {
  const [W, H] = renderer.cardCanvas.size, x = CARD[0] + CARD[2] * px / W, y = CARD[1] + CARD[3] * (1 - py / H), z = -0.0204;
  const m = renderer.cam.vp, cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  let sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw + 1) / 2 * W0, sy = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw) / 2 * H0;
  if (MIRROR) sx = W0 - sx;
  return [sx, sy];
}
// slide 1 -> 2: 'New fan products' eases in (red wash, the bar draws down, the name warms to red) while a band of light
// sweeps across the metal plate; a short hold, then the camera carries on into the fan story
function tapIntoFanProducts() {   // slide 3: the same plate, "New fan products" eases into its black block and the glare sweeps it
  S.tapped = true;
  const t0 = performance.now(), T = 700, SWEEP = 1100, ease = (u) => 1 - Math.pow(1 - u, 3);
  S.glareT0 = t0; S.glareDur = SWEEP;
  { const [W, H] = renderer.cardCanvas.size, h = renderer.cardCanvas.hits.find((e) => e.i === FAN);   // card uv, y up
    S.glareRect = [h.x / W, 1 - (h.y + h.h) / H, (h.x + h.w) / W, 1 - h.y / H]; }
  const tick = () => {
    const u = Math.min(1, (performance.now() - t0) / T);
    renderer.setCard(drawLabsCard(LABS, FAN, ease(u)));
    if (u < 1) setTimeout(tick, 50);
  };
  tick();
}
function go(i) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  if (i < cur && slides[i].dataset.auto && i > 0) i--;                   // stepping back skips a pass-through slide (4 lives inside 5)
  if (i === cur && stage.dataset.slide) return;
  const forward = i > cur;
  clearTimeout(autoTimer);
  if (forward && slides[i].dataset.auto) autoTimer = setTimeout(() => go(i + 1), (1.9 + +slides[i].dataset.auto) * 1000);   // ~camera landing + phone rise, then a short hold   // runs on into the next slide
  cur = i;
  dots.forEach((d, k) => d.setAttribute('aria-current', String(k === navOf[cur])));
  { const k = navOf[cur], a0 = Math.max(0, Math.min(dots.length - 3, k - 1)); dots.forEach((d, j) => { d.hidden = j < a0 || j > a0 + 2; }); }   // show three numbers at a time, the current one in the middle prevB.disabled = cur === 0; nextB.disabled = cur === slides.length - 1;
  slides.forEach((s, k) => { s.classList.toggle('on', k === cur); s.classList.toggle('out', k < cur); });   // past slides exit upward, later ones wait below
  const pose = POSES[slides[cur].dataset.cam] || POSES.cover, prev = S.camT;
  const via = false;                                                   // one smooth move between any two slides
  const total = GLIDE;
  if (stage.dataset.slide) {                                          // a real change (not first load): hold the new text and the
    stage.dataset.prev = stage.dataset.slide;
    stage.style.setProperty('--in', pose === prev ? '.45s' : `${total * 0.72}s`);   // blur until the camera has nearly landed (no move: right away)
    stage.style.setProperty('--fog-in', `${total * 0.4}s`);
  }
  stage.dataset.slide = slides[cur].dataset.cam;                       // CSS fades the blur layers per slide
  stage.classList.toggle('desk', pose === POSES.phone);              // frosted paper + haze on every desk slide
  S.want = pose.mirror ?? MIRROR;                                     // the camera spring (frame) routes over the label if it must flip
  if (pose !== prev) { let d = (S.cam.az - pose.az) % TAU; S.cam.az = pose.az + (d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d); }   // turn the short way
  if (prev === POSES.labs && pose.labelMix != null) S.labelMix = pose.labelMix;   // swap the print while it is off screen, never mid-pan
  S.camT = pose;
  if (pose.settle) { if (via) setTimeout(() => settle(IN + 0.2), (OUT + HOLD) * 1000); else settle(total); }
  else if (S.settle) { S.settle = null; }
  if (pose.play) {                                                     // at the wide shot: motor on, arm swings to the lead-in and drops
    setTimeout(() => { if (S.camT !== pose) return; S.settle = null; S.motor = true; cueTo(alphaForRadius(R_LEADIN - 0.0012)); }, 0);
  } else if (!pose.settle) S.motor = true;
  if (slides[cur].dataset.cam === 'labs' && S.tapped) { S.tapped = false; renderer.setCard(drawLabsCard(LABS)); }   // back on the plate: unselect
  if (slides[cur].dataset.cam === 'labsfan') {                       // highlight, hold, then straight on to the title slide
    if (!S.tapped) tapIntoFanProducts();
    if (forward) { const here = cur; clearTimeout(S.fanTimer); S.fanTimer = setTimeout(() => { if (cur === here) go(here + 1); }, 2600); }
  }
  if (slides[cur].dataset.cam === 'connect') runConnect(); else resetConnect();
  history.replaceState(null, '', `#${navOf[cur] + 1}`);
  enterStory(slides[cur].dataset.cam);
}

// ---------- slide 5: a simulator-style touch dot taps Connect on each card ----------
let connectRun = 0;
const touch = $('touch');
function resetConnect() {
  connectRun++; touch.style.opacity = 0; touch.classList.remove('down');
  for (const c of document.querySelectorAll('.card')) { c.classList.remove('press', 'busy', 'done'); c.querySelector('.sub').textContent = 'Tap to connect'; }
}
function runConnect() {
  resetConnect();
  const run = connectRun, wait = (ms) => new Promise((r) => setTimeout(r, ms)), live = () => run === connectRun;
  const move = (x, y, ms) => { touch.style.transition = `transform ${ms}ms cubic-bezier(.45,0,.2,1), opacity .3s ease`; touch.style.transform = `translate3d(${x}px, ${y}px, 0)`; };
  (async () => {
    await wait(1400); if (!live()) return;                               // let the phone land on the cards first
    touch.style.transition = 'none'; touch.style.transform = 'translate3d(1300px, 960px, 0)'; void touch.offsetWidth;
    touch.style.opacity = 1;
    const cards = [...document.querySelectorAll('.card')];
    for (const c of cards) {                                             // tap, then move on while that one connects
      const x = 157 + 670 - 32 - 82.5, y = parseFloat(getComputedStyle(c).top) + 78.4;   // centre of the Connect pill
      move(x, y, 650); await wait(700); if (!live()) return;
      touch.classList.add('down'); c.classList.add('press'); await wait(140);
      touch.classList.remove('down'); c.classList.remove('press'); c.classList.add('busy'); c.querySelector('.sub').textContent = 'Connecting…';
      setTimeout(() => { if (!live()) return; c.classList.remove('busy'); c.classList.add('done'); c.querySelector('.sub').textContent = 'Connected'; }, 1100);
      await wait(180); if (!live()) return;
    }
    await wait(250); if (!live()) return;
    move(1240, 980, 800); await wait(350); touch.style.opacity = 0;      // dot drifts off and fades
  })();
}
{ const n = (parseInt(location.hash.slice(1), 10) || 1) - 1; go(Math.max(0, navOf.indexOf(n))); }   // #4 opens the phone beat

// ?scene: just the record spinning at the gamify angle and light, no words, no nav, no keys (scene.html)
const SCENE = /[?&]scene\b/.test(location.search);
if (SCENE) { document.documentElement.classList.add('scene'); go(Math.max(0, slides.findIndex((s) => s.dataset.cam === 'gamify'))); playScene(); }
// the needle drop: still record, arm parked; the camera glides down to the stylus as the arm swings over and drops,
// the platter spins up under it, then the camera rises back to the label angle. Click (or R) to run it again.
function playScene() {
  const run = (S.sceneRun = (S.sceneRun || 0) + 1), at = (ms, f) => setTimeout(() => { if (S.sceneRun === run) f(); }, ms);
  S.cue = null; S.motor = false; S.w = 0; S.rpm = 5;   // scene spins faster than the deck (2.5)
   S.al = ALPHA_REST; S.zt = LIFT; S.zTarget = LIFT; S.down = false;
  S.camT = POSES.gamify; S.cam = { ...POSES.gamify, at: POSES.gamify.at.slice() }; S.camV = null;
  S.userCam = false;
  at(1400, () => { if (!S.userCam) S.camT = POSES.play; });                                         // glide low across the record to the arm
  at(2600, () => { cueTo(alphaForRadius(R_LEADIN - 0.0012)); });                    // arm swings over the lead-in and drops
  at(5200, () => { S.motor = true; });                                              // needle down: platter spins up
  at(8600, () => { if (!S.userCam) S.camT = POSES.gamify; });                                       // rise back to the label as it turns
}
if (SCENE) {
  addEventListener('keydown', (e) => { if (e.key === 'r') playScene(); });
  // drag to orbit (left/right turns, up/down tilts), scroll to zoom; the camera holds wherever you leave it
  const own = () => { if (S.camT !== S.free) { S.free = { at: S.cam.at.slice(), dist: S.cam.dist, az: S.cam.az, el: S.cam.el }; S.camT = S.free; } S.userCam = true; };
  let orb = null;
  addEventListener('pointerdown', (e) => { if (e.button) return; e.stopImmediatePropagation(); own(); orb = { x: e.clientX, y: e.clientY }; }, true);
  addEventListener('pointermove', (e) => {
    if (!orb) return; e.stopImmediatePropagation();
    const dx = e.clientX - orb.x, dy = e.clientY - orb.y; orb = { x: e.clientX, y: e.clientY };
    S.free.az -= (MIRROR ? -1 : 1) * dx * 0.005; S.free.el = Math.max(0.12, Math.min(1.567, S.free.el + dy * 0.004));
    S.cam.az = S.free.az; S.cam.el = S.free.el; S.cam.at = S.free.at.slice(); S.camV = null;   // follow the hand directly, no spring lag
  }, true);
  addEventListener('pointerup', (e) => { if (!orb) return; e.stopImmediatePropagation(); orb = null;
    const f = S.free; console.log('[scene] pose', JSON.stringify({ at: f.at.map((v) => +v.toFixed(4)), dist: +f.dist.toFixed(4), az: +f.az.toFixed(3), el: +f.el.toFixed(3) })); }, true);
  addEventListener('wheel', (e) => { e.preventDefault(); own(); S.free.dist = Math.max(0.06, Math.min(1.5, S.free.dist * Math.exp(e.deltaY * 0.0015))); S.cam.dist = S.free.dist; S.camV = null; }, { passive: false, capture: true });
}

addEventListener('keydown', (e) => {
  if (SCENE) return;
  if (e.target.closest && e.target.closest('#nav') && (e.key === 'Enter' || e.code === 'Space')) return;   // let the focused nav button handle it
  if (['ArrowRight', 'ArrowDown', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); go(cur + 1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(cur - 1); }
  else if (e.code === 'Space') { e.preventDefault(); S.motor = !S.motor; }
  else if (e.key === 'c') (S.zTarget > 0 ? lower() : lift());
  else if (e.key === 'r') rest();
});

// ---------- pointer: grab the arm, spin/scratch the record, click the record to drop the needle there ----------
let drag = null;
const pick = (e, z) => {                         // undo the CSS mirror before asking the renderer what is under the pointer
  if (!MIRROR) return renderer.pick(e.clientX, e.clientY, z);
  const b = canvas.getBoundingClientRect(); return renderer.pick(b.left + b.right - e.clientX, e.clientY, z);
};
const spin = () => (MIRROR ? 1 : -1);             // mirrored, the drawn spin is reversed so the record still turns clockwise
const hitArm = (e) => { const pa = pick(e, 0.012); return pa && renderer.armDistance(pa, S.al) < (e.pointerType === 'touch' ? 0.03 : 0.012) ? pa : null; };
const hitDisc = (e) => { const p = pick(e, 0); return p && Math.hypot(p[0], p[1]) < R_DISC ? p : null; };
canvas.addEventListener('pointerdown', (e) => {
  const pa = hitArm(e), p = pa ? null : hitDisc(e);
  if (!pa && !p) return;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  if (pa) { drag = { type: 'arm', off: S.al - armAngle(pa) }; S.hand = true; S.cue = null; lift(); }
  else { drag = { type: 'platter', ang: Math.atan2(p[1], p[0]), last: performance.now(), moved: 0, t0: performance.now(), p, w: 0 }; S.scratch = drag; }
  canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) { canvas.style.cursor = hitArm(e) || hitDisc(e) ? 'grab' : ''; return; }
  if (drag.type === 'arm') {
    const pa = pick(e, 0.012);
    if (pa) S.al = clampAl(armAngle(pa) + drag.off);
  } else {
    const p = pick(e, 0); if (!p) return;
    const a = Math.atan2(p[1], p[0]); let d = a - drag.ang;
    if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
    const now = performance.now(), dt = Math.max(1, now - drag.last) / 1000;
    S.thp += spin() * d; drag.w = spin() * d / dt; drag.ang = a; drag.last = now;
    drag.moved += Math.abs(d) * Math.hypot(p[0], p[1]); drag.dthp = (drag.dthp || 0) + spin() * d;
  }
});
function release() {
  if (!drag) return;
  if (drag.type === 'arm') {
    S.hand = false;
    if (onRecord(radiusOfAl(S.al))) lower(); else if (S.al > alphaForRadius(0.163)) rest();
  } else {
    S.w = drag.w || S.w; S.scratch = null;
    const r = Math.hypot(drag.p[0], drag.p[1]);
    if (drag.moved < 0.003 && performance.now() - drag.t0 < 400 && r > R_LABEL + 0.002) cueTo(alphaForRadius(Math.min(r, R_LEADIN - 0.0012)));
  }
  drag = null; canvas.style.cursor = '';
}
for (const t of ['pointerup', 'pointercancel']) canvas.addEventListener(t, release);

// ---------- simulation (as main.js) ----------
function step(dt) {
  if (S.settle && !S.scratch && !S.hand) {             // agenda slide: eased coast to an upright stop (cubic ease-out)
    const u = Math.min(1, (performance.now() - S.settle.t0) / (S.settle.T * 1000));
    const { thp0, w0, D, T } = S.settle;               // cubic Hermite: leaves at the platter's speed, lands at rest
    const thp = thp0 + w0 * T * (u - 2 * u * u + u * u * u) + D * (3 * u * u - 2 * u * u * u), dth = thp - S.thp;
    S.thp = thp; S.w = 0; if (S.down) S.theta = Math.max(0, S.theta + dth);
    return trackArm();
  }
  const target = S.motor ? S.rpm * TAU / 60 : 0;
  if (S.scratch) {
    const dthp = S.scratch.dthp || 0; S.scratch.dthp = 0;
    if (S.down) S.theta = Math.max(0, S.theta + dthp);
    return trackArm();
  }
  S.w += (target - S.w) * Math.min(1, (S.motor ? 1.1 : 0.55) * dt);   // gentle spin-up when leaving the agenda
  if (!S.motor && Math.abs(S.w) < 0.02) S.w = 0;
  const dth = S.w * dt; S.thp += dth;
  if (S.down) S.theta = Math.max(0, S.theta + dth);
  S.zt += (S.zTarget - S.zt) * Math.min(1, dt * (S.zTarget > S.zt ? 9 : 2.6));
  if (!S.down && S.zTarget === 0 && S.zt < 0.00008 && !S.hand) { S.down = true; S.zt = 0; S.theta = thetaForRadius(rec.rTab, radiusOfAl(S.al)); }
  if (S.cue && S.zt > LIFT * 0.6) {
    const d = S.cue.al - S.al, sp = 0.9 * dt;
    S.al += Math.abs(d) < sp ? d : Math.sign(d) * sp * Math.min(1, Math.abs(d) / 0.08 + 0.2);
    if (Math.abs(S.cue.al - S.al) < 1e-4) { S.al = S.cue.al; const park = S.cue.park; S.cue = null; if (!park) lower(); }
  }
  trackArm();
}
function trackArm() {
  if (!S.down) return;
  if (S.theta >= rec.thetaEnd) S.theta = rec.lockStart + ((S.theta - rec.lockStart) % TAU);
  S.al = clampAl(alphaForRadius(grooveRadius(rec.rTab, S.theta)));
}

// Smooth pan-zoom between two views (van Wijk & Nuij 2003): the camera eases along the path a person would
// perceive as steady, zooming and panning together. Width of view ~ dist. rho < 1.4 keeps the arc shallow.
function panZoom(a0, w0, a1, w1, k, rho = 1.0) {
  const dx = a1[0] - a0[0], dy = a1[1] - a0[1], d = Math.hypot(dx, dy), z = a0[2] + (a1[2] - a0[2]) * k;
  if (d < 1e-6) return { at: [a0[0], a0[1], z], dist: w0 * Math.pow(w1 / w0, k) };
  const r2 = rho * rho, b = (wi, sgn) => (w1 * w1 - w0 * w0 + sgn * r2 * r2 * d * d) / (2 * wi * r2 * d);
  const r = (x) => Math.log(-x + Math.sqrt(x * x + 1)), r0 = r(b(w0, 1)), r1 = r(b(w1, -1)), S = (r1 - r0) / rho, s = k * S;
  const us = (w0 / r2) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0)), w = w0 * Math.cosh(r0) / Math.cosh(rho * s + r0);
  return { at: [a0[0] + dx * us / d, a0[1] + dy * us / d, z], dist: w };
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  step(dt);
  const c = S.cam;
  // camera: a critically damped spring toward this slide's pose. It keeps its velocity when the target changes, so clicking
  // back mid-move or paging quickly just curves smoothly to the new view. Distance moves in log space (zoom feels even).
  // If the slide needs the other handedness, aim at the label first and flip there (it looks the same both ways).
  const T = S.want !== MIRROR ? POSES.agenda : S.camT, w = SCENE ? 1.7 : 3.1, k = Math.min(dt, 1 / 30);
  const V = S.camV || (S.camV = { at: [0, 0, 0], ld: 0, az: 0, el: 0 });
  const spring = (x, t, v) => { const a = w * w * (t - x) - 2 * w * v; v += a * k; return [x + v * k, v]; };
  for (let i = 0; i < 3; i++) [c.at[i], V.at[i]] = spring(c.at[i], T.at[i], V.at[i]);
  let ld; [ld, V.ld] = spring(Math.log(c.dist), Math.log(T.dist), V.ld); c.dist = Math.exp(ld);
  [c.az, V.az] = spring(c.az, T.az, V.az); [c.el, V.el] = spring(c.el, T.el, V.el);
  if (S.want !== MIRROR && Math.hypot(c.at[0], c.at[1]) < 0.0015 && c.dist < 0.3 && Math.abs(c.el - T.el) < 0.02 && Math.abs(c.az) < 0.02) setMirror(S.want);
  const speed = Math.abs(V.ld) + Math.abs(V.az) + Math.abs(V.el) + Math.hypot(...V.at) * 10;
  S.moving = speed > 1e-3 || Math.abs(Math.log(c.dist / T.dist)) > 1e-3;
  const still = !S.moving && (S.camT === POSES.phone) && !drag;   // desk-only shot: nothing on screen moves
  if (still && drewStill) { requestAnimationFrame(frame); return; }
  drewStill = still;
  if (S.camT.labelMix != null) { const m = S.camT.labelMix, d = m - (S.labelMix ?? m); S.labelMix = (S.labelMix ?? m) + d * (1 - Math.pow(0.02, dt)); if (Math.abs(d) > 1e-3) S.moving = true; }
  let glare = -9;                                                       // the plate's light sweep (see tapIntoFanProducts)
  if (S.glareT0) { const u = (now - S.glareT0) / S.glareDur; if (u < 1) { glare = -0.35 + 1.8 * (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2) - 0.05; S.moving = true; } else S.glareT0 = 0; }
  renderer.draw({ glare, glareRect: S.glareRect, labelMix: S.labelMix ?? 0, thp: MIRROR ? -S.thp : S.thp, al: S.al, zt: S.zt, zoom: 0, at: c.at, dist: c.dist, az: c.az, el: c.el, motor: S.motor, rpm: S.rpm });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove('still')));   // transitions on only after the first paint

// ---------- ?record: a hands-free walkthrough of every slide, captured from this tab to a video file ----------
// Open deck.html?record, click the button, choose "This tab" in Chrome's share dialog. The deck plays itself
// (each slide holds long enough for its animation), then the recording downloads as republic-labs-walkthrough.webm.
if (/[?&]record\b/.test(location.search)) {
  const HOLD = { logo: 4500, labs: 6000, agenda: 6000, cover: 6000, play: 6000, connect: 8000 };   // ms on each slide after it lands
  const holdFor = (sl) => HOLD[sl.dataset.cam] ?? (sl.classList.contains('story') ? 9000 : 6000);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.createElement('button');
  btn.textContent = 'Record walkthrough';
  btn.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99;padding:18px 30px;font:500 18px "General Sans",sans-serif;background:#ececea;color:#111;border:0;border-radius:999px;cursor:pointer';
  document.body.append(btn);
  btn.addEventListener('click', async () => {
    let stream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60, displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' }); }
    catch { return; }
    btn.remove();
    document.documentElement.style.cursor = 'none'; $('nav').style.visibility = 'hidden';
    const type = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));   // MP4 when Chrome can, so it plays anywhere
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16e6 }), chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    go(0); await sleep(1500);                       // settle on slide 1 before rolling
    rec.start(1000);
    // hold every slide from the moment it is reached (a pass-through slide such as phone advances itself, so the
    // slide it runs into, connect, still gets its full hold: the old loop skipped on as soon as connect arrived)
    let seen = -1;
    while (true) {
      if (cur !== seen) { seen = cur; await sleep(slides[cur].dataset.auto ? 300 : holdFor(slides[cur])); continue; }
      if (slides[cur].dataset.auto) { await sleep(200); continue; }
      if (cur >= slides.length - 1) break;
      go(cur + 1);
    }
    await sleep(1000);
    rec.stop(); stream.getTracks().forEach((t) => t.stop()); await done;
    const a = document.createElement('a'); const mp4 = type.startsWith('video/mp4'); a.href = URL.createObjectURL(new Blob(chunks, { type: mp4 ? 'video/mp4' : 'video/webm' })); a.download = `republic-labs-walkthrough.${mp4 ? 'mp4' : 'webm'}`; a.click();
    document.documentElement.style.cursor = ''; $('nav').style.visibility = '';
  });
}
