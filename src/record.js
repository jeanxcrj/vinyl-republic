// A record with no audio behind it: the spiral and how loud each revolution is are generated, not cut.
// rTab: groove centreline radius at TAB_PER_REV knots per revolution (monotonically decreasing).
// vis: cols x rows bytes, one row per revolution, how hard the groove is modulated at each angle.
import { TAU, rng } from './dsp.js';
import { TAB_PER_REV, R_LEADIN, R_PROGRAM, R_PROGRAM_MIN, R_LOCK } from './geometry.js';

export const TRACKS = [
  { title: 'Intro (Signal)', min: 2.2 },
  { title: 'Superfan', min: 4.1 },
  { title: 'Karma', min: 3.6 },
  { title: 'Tier One', min: 4.4 },
  { title: 'Encore', min: 3.2 },
];

export function makeRecord(seed = 3) {
  const r = rng(seed), rpm = 100 / 3;
  // per-revolution pitch (metres the groove moves inward in one turn)
  const segs = [];
  segs.push({ revs: 2.5, kind: 'leadin' });
  TRACKS.forEach((t, i) => { if (i) segs.push({ revs: 1.6, kind: 'gap' }); segs.push({ revs: Math.round(t.min * rpm), kind: 'music', track: i }); });
  segs.push({ revs: 3, kind: 'leadout' });
  const musicRevs = segs.filter((s) => s.kind === 'music').reduce((a, s) => a + s.revs, 0);
  const gapRevs = segs.filter((s) => s.kind === 'gap').reduce((a, s) => a + s.revs, 0);
  const GAP_P = 0.0009;                                           // wide, smooth bands between tracks
  const musicP = (R_PROGRAM - R_PROGRAM_MIN - gapRevs * GAP_P) / musicRevs;
  const pitchAt = [], kindAt = [], trackAt = [];
  for (const s of segs) {
    const n = Math.ceil(s.revs * TAB_PER_REV);
    for (let k = 0; k < n; k++) {
      const p = s.kind === 'leadin' ? (R_LEADIN - R_PROGRAM) / s.revs : s.kind === 'leadout' ? (R_PROGRAM_MIN - R_LOCK) / s.revs : s.kind === 'gap' ? GAP_P : musicP;
      pitchAt.push(p); kindAt.push(s.kind); trackAt.push(s.track ?? -1);
    }
  }
  const lockKnots = TAB_PER_REV * 2;                              // locked groove: two turns at constant radius
  const n = pitchAt.length + lockKnots + 1, rTab = new Float32Array(n);
  rTab[0] = R_LEADIN;
  for (let i = 1; i <= pitchAt.length; i++) rTab[i] = Math.max(R_LOCK, rTab[i - 1] - pitchAt[i - 1] / TAB_PER_REV);
  for (let i = pitchAt.length + 1; i < n; i++) rTab[i] = R_LOCK;

  // modulation: a slow loudness envelope per track, beats around the turn, quiet in gaps and lead-in/out
  const rows = Math.ceil(n / TAB_PER_REV) + 1, cols = 256, data = new Uint8Array(rows * cols);
  const trackStart = {};
  let env = 0.5;
  for (let row = 0; row < rows; row++) {
    const k = Math.min(kindAt.length - 1, row * TAB_PER_REV), kind = kindAt[k], tr = trackAt[k];
    if (kind !== 'music') continue;
    if (trackStart[tr] === undefined) trackStart[tr] = row;
    const len = Math.round(TRACKS[tr].min * rpm), u = (row - trackStart[tr]) / len;
    env += (r() - 0.5) * 0.12; env = Math.max(0.25, Math.min(0.95, env));
    const shape = Math.min(1, u * 12) * Math.min(1, (1 - u) * 10) * (0.65 + 0.35 * Math.sin(u * 9 + tr));   // fade in/out, verses/choruses
    const bpm = 90 + tr * 14, beats = bpm / rpm;                 // beats per revolution
    for (let c = 0; c < cols; c++) {
      const a = c / cols, ph = (a * beats + row * beats) % 1;
      const hit = Math.exp(-ph * 9) * 0.55, grain = r() * 0.25;
      data[row * cols + c] = Math.max(0, Math.min(255, 255 * shape * env * (0.45 + hit + grain)));
    }
  }
  const scratches = [], dust = 0.25;
  for (let i = 0; i < 4; i++) { const r0 = 0.07 + r() * 0.07, p0 = r() * TAU; scratches.push({ r0, r1: r0 + 0.004 + r() * 0.012, phi0: p0, phi1: p0 + (r() - 0.5) * 0.25 }); }
  return {
    rTab, thetaEnd: (n - 1) * TAU / TAB_PER_REV, lockStart: pitchAt.length * TAU / TAB_PER_REV,
    warp: [{ k: 1, amp: 0.00022, ph: 0.4 }, { k: 2, amp: 0.00009, ph: 1.9 }],
    ecc: [0, 0], scratches, condition: { dust }, tracks: TRACKS,
    vis: { data, cols, rows },
  };
}
