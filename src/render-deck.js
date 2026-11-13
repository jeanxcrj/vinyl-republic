// Deck copy of render.js (the sandbox's black portable deck on the desk paper) plus: agenda label, pre-flipped label
// when the canvas is CSS-mirrored, and a pixel scale the deck sets (the canvas sits in a scaled 1920x1080 stage).
// WebGL2 scene: a dark direct-drive style deck, the disc (drawn from the cut geometry) and the tonearm.
// World = physics world: origin at the spindle, +x right, +y away from the viewer, +z up, metres.
import * as G from './gl-util.js';
import { STD_VS, STD_FS, REC_VS, REC_FS, DEPTH_FS, KEY } from './shaders-deck.js';
import { TAU } from './dsp.js';
import { drawLabel, drawAgendaLabel, drawLabsLabel, drawLogoLabel } from './label.js';
import {
  ARM_LE, ARM_BETA, PIVOT_X, PIVOT_Y, ALPHA_REST, R_DISC, R_LOCK, R_LEADIN, GROOVE_W, thetaForRadius, stylusXY,
} from './geometry.js';

const PIVOT_H = 0.030, DECK_Z = -0.022, FLOOR_Z = -0.080, FOV = 30 * Math.PI / 180, SHADOW = 2048;
const CB = Math.cos(ARM_BETA), SB = Math.sin(ARM_BETA), lerp = (a, b, t) => a + (b - a) * t;
// arm tube: a J-shaped bend from the pivot to the headshell collar, in the arm frame (+x = pivot -> stylus)
const P3 = [ARM_LE - 0.040 * CB, 0.040 * SB, -0.0125];
const TUBE = G.bezier([0, 0, 0], [0.075 * Math.cos(0.28), 0.075 * Math.sin(0.28), -0.003], [P3[0] - 0.075 * CB, P3[1] + 0.075 * SB, -0.0085], P3, 32);
const REST_PT = TUBE[20];
const STROBE = [-0.158, -0.160], LAMP = [STROBE[0] + 0.7026 * 0.024, STROBE[1] + 0.7115 * 0.024, -0.013];
export const CARD = [0.172, -0.1255, 0.084, 0.0568];  // printed card on the deck, low on the right panel above the dial: x, y, w, h (m)
const BLACK = [0.020, 0.020, 0.021], CHROME = [0.80, 0.80, 0.79], AMBER = [1.0, 0.55, 0.12];
const WALNUT = [0.17, 0.085, 0.040], SILVER = [0.80, 0.80, 0.79], FELT = [0.62, 0.58, 0.50], TABLE = [0.018, 0.017, 0.017];


// a box of width w and height h running from p0 to p1 (yaw + pitch only), for square-section parts
function beam(p0, p1, w, h) {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(...d), yaw = Math.atan2(d[1], d[0]), pitch = Math.asin(d[2] / L);
  const b = G.box(0, -w / 2, -h / 2, L, w / 2, h / 2), cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const rot = (x, y, z) => { const x1 = x * cp - z * sp, z1 = x * sp + z * cp; return [x1 * cy - y * sy, x1 * sy + y * cy, z1]; };
  for (let i = 0; i < b.length; i += 6) {
    const q = rot(b[i], b[i + 1], b[i + 2]), n = rot(b[i + 3], b[i + 4], b[i + 5]);
    b[i] = q[0] + p0[0]; b[i + 1] = q[1] + p0[1]; b[i + 2] = q[2] + p0[2]; b[i + 3] = n[0]; b[i + 4] = n[1]; b[i + 5] = n[2];
  }
  return b;
}

export class Renderer {
  constructor(canvas) {
    const gl = this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is required');
    this.canvas = canvas;
    this.std = G.program(gl, STD_VS, STD_FS); this.rec = G.program(gl, REC_VS, REC_FS); this.dep = G.program(gl, STD_VS, DEPTH_FS);
    const m = (d) => G.mesh(gl, d), L = G.lathe, at = (d, x, y, z = 0) => [d, [x, y, z]];
    const foot = L([[0, FLOOR_Z], [0.026, FLOOR_Z], [0.028, FLOOR_Z + 0.002], [0.028, -0.066], [0.024, -0.062], [0, -0.062]], 32);
    const led = L([[0.0016, 0], [0.0016, 0.0006], [0, 0.0006]], 12);
    const [rx, ry] = [PIVOT_X + REST_PT[0] * Math.cos(ALPHA_REST) - REST_PT[1] * Math.sin(ALPHA_REST), PIVOT_Y + REST_PT[0] * Math.sin(ALPHA_REST) + REST_PT[1] * Math.cos(ALPHA_REST)];
    const restZ = PIVOT_H + REST_PT[2] + 0.005 * REST_PT[0] / ARM_LE - 0.0042;
    this.m = {
      floor: m(G.box(-60, -60, FLOOR_Z - 0.02, 60, 60, FLOOR_Z)),
      feet: m(G.merge(at(foot, -0.150, -0.155), at(foot, 0.235, -0.155), at(foot, -0.150, 0.155), at(foot, 0.235, 0.155))),
      body: m(G.rbox(-0.185, -0.19, 0.27, 0.19, -0.062, -0.030, 0.014, 0.002, 16)),
      plate: m(G.rbox(-0.183, -0.188, 0.268, 0.188, -0.030, DECK_Z, 0.012, 0.0018, 16)),
      platter: m(L([[0, -0.0215], [0.164, -0.0215], [0.1645, -0.0205], [0.1645, -0.0072], [0.1625, -0.0045], [0.1535, -0.0036], [0.1535, -0.0025], [0, -0.0025]], 384)),
      mat: m(L([[0.1495, -0.0025], [0.1495, -0.0013], [0, -0.0013]], 256)),
      spindle: m(L([[0.0036, -0.003], [0.0036, 0.009], [0.003, 0.0108], [0.0015, 0.0115], [0, 0.0115]], 24)),
      edge: m(G.cyl(R_DISC, R_DISC, -0.0013, 0, 384, false)), disc: m(G.annulus(0.0036, R_DISC, 56, 384)),
      // portable deck: black arm panel on the right, speed dial, red lamp, badge plate
      panel: m(G.rbox(0.166, -0.180, 0.262, 0.180, DECK_Z, DECK_Z + 0.0012, 0.006, 0.0006)),
      // the Republic Labs card, stuck on the panel between the speed dial and the arm tower (CARD below)
      card: m(G.rbox(CARD[0], CARD[1], CARD[0] + CARD[2], CARD[1] + CARD[3], DECK_Z + 0.0012, DECK_Z + 0.0022, 0.0018, 0.0004)),   // 1 mm metal plate
      dialRing: m(G.merge(at(L([[0.0175, DECK_Z], [0.0175, DECK_Z + 0.006], [0.0165, DECK_Z + 0.0072], [0.0135, DECK_Z + 0.0072], [0.0135, DECK_Z + 0.0062], [0, DECK_Z + 0.0062]], 48), 0.228, -0.150))),
      dialFace: m(G.merge(at(G.cyl(0.0132, 0.0132, DECK_Z + 0.0058, DECK_Z + 0.0064, 48), 0.228, -0.150), at(G.cyl(0.0035, 0.0035, DECK_Z + 0.0064, DECK_Z + 0.0105, 20), 0.228, -0.150))),
      lamp: m(G.rbox(0.094, -0.181, 0.118, -0.172, DECK_Z, DECK_Z + 0.0022, 0.0012, 0.0004)),
      badge: m(G.rbox(-0.168, -0.183, -0.112, -0.171, DECK_Z, DECK_Z + 0.0009, 0.0015, 0.0003)),
      tower: m(G.merge(G.rbox(PIVOT_X - 0.030, PIVOT_Y - 0.032, PIVOT_X + 0.030, PIVOT_Y + 0.032, DECK_Z, 0.016, 0.007, 0.002),
        at(L([[0.011, 0.016], [0.011, 0.024], [0.008, 0.026], [0, 0.026]], 32), PIVOT_X, PIVOT_Y),
        at(L([[0.0045, DECK_Z], [0.0045, restZ - 0.004], [0, restZ - 0.004]], 20), rx, ry),
        at(G.box(-0.007, -0.0025, restZ - 0.004, 0.007, 0.0025, restZ - 0.0028), rx, ry),
        at(G.box(-0.007, -0.0025, restZ - 0.004, -0.0055, 0.0025, restZ + 0.001), rx, ry), at(G.box(0.0055, -0.0025, restZ - 0.004, 0.007, 0.0025, restZ + 0.001), rx, ry))),
      towerCap: m(G.merge(G.tube([[PIVOT_X + 0.036, PIVOT_Y - 0.020, 0.010], [PIVOT_X + 0.050, PIVOT_Y - 0.034, 0.016]], 0.0022, 10))),
      // arm frame
      tube: m(G.merge(beam([-0.050, 0, 0], [P3[0] - 0.006, P3[1], P3[2]], 0.013, 0.0095), beam([P3[0] - 0.006, P3[1], P3[2]], [P3[0] + 0.004, P3[1] * 1.02, P3[2]], 0.011, 0.0085))),
      weight: m(G.rbox(-0.096, -0.0145, -0.054, 0.0145, -0.0105, 0.0105, 0.004, 0.0015)),
      dial: m(G.cylX(0.0040, -0.054, -0.050)),
      // headshell frame (+x = direction of groove travel, stylus tip at z = -PIVOT_H)
      collar: m(G.merge(at(G.alongX(L([[0.0042, -0.047], [0.0060, -0.047], [0.0060, -0.036], [0.0042, -0.036]], 24)), 0, 0, -0.0125),
        at(G.cyl(0.0014, 0.0014, -0.0122, -0.0116, 10), -0.012, 0.0045), at(G.cyl(0.0014, 0.0014, -0.0122, -0.0116, 10), -0.012, -0.0045),
        G.tube([[-0.0045, 0, -0.0270], [0, 0, -0.0297]], 0.00035, 8), G.cyl(0.00004, 0.0004, -0.0300, -0.0296, 8))),
      shell: m(G.merge(G.rbox(-0.046, -0.0115, 0.014, 0.0115, -0.0150, -0.0108, 0.0025, 0.0008),
        G.tube([[-0.002, 0.0090, -0.0132], [0.000, 0.022, -0.0130], [0.002, 0.032, -0.0108], [0.003, 0.036, -0.006]], 0.0013, 10),
        G.box(-0.0225, -0.0068, -0.0246, 0.0035, 0.0068, -0.0142))),
      holder: m(G.box(-0.0075, -0.0052, -0.0272, 0.0050, 0.0052, -0.0246)),
    };
    this.tex = { lut: gl.createTexture(), vis: gl.createTexture(), label: gl.createTexture(), label2: gl.createTexture(), card: gl.createTexture(), shadow: gl.createTexture(), desk: gl.createTexture() };
    this.deskRect = [0, 0, 0, 0];
    gl.bindTexture(gl.TEXTURE_2D, this.tex.shadow);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW, SHADOW, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE], [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.tex.shadow, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const c = [0.04, 0, -0.02], eye = c.map((v, i) => v + KEY[i]);
    this.lvp = G.mul(G.ortho(-0.46, 0.46, -0.46, 0.46, 0.3, 1.7), G.lookAt(eye, c).m);
    this.info = null; this.cam = null;
    this.setLabel(['']);
    gl.enable(gl.DEPTH_TEST);
  }

  // a picture lying flat on the table under the deck: rect = [x0, y0, width, height] in metres
  setDesk(img, rect) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex.desk);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    this.deskRect = rect;
  }

  setLabel(titles) {
    this.uploadLabel(this.tex.label, this.agenda ? drawAgendaLabel(this.agenda) : drawLabel(titles));
    if (this.logo) this.uploadLabel(this.tex.label2, drawLogoLabel());   // slide 1 lockup, mixed in by st.labelMix
    else if (this.labs) this.uploadLabel(this.tex.label2, drawLabsLabel(this.labs));   // second print, mixed in by st.labelMix
    if (this.cardCanvas) this.uploadLabel(this.tex.card, this.cardCanvas, true);
  }

  // the deck card's print; flipped like the label when the canvas is mirrored
  setCard(c) { this.cardCanvas = c; this.uploadLabel(this.tex.card, c, true); }

  uploadLabel(tex, c, copy) {
    if (copy && this.mirrorLabel) { const k = document.createElement('canvas'); k.width = c.width; k.height = c.height; k.getContext('2d').drawImage(c, 0, 0); c = k; }
    if (this.mirrorLabel) {                      // canvas is shown mirrored (CSS scaleX(-1)): pre-flip the print so it reads right
      const f = document.createElement('canvas'); f.width = c.width; f.height = c.height;
      const x = f.getContext('2d'); x.translate(f.width, 0); x.scale(-1, 1); x.drawImage(c, 0, 0);
      c.getContext('2d').clearRect(0, 0, c.width, c.height); c.getContext('2d').drawImage(f, 0, 0);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    const an = gl.getExtension('EXT_texture_filter_anisotropic');
    if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }


  // rec: record metadata (rTab, thetaEnd, warp, ecc, scratches, condition, tracks); vis: { data, cols, rows }
  setRecord(rec, vis) {
    const gl = this.gl, lut = new Float32Array(2048), rLo = R_LOCK - 0.002, rHi = R_LEADIN + 0.002;
    for (let i = 0; i < 2048; i++) lut[i] = thetaForRadius(rec.rTab, rLo + (rHi - rLo) * i / 2047) / TAU;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.lut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 2048, 1, 0, gl.RED, gl.FLOAT, lut);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.vis);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, vis.cols, vis.rows, 0, gl.RED, gl.UNSIGNED_BYTE, vis.data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const warp = new Float32Array(9), scr = new Float32Array(48);
    (rec.warp || []).slice(0, 3).forEach((w, i) => warp.set([w.k, w.amp, w.ph], i * 3));
    (rec.scratches || []).slice(0, 12).forEach((s, i) => scr.set([s.r0, s.r1, s.phi0, s.phi1], i * 4));
    this.info = { rLo, rHi, rows: vis.rows, revEnd: rec.thetaEnd / TAU, warp, scr, nScr: Math.min(12, (rec.scratches || []).length), dust: rec.condition?.dust ?? 0, ecc: rec.ecc || [0, 0] };
    this.setLabel(rec.tracks.map((t) => t.title || 'Untitled'));
  }

  // orbit camera: st.az (around the deck), st.el (elevation), st.zoom (0 = whole deck, 1 = at the stylus, < 0 = further away)
  camera(st) {
    const c = this.canvas, asp = c.width / c.height, z = st.zoom, zi = Math.max(0, z), [sx, sy] = stylusXY(st.al);
    const at = st.at || [lerp(0.042, sx, zi), lerp(0, sy, zi), lerp(-0.015, 0, zi)], base = Math.max(0.95, 0.95 * 1.5 / asp);
    const dist = st.dist || (z >= 0 ? lerp(base, 0.06, z) : base * Math.exp(-0.9 * z)), ce = Math.cos(st.el);   // z < 0 pulls back
    const eye = [at[0] + dist * ce * Math.sin(st.az), at[1] - dist * ce * Math.cos(st.az), at[2] + dist * Math.sin(st.el)];
    const v = G.lookAt(eye, at);
    this.cam = { eye, asp, ...v, vp: G.mul(G.perspective(FOV, asp, lerp(0.05, 0.004, zi), 150), v.m) };
    return this.cam;
  }

  // world (x, y) on the horizontal plane at height z under a pointer position
  pick(clientX, clientY, z = 0) {
    const cam = this.cam; if (!cam) return null;
    const b = this.canvas.getBoundingClientRect(), t = Math.tan(FOV / 2);
    const nx = ((clientX - b.left) / b.width * 2 - 1) * t * cam.asp, ny = (1 - (clientY - b.top) / b.height * 2) * t;
    const d = [0, 1, 2].map((i) => cam.fwd[i] + nx * cam.right[i] + ny * cam.up[i]);
    if (d[2] >= -1e-6) return null;
    const k = (z - cam.eye[2]) / d[2];
    return [cam.eye[0] + k * d[0], cam.eye[1] + k * d[1]];
  }

  // distance (m) from a point on the arm's plane to the tonearm (tube or headshell), for grabbing it
  armDistance(p, al) {
    const ca = Math.cos(al), sa = Math.sin(al), [sx, sy] = stylusXY(al);
    let best = Math.hypot(p[0] - sx, p[1] - sy) - 0.02;
    for (let i = 8; i < TUBE.length; i++) {
      const x = PIVOT_X + TUBE[i][0] * ca - TUBE[i][1] * sa, y = PIVOT_Y + TUBE[i][0] * sa + TUBE[i][1] * ca;
      best = Math.min(best, Math.hypot(p[0] - x, p[1] - y));
    }
    return best;
  }

  // st: { thp, al, zt (stylus height above the disc), zoom, az, el, motor, rpm }
  draw(st) {
    const gl = this.gl, c = this.canvas, m = this.m, I = G.ident(), info = this.info, ecc = info ? info.ecc : [0, 0];
    const dpr = this.pxScale || Math.min(2, window.devicePixelRatio || 1), w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const cam = this.camera(st);
    const spin = G.Rz(-st.thp), discM = G.chain(spin, G.T(ecc[0], ecc[1], 0));
    const arm = G.chain(G.T(PIVOT_X, PIVOT_Y, PIVOT_H), G.Rz(st.al), G.Ry(-Math.asin(Math.max(-0.2, Math.min(0.2, st.zt / ARM_LE)))));
    const head = G.chain(arm, G.T(ARM_LE, 0, 0), G.Rz(-ARM_BETA));
    const lensM = G.chain(G.T(STROBE[0] + 0.7026 * 0.0185, STROBE[1] + 0.7115 * 0.0185, 0), G.Rz(0.7917));
    const on = st.motor ? 1 : 0, r33 = st.rpm < 40 || st.rpm > 70, r45 = st.rpm > 40, off = [0, 0, 0];
    const glow = (k, col = AMBER) => col.map((v) => v * 2.2 * k);
    // [mesh, model, albedo, roughness, metalness, mode, emissive]
    const GLOSS = [0.008, 0.008, 0.009], SATIN = [0.022, 0.022, 0.024], RED = [0.30, 0.02, 0.015];
    const items = [
      [m.floor, I, [0.55, 0.55, 0.55], 0.75, 0, 5, off], [m.feet, I, BLACK, 0.7, 0, 0, off],
      [m.body, I, SATIN, 0.55, 0, 0, off], [m.plate, I, SATIN, 0.34, 0.25, 2, off],
      [m.platter, spin, [0.03, 0.03, 0.032], 0.3, 0.8, 1, off], [m.mat, spin, [0.010, 0.010, 0.010], 0.9, 0, 0, off],
      [m.spindle, I, CHROME, 0.14, 1, 1, off],
      [m.panel, I, GLOSS, 0.12, 0, 0, off], [m.card, I, [0.8, 0.8, 0.8], 0.32, 0.85, 6, off],
      [m.dialRing, I, CHROME, 0.18, 1, 1, off], [m.dialFace, I, [0.78, 0.75, 0.66], 0.5, 0, 0, off],
      [m.lamp, I, RED, 0.3, 0, 0, glow(on * 0.55, [1.0, 0.08, 0.04])], [m.badge, I, CHROME, 0.22, 1, 1, off],
      [m.tower, I, SATIN, 0.3, 0.3, 0, off], [m.towerCap, I, CHROME, 0.16, 1, 0, off],
      [m.tube, arm, [0.05, 0.05, 0.055], 0.22, 0.6, 0, off], [m.weight, arm, SATIN, 0.4, 0.3, 0, off], [m.dial, arm, CHROME, 0.2, 1, 0, off],
      [m.collar, head, CHROME, 0.2, 1, 0, off], [m.shell, head, [0.045, 0.045, 0.05], 0.25, 0.6, 0, off], [m.holder, head, [0.75, 0.74, 0.72], 0.35, 0, 0, off],
    ];
    if (info) items.push([m.edge, discM, [0.008, 0.008, 0.008], 0.22, 0, 0, off]);

    // 1. shadow map from the key light
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, SHADOW, SHADOW); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.dep.p); gl.uniformMatrix4fv(this.dep.u.uVP, false, this.lvp);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
    for (let i = 1; i < items.length; i++) { gl.uniformMatrix4fv(this.dep.u.uM, false, items[i][1]); gl.bindVertexArray(items[i][0].vao); gl.drawArrays(gl.TRIANGLES, 0, items[i][0].count); }
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // 2. beauty pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    if (st.bare) gl.clearColor(0, 0, 0, 1); else gl.clearColor(0.004, 0.004, 0.005, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.tex.shadow);
    const common = (u) => {
      gl.uniformMatrix4fv(u.uVP, false, cam.vp); gl.uniformMatrix4fv(u.uLVP, false, this.lvp); gl.uniform3fv(u.uEye, cam.eye);
      gl.uniform1i(u.uShadow, 3); gl.uniform4f(u.uLamp, LAMP[0], LAMP[1], LAMP[2], on);
    };
    let u = this.std.u;
    gl.useProgram(this.std.p); common(u); gl.uniform2f(u.uPivot, PIVOT_X, PIVOT_Y);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.tex.desk); gl.uniform1i(u.uDesk, 4); gl.uniform4fv(u.uDeskRect, this.deskRect);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this.tex.card); gl.uniform1i(u.uCard, 6); gl.uniform4fv(u.uCardRect, CARD); gl.uniform1f(u.uGlare, st.glare ?? -9); gl.uniform4fv(u.uGlareRect, st.glareRect || [0, 0, 0, 0]);
    for (const [mesh, M, col, rough, metal, mode, emis] of st.bare ? items.slice(1) : items) {      // bare: no table under the deck
      gl.uniformMatrix4fv(u.uM, false, M); gl.uniform3fv(u.uCol, col); gl.uniform3fv(u.uEmis, emis);
      gl.uniform1f(u.uRough, rough); gl.uniform1f(u.uMetal, metal); gl.uniform1i(u.uMode, mode);
      gl.bindVertexArray(mesh.vao); gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    if (!info) return;
    u = this.rec.u;
    gl.useProgram(this.rec.p); common(u); gl.uniformMatrix4fv(u.uM, false, discM);
    gl.uniform3fv(u.uWarp, info.warp); gl.uniform4fv(u.uScr, info.scr); gl.uniform1i(u.uNScr, info.nScr);
    gl.uniform1f(u.uRLo, info.rLo); gl.uniform1f(u.uRHi, info.rHi); gl.uniform1f(u.uRows, info.rows);
    gl.uniform1f(u.uRevEnd, info.revEnd); gl.uniform1f(u.uW, GROOVE_W); gl.uniform1f(u.uDust, info.dust);
    gl.uniform1f(u.uLabelMix, st.labelMix || 0);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.tex.label2); gl.uniform1i(u.uLabel2, 5);   // unit 3 = shadow map, 4 = desk
    [['uLut', this.tex.lut], ['uVis', this.tex.vis], ['uLabel', this.tex.label]].forEach(([name, tex], i) => {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u[name], i);
    });
    gl.bindVertexArray(m.disc.vao); gl.drawArrays(gl.TRIANGLES, 0, m.disc.count);
  }
}
