// The centre label: black stock with fine grain, the REPUBLIC wordmark printed in off-white ink,
// small catalogue lines around it. Drawn into a canvas that the renderer uses as a texture.
// The renderer squares the texture colour and lights it, so ink is set a little darker than it lands.
import { rng } from './dsp.js';

const S = 1024, C = S / 2;                       // label is 100 mm across -> ~10 px per mm
const PAPER = [24, 24, 25], INK = [178, 176, 170];
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
let mark = null;                                 // white-on-transparent wordmark canvas, made once

// Load the wordmark PNG (white letters on black) and turn it into an alpha mask.
export async function loadWordmark(url) {
  const img = new Image(); img.src = url; await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, w, h), p = d.data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0; i < p.length; i += 4) {
    const l = (p[i] + p[i + 1] + p[i + 2]) / 765 * (p[i + 3] / 255);
    const a = Math.max(0, Math.min(1, (l - 0.25) / 0.5));       // white letters -> opaque, black ground -> clear
    p[i] = p[i + 1] = p[i + 2] = 255; p[i + 3] = a * 255;
    if (a > 0.5) { const k = i / 4, px = k % w, py = (k / w) | 0; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
  }
  x.putImageData(d, 0, 0);
  const t = document.createElement('canvas'); t.width = x1 - x0 + 1; t.height = y1 - y0 + 1;   // trim to the letters
  t.getContext('2d').drawImage(c, -x0, -y0);
  mark = t;
}

function stock() {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), r = rng(7);
  x.fillStyle = `rgb(${PAPER})`; x.fillRect(0, 0, S, S);
  const img = x.getImageData(0, 0, S, S), p = img.data;          // paper grain
  for (let i = 0; i < p.length; i += 4) { const n = (r() - 0.5) * 9; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
  x.putImageData(img, 0, 0);
  x.globalAlpha = 0.05; x.strokeStyle = '#fff';                  // a few fibres
  for (let i = 0; i < 220; i++) { const a = r() * 6.283, l = 4 + r() * 18, px = r() * S, py = r() * S; x.lineWidth = 0.6 + r(); x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
  x.globalAlpha = 1;
  return c;
}

function inked(src, w, h) {                     // tint the white mask with the ink colour
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(src, 0, 0, w, h);
  x.globalCompositeOperation = 'source-in'; x.fillStyle = `rgb(${INK})`; x.fillRect(0, 0, w, h);
  return c;
}

// titles: track names for side A (shown small under the wordmark); optional
export function drawLabel(titles = []) {
  const c = stock(), x = c.getContext('2d');
  x.save(); x.beginPath(); x.arc(C, C, C - 2, 0, Math.PI * 2); x.clip();
  const ink = `rgb(${INK})`;
  if (mark) {                                                   // wordmark above the spindle
    const w = S * 0.56, h = w * mark.height / mark.width;
    x.drawImage(inked(mark, w, h), C - w / 2, C - 150 - h / 2);
  } else {
    x.fillStyle = ink; x.font = `900 ${S * 0.085}px ${SANS}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('REPUBLIC', C, C - 150);
  }
  x.fillStyle = ink; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `500 20px ${SANS}`; x.letterSpacing = '6px';
  x.fillText('REPUBLIC LABS', C, C - 72);
  x.font = `600 22px ${SANS}`; x.letterSpacing = '4px';         // side and speed either side of the hole
  x.textAlign = 'right'; x.fillText('SIDE A', C - 70, C + 2);
  x.textAlign = 'left'; x.fillText('33⅓ RPM', C + 70, C + 2);
  x.textAlign = 'center'; x.font = `400 19px ${SANS}`; x.letterSpacing = '1px';
  titles.filter(Boolean).slice(0, 6).forEach((t, i) => x.fillText(`${i + 1}.  ${t}`, C, C + 90 + i * 30));
  x.font = `500 15px ${SANS}`; x.letterSpacing = '4px';
  x.fillText('RL-0001  ·  STEREO', C, S - 120);
  x.strokeStyle = ink; x.globalAlpha = 0.5; x.lineWidth = 1.5;    // thin printed ring near the edge
  x.beginPath(); x.arc(C, C, C - 30, 0, Math.PI * 2); x.stroke();
  x.restore();
  return c;
}

// Agenda label for the deck: wordmark, "Agenda", numbered items. Set in General Sans (the deck loads it) with the
// deck's tight -3% tracking, large enough to read when the camera sits over the label. No catalogue text.
export function drawAgendaLabel(items = []) {
  const c = stock(), x = c.getContext('2d'), GS = `"General Sans", ${SANS}`;
  x.save(); x.beginPath(); x.arc(C, C, C - 2, 0, Math.PI * 2); x.clip();
  const ink = `rgb(${INK})`, tr = (px) => `${(-0.03 * px).toFixed(2)}px`;
  // the Labs atom mark at the top (client request, Nov 13), then the wordmark, title and the platform line
  // ?plain: a separate version with only the REPUBLIC wordmark, centred above the spindle (no atom, no Labs line, no agenda)
  if (typeof location !== 'undefined' && /[?&](plain|scene)\b/.test(location.search)) {
    if (mark) { const w = S * 0.36, h = w * mark.height / mark.width; x.drawImage(inked(mark, w, h), C - w / 2, C - 230 - h / 2); }
    x.restore(); return c;
  }
  // their lockup (atom over REPUBLIC / LABS) replaces the wordmark + "REPUBLIC Labs" line
  lockup(x, C, C - 384, 220, ink);
  x.fillStyle = ink; x.textBaseline = 'middle';
  const step = 60, y0 = C + 92, GAP = 14;          // everything centred on the spindle, one weight throughout
  x.textAlign = 'center';
  x.globalAlpha = 0.6; x.font = `400 27px ${GS}`; x.letterSpacing = tr(27);
  x.fillText('a unified platform to', C, C - 78); x.globalAlpha = 1;
  x.textAlign = 'left';
  items.slice(0, 5).forEach((t, i) => {
    const y = y0 + i * step, num = String(i + 1).padStart(2, '0');
    x.font = `400 28px ${GS}`; x.letterSpacing = tr(28); const wn = x.measureText(num).width;
    x.font = `400 42px ${GS}`; x.letterSpacing = tr(42); const wt = x.measureText(t).width;
    const x0 = C - (wn + GAP + wt) / 2;                 // centre each line as a unit (number + name)
    x.globalAlpha = 0.5; x.font = `400 28px ${GS}`; x.letterSpacing = tr(28); x.fillText(num, x0, y + 3);
    x.globalAlpha = 1; x.font = `400 42px ${GS}`; x.letterSpacing = tr(42); x.fillText(t, x0 + wn + GAP, y);
  });
  x.restore();
  return c;
}

// Republic Labs breakdown label (deck slide 2): atom mark, title with a red rule, the seven pillars around the spindle,
// INVENT · TEST · DEPLOY · SCALE and REPUBLIC LABS set on the rim. Same stock and ink; General Sans (the deck loads it).
export function drawLabsLabel(items = []) {
  const c = stock(), x = c.getContext('2d'), GS = `"General Sans", ${SANS}`;
  x.save(); x.beginPath(); x.arc(C, C, C - 2, 0, Math.PI * 2); x.clip();
  const ink = `rgb(${INK})`, tr = (px, em = -0.03) => `${(em * px).toFixed(2)}px`;
  x.fillStyle = ink; x.strokeStyle = ink; x.textBaseline = 'middle'; x.textAlign = 'center';
  // text on the rim: top arc reads left to right over the top, bottom arc reads left to right under the bottom
  const arc = (text, r, top, size, track) => {
    x.font = `500 ${size}px ${GS}`; x.letterSpacing = '0px';
    const ws = [...text].map((ch) => x.measureText(ch).width + track), total = ws.reduce((a, b) => a + b, 0) - track;
    let a = (top ? -Math.PI / 2 : Math.PI / 2) + (top ? -1 : 1) * total / r / 2;
    [...text].forEach((ch, i) => {
      const w = ws[i] - track, mid = a + (top ? 1 : -1) * w / r / 2;
      x.save(); x.translate(C + r * Math.cos(mid), C + r * Math.sin(mid)); x.rotate(mid + (top ? Math.PI / 2 : -Math.PI / 2)); x.fillText(ch, 0, 0); x.restore();
      a += (top ? 1 : -1) * ws[i] / r;
    });
  };
  x.globalAlpha = 0.7; arc('REPUBLIC  LABS', 462, true, 19, 9); arc('INVENT  ·  TEST  ·  DEPLOY  ·  SCALE', 462, false, 19, 7); x.globalAlpha = 1;
  x.globalAlpha = 0.35; x.lineWidth = 1.2; x.beginPath(); x.arc(C, C, 438, 0, Math.PI * 2); x.stroke(); x.globalAlpha = 1;
  // atom mark
  const ay = C - 262; x.lineWidth = 7;
  for (const r of [0, Math.PI / 3, -Math.PI / 3]) { x.beginPath(); x.ellipse(C, ay, 64, 23, r, 0, Math.PI * 2); x.stroke(); }
  x.beginPath(); x.arc(C, ay, 11, 0, Math.PI * 2); x.fill();
  // title + red rule
  x.font = `500 42px ${GS}`; x.letterSpacing = tr(42); x.fillText('Republic Labs', C, C - 158);
  x.fillStyle = 'rgb(196, 64, 56)'; x.fillRect(C - 34, C - 127, 68, 3); x.fillStyle = ink;
  // the seven pillars: name, then a quiet one-liner; four above the spindle region's lower half, centred
  const step = 46, y0 = C + 56;          // last line ends ~C+351, inside the printed ring (r 438) at every row
  items.slice(0, 7).forEach(([name, desc], i) => {
    const y = y0 + i * step;
    x.font = `500 21px ${GS}`; x.letterSpacing = tr(21, 0.05); x.globalAlpha = 1;
    x.fillText(name.toUpperCase(), C, y);
    x.font = `400 14.5px ${GS}`; x.letterSpacing = tr(14.5, -0.01); x.globalAlpha = 0.55;
    x.fillText(desc, C, y + 19);
  });
  x.globalAlpha = 1;
  // hairlines either side of the spindle: title above, pillars below
  x.globalAlpha = 0.3; x.lineWidth = 1; x.beginPath(); x.moveTo(C - 170, C); x.lineTo(C - 56, C); x.moveTo(C + 56, C); x.lineTo(C + 170, C);   // hairlines either side of the spindle x.stroke(); x.globalAlpha = 1;
  x.restore();
  return c;
}

// The Republic Labs breakdown as a printed card on the deck's right-hand panel (deck slide 2), after the 9:28 PM Figma frame:
// a brushed aluminium nameplate with printed ink: a solid black block with REPUBLIC LABS, the seven pillars in two columns (bold name, regular line).
// 1480 x 1000 px for an 84 x 56.8 mm card.
export function drawLabsCard(items = [], hi = -1, t = 1) {   // hi: pillar to mark as selected; t: 0..1 how far the mark has eased in
  const W = 1480, H = 1000, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), r = rng(11), GS = `"General Sans", ${SANS}`;
  // brushed aluminium: a soft vertical sheen, then thousands of fine horizontal grain lines
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#d4d4d1'); g.addColorStop(0.45, '#c3c3c0'); g.addColorStop(1, '#b3b3b0');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    const y = r() * H, len = 120 + r() * 900, x0 = r() * W - 200, a = 0.03 + r() * 0.07;
    x.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 0.8})`; x.fillRect(x0, y, len, 1 + (r() < 0.2 ? 1 : 0));
  }
  const img = x.getImageData(0, 0, W, H), p = img.data;                 // fine tooth
  for (let i = 0; i < p.length; i += 4) { const n = (r() - 0.5) * 6; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
  x.putImageData(img, 0, 0);
  // bevelled edge and four countersunk screws
  x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 3; x.strokeRect(4, 4, W - 8, H - 8);
  x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 2; x.strokeRect(9, 9, W - 18, H - 18);
  for (const [sx, sy] of [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34]]) {
    const sg = x.createRadialGradient(sx - 4, sy - 4, 2, sx, sy, 14); sg.addColorStop(0, '#e8e8e6'); sg.addColorStop(1, '#8c8c89');
    x.fillStyle = sg; x.beginPath(); x.arc(sx, sy, 13, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(sx - 8, sy - 3); x.lineTo(sx + 8, sy + 3); x.stroke();
  }
  const tr = (px, em) => `${(em * px).toFixed(2)}px`;
  x.textBaseline = 'alphabetic'; x.textAlign = 'left';
  // title: their logo (atom over REPUBLIC / LABS) in the plate's ink
  lockup(x, 69 + 118, 157, 236, '#1c1c1b');   // printed straight on the metal, no block
  // two columns: 4 pillars left, 3 right
  const wrap = (t, max) => { const ws = t.split(' '), lines = []; let l = ''; for (const w of ws) { const tt = l ? l + ' ' + w : w; if (x.measureText(tt).width > max && l) { lines.push(l); l = w; } else l = tt; } lines.push(l); return lines; };
  const cols = [[477, items.slice(0, 4)], [983, items.slice(4, 7)]], CW = 420, LH = 39, hits = [];
  x.fillStyle = '#0c0c0c';
  for (const [cx, list] of cols) {
    let y = 168;
    for (const [name, desc] of list) {
      const i = items.indexOf(list[list.indexOf(list.find((e) => e[0] === name))]), on = i === hi;
      const nm = name.charAt(0) + name.slice(1).toLowerCase();       // sentence case, as in the Figma frame
      x.font = `400 31px ${GS}`; x.letterSpacing = tr(31, -0.02);
      const lines = wrap(desc, CW), top = y - 30, bottom = y + LH * lines.length + 10;
      hits.push({ i, x: cx - 26, y: top, w: CW + 40, h: bottom - top });   // where each pillar sits on the card (canvas px)
      if (on && t > 0) {                                                // selected: a black ink block, like REPUBLIC LABS, fades in behind it
        x.fillStyle = `rgba(12,12,12,${t})`; x.fillRect(cx - 22, top - 6, CW + 40, bottom - top + 14);
      }
      const mixc = (a, b) => a.map((v, k) => Math.round(v + (b[k] - v) * t));
      const fg = on ? `rgb(${mixc([12, 12, 12], [217, 217, 214])})` : '#0c0c0c';   // text reverses out to bare metal
      x.fillStyle = fg;
      x.font = `700 31px ${GS}`; x.letterSpacing = tr(31, -0.02); x.fillText(nm, cx, y);
      x.fillStyle = fg; x.font = `400 31px ${GS}`; x.letterSpacing = tr(31, -0.02);
      lines.forEach((l, k) => x.fillText(l, cx, y + LH * (k + 1)));
      y += LH * (lines.length + 1) + 38;
    }
  }
  c.hits = hits; c.size = [W, H];
  return c;
}

// Slide 1 (Nov 13 reference): the Republic Labs lockup on the label. The atom sits on the spindle (the hole is its
// nucleus), REPUBLIC / LABS set heavy below it, INVENT · TEST · DEPLOY · SCALE under that. No red rule.
export function drawLogoLabel() {
  const c = stock(), x = c.getContext('2d');
  x.save(); x.beginPath(); x.arc(C, C, C - 2, 0, Math.PI * 2); x.clip();
  const ink = `rgb(${INK})`; x.strokeStyle = ink; x.fillStyle = ink;
  const ay = C - 232;                                     // atom above the spindle, lockup below it
  x.lineWidth = 18;
  for (const r of [0, Math.PI / 3, -Math.PI / 3]) { x.beginPath(); x.ellipse(C, ay, 132, 49, r, 0, Math.PI * 2); x.stroke(); }
  x.beginPath(); x.arc(C, ay, 21, 0, Math.PI * 2); x.fill();   // nucleus
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.font = `800 82px ${SANS}`; x.letterSpacing = '-2.5px';
  for (const [t, y] of [['REPUBLIC', C + 172], ['LABS', C + 243]]) x.fillText(t, C, y);
  x.font = `700 22px ${SANS}`; x.letterSpacing = '1px';
  const words = ['INVENT', 'TEST', 'DEPLOY', 'SCALE'], gap = 38;
  const ws = words.map((w) => x.measureText(w).width), total = ws.reduce((a, b) => a + b, 0) + gap * (words.length - 1);
  let px = C - total / 2; x.textAlign = 'left';
  words.forEach((w, i) => {
    x.fillText(w, px, C + 296); px += ws[i];
    if (i < words.length - 1) { x.beginPath(); x.arc(px + gap / 2, C + 288, 4, 0, Math.PI * 2); x.fill(); px += gap; }
  });
  x.restore();
  return c;
}

// Their logo: atom over REPUBLIC / LABS, heavy grotesk, centred on cx from y top; w = width of REPUBLIC. Returns height.
export function lockup(x, cx, top, w, col) {
  x.save(); x.strokeStyle = col; x.fillStyle = col;
  const R = 0.38 * w, r = 0.145 * w, ay = top + 0.9 * R;
  x.lineWidth = 0.052 * w; x.lineJoin = 'round';
  for (const a of [0, Math.PI / 3, -Math.PI / 3]) { x.beginPath(); x.ellipse(cx, ay, R, r, a, 0, Math.PI * 2); x.stroke(); }
  x.beginPath(); x.arc(cx, ay, 0.06 * w, 0, Math.PI * 2); x.fill();
  x.font = `800 100px ${SANS}`; x.letterSpacing = '-3px';
  const fs = 100 * w / x.measureText('REPUBLIC').width;
  x.font = `800 ${fs}px ${SANS}`; x.letterSpacing = `${(-0.03 * fs).toFixed(2)}px`; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  const t1 = ay + 0.9 * R + 0.2 * w + 0.72 * fs;
  x.lineWidth = 0.035 * fs; x.lineJoin = 'round';          // a touch past Bold (the plate reads light at this size)
  for (const [t, y] of [['REPUBLIC', t1], ['LABS', t1 + 0.86 * fs]]) { x.fillText(t, cx, y); x.strokeText(t, cx, y); }
  x.restore();
  return t1 + 0.86 * fs - top;
}
