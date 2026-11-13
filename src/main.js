// Controller: platter and tonearm motion, pointer interaction, camera. No audio (yet).
import { Renderer } from './render.js';
import { TAU } from './dsp.js';
import { loadWordmark } from './label.js';
import { makeRecord } from './record.js';
import {
  PIVOT_X, PIVOT_Y, ALPHA_REST, ALPHA_MIN, R_DISC, R_LABEL, R_LEADIN, R_LOCK,
  alphaForRadius, grooveRadius, thetaForRadius, stylusXY,
} from './geometry.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const AZ0 = -0.5, EL0 = 0.6, LIFT = 0.005;

const S = {
  az: AZ0, el: EL0, azT: AZ0, elT: EL0, at: null, atT: null, dist: null, distT: null,   // free orbit camera (target, distance)
  motor: false, rpm: 100 / 3, thp: 0, w: 0,              // platter angle and angular velocity (rad/s)
  al: ALPHA_REST, zt: LIFT, zTarget: LIFT,               // arm swing angle, stylus height above the disc
  down: false, theta: 0,                                 // needle in the groove, unwrapped groove angle under it
  cue: null,                                             // { al } auto-move target (arm lifts, swings, lowers)
  hand: false, scratch: null,
};

await loadWordmark('assets/republic-wordmark.png').catch(() => {});
const renderer = new Renderer(canvas);
// the desk paper: the album-cover collage lying flat under the deck (1.5 m wide, centred on the deck)
const desk = new Image(); desk.src = 'assets/desk-paper.png';
await desk.decode().then(() => { const W = 1.5, H = W * desk.naturalHeight / desk.naturalWidth; renderer.setDesk(desk, [0.042 - W / 2, -H / 2, W, H]); }).catch(() => {});
const rec = makeRecord();
renderer.setRecord(rec, rec.vis);
document.documentElement.classList.add('ready');

// ---------- helpers ----------
const radiusOfAl = (al) => { const [x, y] = stylusXY(al); return Math.hypot(x, y); };
const onRecord = (r) => r > R_LOCK - 0.0005 && r < R_DISC - 0.0008;
const armAngle = (p) => { const a = Math.atan2(p[1] - PIVOT_Y, p[0] - PIVOT_X); return a < 0 ? a + TAU : a; };
const clampAl = (a) => Math.max(ALPHA_MIN, Math.min(ALPHA_REST, a));

function setMotor(on) { S.motor = on; $('b-start').textContent = on ? 'Stop' : 'Start'; $('b-start').classList.toggle('on', on); }
function lift() { S.zTarget = LIFT; S.down = false; }
function lower() {                                      // only lands if the stylus is over the grooves
  const r = radiusOfAl(S.al);
  if (!onRecord(r)) return;
  S.zTarget = 0;
}
function cueTo(al) { lift(); S.cue = { al: clampAl(al) }; }
function play() { setMotor(true); setTimeout(() => cueTo(alphaForRadius(R_LEADIN - 0.0012)), 450); }
function rest() { lift(); S.cue = { al: ALPHA_REST, park: true }; }


// ---------- camera: orbit (az, el) around a target point at a distance; everything eases toward its target ----------
const HOME_AT = [0.042, 0, -0.015];
const homeDist = () => { const asp = canvas.clientWidth / Math.max(1, canvas.clientHeight); return Math.max(0.95, 0.95 * 1.5 / asp); };
function resetView() {
  S.azT = AZ0 + 0; S.az = AZ0 + ((((S.az - AZ0 + Math.PI) % TAU) + TAU) % TAU) - Math.PI;   // unwind full turns first
  S.elT = EL0; S.atT = HOME_AT.slice(); S.distT = homeDist();
}
function focus(p, dist) { S.atT = p.slice(); S.distT = dist; }
// world point under the pointer: the disc/deck plane, else the plane through the current target
function pointUnder(x, y) {
  const p = renderer.pick(x, y, 0); if (p && Math.hypot(p[0] - 0.04, p[1]) < 0.4) return [p[0], p[1], 0];
  const q = renderer.pick(x, y, S.at ? S.at[2] : 0); return q ? [q[0], q[1], S.at ? S.at[2] : 0] : null;
}

// ---------- UI ----------
$('power').addEventListener('click', () => { $('power').hidden = true; play(); });
$('b-start').addEventListener('click', () => setMotor(!S.motor));
$('b-cue').addEventListener('click', () => (S.zTarget > 0 ? lower() : lift()));
$('b-rest').addEventListener('click', rest);
for (const b of document.querySelectorAll('[data-rpm]')) b.addEventListener('click', () => {
  S.rpm = +b.dataset.rpm; for (const o of document.querySelectorAll('[data-rpm]')) o.classList.toggle('on', o === b);
});
$('t-ctl').addEventListener('click', () => { const p = $('ctl'); p.hidden = !p.hidden; $('t-ctl').setAttribute('aria-pressed', String(!p.hidden)); });
$('t-reset').addEventListener('click', resetView);
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input,select')) return;
  if (e.code === 'Space') { e.preventDefault(); $('power').hidden = true; setMotor(!S.motor); }
  else if (e.key === 'c') (S.zTarget > 0 ? lower() : lift());
  else if (e.key === 'z') { const [x, y] = stylusXY(S.al); focus([x, y, 0], 0.07); }
  else if (e.key === 'f') resetView();
  else if (e.key === 'r') rest();
});

// ---------- pointer: grab the arm, spin/scratch the record, click to drop the needle, else orbit ----------
let drag = null;
const touches = new Map();
canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size === 2) { const [a, b] = [...touches.values()]; drag = { type: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, dist0: S.distT }; return; }
  if (e.button === 2 || e.button === 1 || e.shiftKey) { drag = { type: 'pan', x: e.clientX, y: e.clientY }; canvas.style.cursor = 'move'; return; }
  const pa = renderer.pick(e.clientX, e.clientY, 0.012), p = renderer.pick(e.clientX, e.clientY, 0);
  if (pa && renderer.armDistance(pa, S.al) < (e.pointerType === 'touch' ? 0.03 : 0.012)) {
    drag = { type: 'arm', off: S.al - armAngle(pa) }; S.hand = true; S.cue = null; lift();
  } else if (p && Math.hypot(p[0], p[1]) < R_DISC) {
    drag = { type: 'platter', ang: Math.atan2(p[1], p[0]), last: performance.now(), moved: 0, t0: performance.now(), p, w: 0 };
    S.scratch = drag;
  } else drag = { type: 'orbit', x: e.clientX, y: e.clientY };
  canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (!drag) {                                          // hover cursor: hand over the arm and the disc
    const pa = renderer.pick(e.clientX, e.clientY, 0.012), p = renderer.pick(e.clientX, e.clientY, 0);
    canvas.style.cursor = (pa && renderer.armDistance(pa, S.al) < 0.012) || (p && Math.hypot(p[0], p[1]) < R_DISC) ? 'pointer' : 'grab';
    return;
  }
  if (drag.type === 'pinch') {
    const [a, b] = [...touches.values()];
    if (b) { const d = Math.hypot(a[0] - b[0], a[1] - b[1]); S.distT = Math.max(0.02, Math.min(4, drag.dist0 * drag.d0 / d)); }
  } else if (drag.type === 'orbit') {
    S.azT -= (e.clientX - drag.x) * 0.006; S.elT = Math.max(0.03, Math.min(1.56, S.elT + (e.clientY - drag.y) * 0.006));
    drag.x = e.clientX; drag.y = e.clientY;
  } else if (drag.type === 'pan') {
    const c = renderer.cam, k = S.dist * 2 * Math.tan(15 * Math.PI / 180) / canvas.clientHeight;   // metres per pixel at the target
    const dx = (e.clientX - drag.x) * k, dy = (e.clientY - drag.y) * k;
    for (let i = 0; i < 3; i++) S.atT[i] += -c.right[i] * dx + c.up[i] * dy;
    drag.x = e.clientX; drag.y = e.clientY;
  } else if (drag.type === 'arm') {
    const pa = renderer.pick(e.clientX, e.clientY, 0.012);
    if (pa) S.al = clampAl(armAngle(pa) + drag.off);
  } else if (drag.type === 'platter') {
    const p = renderer.pick(e.clientX, e.clientY, 0); if (!p) return;
    const a = Math.atan2(p[1], p[0]); let d = a - drag.ang;
    if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
    const now = performance.now(), dt = Math.max(1, now - drag.last) / 1000;
    S.thp -= d; drag.w = -d / dt; drag.ang = a; drag.last = now;   // disc turns clockwise for positive thp
    drag.moved += Math.abs(d) * Math.hypot(p[0], p[1]); drag.dthp = (drag.dthp || 0) - d;
  }
});
function release() {
  if (!drag) return;
  if (drag.type === 'arm') {
    S.hand = false;
    const r = radiusOfAl(S.al);
    if (onRecord(r)) lower();
    else if (S.al > alphaForRadius(0.163)) rest();      // let go off the record, past the edge: back to the rest
  } else if (drag.type === 'platter') {
    S.w = drag.w || S.w; S.scratch = null;
    const r = Math.hypot(drag.p[0], drag.p[1]);
    if (drag.moved < 0.003 && performance.now() - drag.t0 < 400 && r > R_LABEL + 0.002) cueTo(alphaForRadius(Math.min(r, R_LEADIN - 0.0012)));
  }
  drag = null; canvas.style.cursor = 'grab';
}
for (const t of ['pointerup', 'pointercancel']) canvas.addEventListener(t, (e) => { touches.delete(e.pointerId); release(); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)), nd = Math.max(0.02, Math.min(4, S.distT * f));
  const p = pointUnder(e.clientX, e.clientY);              // move the target toward the point under the cursor as we zoom
  if (p) { const t = 1 - nd / S.distT; for (let i = 0; i < 3; i++) S.atT[i] += (p[i] - S.atT[i]) * t; }
  S.distT = nd;
}, { passive: false });
canvas.addEventListener('dblclick', (e) => { const p = pointUnder(e.clientX, e.clientY); if (p) focus(p, Math.min(S.distT, 0.25)); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- simulation ----------
function step(dt) {
  // platter: a direct-drive motor pulls toward speed, the platter has inertia; a hand on the record overrides it
  const target = S.motor ? S.rpm * TAU / 60 : 0;
  if (S.scratch) {
    const dthp = S.scratch.dthp || 0; S.scratch.dthp = 0;
    if (S.down) S.theta = Math.max(0, S.theta + dthp);
    return trackArm();
  }
  const k = S.motor ? 2.6 : 0.55;                        // spin-up is quick, run-down coasts
  S.w += (target - S.w) * Math.min(1, k * dt);
  if (!S.motor && Math.abs(S.w) < 0.02) S.w = 0;
  const dth = S.w * dt; S.thp += dth;
  if (S.down) S.theta = Math.max(0, S.theta + dth);

  // cue lever: damped lift / lower
  S.zt += (S.zTarget - S.zt) * Math.min(1, dt * (S.zTarget > S.zt ? 9 : 2.6));
  if (!S.down && S.zTarget === 0 && S.zt < 0.00008 && !S.hand) {            // touched down: find the groove under it
    S.down = true; S.zt = 0; S.theta = thetaForRadius(rec.rTab, radiusOfAl(S.al));
  }
  // auto arm move (cueTo / rest): swing once lifted, lower on arrival
  if (S.cue && S.zt > LIFT * 0.6) {
    const d = S.cue.al - S.al, sp = 0.9 * dt;
    S.al += Math.abs(d) < sp ? d : Math.sign(d) * sp * Math.min(1, Math.abs(d) / 0.08 + 0.2);
    if (Math.abs(S.cue.al - S.al) < 1e-4) { S.al = S.cue.al; const park = S.cue.park; S.cue = null; if (!park) lower(); }
  }
  trackArm();
}
function trackArm() {
  if (!S.down) return;
  if (S.theta >= rec.thetaEnd) S.theta = rec.lockStart + ((S.theta - rec.lockStart) % TAU);   // locked groove loops
  S.al = clampAl(alphaForRadius(grooveRadius(rec.rTab, S.theta)));
}

// ---------- HUD ----------
function hud() {
  const rpm = S.w * 60 / TAU;
  $('s-rpm').textContent = rpm.toFixed(1);
  $('s-r').textContent = (radiusOfAl(S.al) * 1000).toFixed(1) + ' mm';
  let track = '';
  if (S.down) {
    const r = radiusOfAl(S.al), revs = S.theta / TAU;
    track = r < 0.0605 ? 'run-out' : r > 0.1463 ? 'lead-in' : '';
    if (!track) { let acc = 2.5; rec.tracks.forEach((t, i) => { const len = Math.round(t.min * 100 / 3); if (!track && revs < acc + len) track = `${i + 1}. ${t.title}`; acc += len + 1.6; }); }
  }
  $('now').textContent = S.down ? track : (S.hand ? 'arm in hand' : S.zt > 0.001 && S.cue ? 'cueing' : '');
}


// ---------- XYZ: axis gizmo (click an axis to snap the view, drag to orbit) + numeric target / camera fields ----------
const giz = $('gizmo'), gx = giz.getContext('2d');
const AXES = [
  { v: [1, 0, 0], name: 'X', col: '#ff5a5a', az: Math.PI / 2, el: 0.03 }, { v: [-1, 0, 0], name: '-X', col: '#ff5a5a', az: -Math.PI / 2, el: 0.03 },
  { v: [0, 1, 0], name: 'Y', col: '#7bdc65', az: Math.PI, el: 0.03 }, { v: [0, -1, 0], name: '-Y', col: '#7bdc65', az: 0, el: 0.03 },
  { v: [0, 0, 1], name: 'Z', col: '#5aa2ff', az: null, el: 1.56 },
];
const nearAngle = (a, ref) => a + Math.round((ref - a) / TAU) * TAU;   // same direction, fewest turns away
function snapTo(ax) { if (ax.az !== null) S.azT = nearAngle(ax.az, S.azT); S.elT = ax.el; }
function gizmoPts() {
  const c = renderer.cam; if (!c) return [];
  const W = giz.width, R = W * 0.36, C = W / 2;
  return AXES.map((a) => ({ ...a, x: C + R * (a.v[0] * c.right[0] + a.v[1] * c.right[1] + a.v[2] * c.right[2]),
    y: C - R * (a.v[0] * c.up[0] + a.v[1] * c.up[1] + a.v[2] * c.up[2]), d: a.v[0] * c.fwd[0] + a.v[1] * c.fwd[1] + a.v[2] * c.fwd[2] }))
    .sort((p, q) => q.d - p.d);                                         // far first, near on top
}
let gizHover = null;
// minimal axis indicator: thin grey axes with dot ends and plain letters; only the positive axes are drawn
function drawGizmo() {
  const W = giz.width, C = W / 2, ink = '#a9a6a0';
  gx.clearRect(0, 0, W, W);
  const pts = gizmoPts().filter((p) => p.name[0] !== '-');
  for (const p of pts) {
    const len = Math.hypot(p.x - C, p.y - C), hov = gizHover === p.name;
    gx.globalAlpha = p.d > 0.35 ? 0.35 : 1;                       // pointing away from us: faded
    gx.strokeStyle = gx.fillStyle = hov ? '#f2efe9' : ink;
    if (len > 10) {
      gx.lineWidth = 3; gx.beginPath(); gx.moveTo(C, C); gx.lineTo(p.x, p.y); gx.stroke();
      gx.beginPath(); gx.arc(p.x, p.y, 5, 0, TAU); gx.fill();
      const ux = (p.x - C) / len, uy = (p.y - C) / len;
      gx.font = '400 26px -apple-system, "Helvetica Neue", sans-serif'; gx.textAlign = 'center'; gx.textBaseline = 'middle';
      gx.fillText(p.name, p.x + ux * 22, p.y + uy * 22);
    } else {                                                      // axis pointing at the viewer: a small arrowhead at the origin
      gx.beginPath(); gx.moveTo(C - 7, C + 5); gx.lineTo(C, C - 8); gx.lineTo(C + 7, C + 5); gx.closePath(); gx.fill();
      gx.font = '400 22px -apple-system, "Helvetica Neue", sans-serif'; gx.textAlign = 'center'; gx.fillText(p.name, C, C - 20);
    }
  }
  gx.globalAlpha = 1; gx.fillStyle = ink; gx.beginPath(); gx.arc(C, C, 3.5, 0, TAU); gx.fill();
}
const gizAt = (e) => { const b = giz.getBoundingClientRect(), k = giz.width / b.width, x = (e.clientX - b.left) * k, y = (e.clientY - b.top) * k;
  let best = null, bd = 34; for (const p of gizmoPts().filter((q) => q.name[0] !== '-')) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd && !(best && best.d < p.d)) { best = p; bd = d; } } return best; };
let gdrag = null;
giz.addEventListener('pointerdown', (e) => { giz.setPointerCapture(e.pointerId); gdrag = { x: e.clientX, y: e.clientY, moved: 0 }; });
giz.addEventListener('pointermove', (e) => {
  if (!gdrag) { const p = gizAt(e); gizHover = p ? p.name : null; return; }
  const dx = e.clientX - gdrag.x, dy = e.clientY - gdrag.y; gdrag.moved += Math.abs(dx) + Math.abs(dy);
  S.azT -= dx * 0.012; S.elT = Math.max(0.03, Math.min(1.56, S.elT + dy * 0.012)); gdrag.x = e.clientX; gdrag.y = e.clientY;
});
let lastSnap = null;
giz.addEventListener('pointerup', (e) => {
  if (gdrag && gdrag.moved < 4) { const p = gizAt(e); if (p) {
    let ax = AXES.find((a) => a.name === p.name.replace('-', ''));
    if (lastSnap === ax.name && ax.name !== 'Z') ax = AXES.find((a) => a.name === '-' + ax.name);   // click again: the other side
    snapTo(ax); lastSnap = ax.name; } }
  gdrag = null;
});
giz.addEventListener('pointerleave', () => { gizHover = null; });

addEventListener('keydown', (e) => {                      // number-pad style view keys
  if (e.target.closest && e.target.closest('input,select')) return;
  const m = { '1': '-Y', '3': 'X', '7': 'Z', '9': 'Y' }[e.key]; if (m) snapTo(AXES.find((a) => a.name === m));
  if (e.key === '4') S.azT -= Math.PI / 12; if (e.key === '6') S.azT += Math.PI / 12;
  if (e.key === '8') S.elT = Math.min(1.56, S.elT + Math.PI / 24); if (e.key === '2') S.elT = Math.max(0.03, S.elT - Math.PI / 24);
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  step(dt);
  if (!S.at) { S.at = HOME_AT.slice(); S.atT = HOME_AT.slice(); S.dist = S.distT = homeDist(); }
  const e = 1 - Math.pow(0.0015, dt);                   // frame-rate independent easing
  S.az += (S.azT - S.az) * e; S.el += (S.elT - S.el) * e; S.dist += (S.distT - S.dist) * e;
  for (let i = 0; i < 3; i++) S.at[i] += (S.atT[i] - S.at[i]) * e;
  const moved = Math.abs(S.azT - AZ0) > 0.01 || Math.abs(S.elT - EL0) > 0.01 || Math.abs(S.distT - homeDist()) > 0.01 || Math.hypot(...S.atT.map((v, i) => v - HOME_AT[i])) > 0.002;
  $('t-reset').hidden = !moved;
  const zoom = Math.max(0, Math.min(1, 1 - S.dist / 0.95));   // only used for the near plane when close
  renderer.draw({ thp: S.thp, al: S.al, zt: S.zt, zoom, at: S.at, dist: S.dist, az: S.az, el: S.el, motor: S.motor, rpm: S.rpm });
  hud(); drawGizmo();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
