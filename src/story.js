// The fan story (slides after "Connect"): small timelines that play when a slide lands. deck.js calls enter(cam) on
// every slide change; each run gets a token so leaving a slide mid-animation just stops it.
const stage = document.getElementById('stage');
const tap = document.getElementById('tap');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const start = () => (parseFloat(getComputedStyle(stage).getPropertyValue('--in')) || 0.5) * 1000 + 450;   // after the slide's own rise-in
let run = 0;

// phone chrome for the artist's site: status bar, Safari-style address bar, the site's own header
const LOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const SB = '<svg width="74" height="18" viewBox="0 0 74 18" fill="#f5f5f5"><rect x="0" y="11" width="4" height="7" rx="1"/><rect x="6" y="8" width="4" height="10" rx="1"/><rect x="12" y="5" width="4" height="13" rx="1"/><rect x="18" y="2" width="4" height="16" rx="1"/><rect x="40" y="2" width="28" height="14" rx="4" fill="none" stroke="#f5f5f5" stroke-opacity=".5"/><rect x="42.5" y="4.5" width="20" height="9" rx="2"/><rect x="69.5" y="6.5" width="2" height="5" rx="1" fill-opacity=".5"/></svg>';
for (const w of document.querySelectorAll('.web[data-url]')) {
  w.insertAdjacentHTML('afterbegin', `<div class="sb"><span>9:41</span>${SB}</div><div class="url">${LOCK}${w.dataset.url}</div>`
    + '<div class="site"><span class="wm">OLIVIA DEAN</span><span class="menu">Menu</span></div>');   // her real site's header: crimson wordmark, serif Menu
}

// the digital ticket lives beside the phone (not inside it): the phone slides out, the ticket slides in
for (const p of document.querySelectorAll('.web .pass')) p.closest('.slide').appendChild(p);

// a QR code for the digital ticket: 29 x 29 modules, three finder squares, seeded so it's the same every time
for (const box of document.querySelectorAll('.pass .qr')) {
  const N = 29; let seed = 7, r = () => (seed = (seed * 16807) % 2147483647) / 2147483647, out = '';
  const finder = (x, y) => x < 7 && y < 7 || x >= N - 7 && y < 7 || x < 7 && y >= N - 7;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let on;
    if (finder(x, y)) { const fx = x < 7 ? x : x - (N - 7), fy = y < 7 ? y : y - (N - 7); on = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4); }
    else if ((x === 7 || y === 7 || x === N - 8 || y === N - 8) && (x < 8 || x > N - 9) && (y < 8 || y > N - 9)) on = false;   // quiet ring round the finders
    else if (y === 6 || x === 6) on = (x + y) % 2 === 0;                                                                         // timing lines
    else on = r() < 0.48;
    if (on) out += `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`;
  }
  box.innerHTML = `<svg viewBox="0 0 ${N} ${N}" fill="#111" shape-rendering="crispEdges">${out}</svg>`;
}

// touch dot (iOS simulator style), in stage px
function at(el) { const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect(), k = s.width / 1920; return [(r.left + r.width / 2 - s.left) / k, (r.top + r.height / 2 - s.top) / k]; }
function moveTap(x, y, ms) { tap.style.transition = `transform ${ms}ms cubic-bezier(.45,0,.2,1), opacity .3s ease`; tap.style.transform = `translate3d(${x}px, ${y}px, 0)`; }
function hideTap() { tap.style.opacity = 0; tap.classList.remove('down'); }
async function press(el, live) {
  if (!live()) return false;
  if (tap.style.opacity !== '1') { tap.style.transition = 'none'; tap.style.transform = 'translate3d(1300px, 960px, 0)'; void tap.offsetWidth; tap.style.opacity = 1; }
  const [x, y] = at(el); moveTap(x, y, 700); await wait(760); if (!live()) return false;
  tap.classList.add('down'); el.classList.add('press'); await wait(150);
  tap.classList.remove('down'); el.classList.remove('press'); return live();
}
function count(el, a, b, ms, live, f = fmt) {
  const t0 = performance.now();
  const tick = () => { if (!live()) return; const u = Math.min(1, (performance.now() - t0) / ms), e = 1 - Math.pow(1 - u, 3); el.textContent = f(a + (b - a) * e); if (u < 1) requestAnimationFrame(tick); };
  tick();
}
const reveal = (els) => els.forEach((e) => e.classList.remove('in'));

const SCENES = {
  // the queue crawls, glitches, sells out; resale climbs
  async problem(root, live) {
    const win = root.querySelector('.win'), q = root.querySelector('.q'), n = root.querySelector('.qn'), bar = root.querySelector('.bar i');
    q.classList.remove('e', 's'); win.classList.remove('glitch'); n.textContent = '48,213';
    bar.style.transition = 'none'; bar.style.width = '4%'; void bar.offsetWidth; bar.style.transition = '';
    await wait(start()); if (!live()) return;
    bar.style.width = '9%'; count(n, 48213, 47906, 2600, live);
    await wait(2900); if (!live()) return;
    win.classList.add('glitch'); await wait(380); q.classList.add('e');
    await wait(1400); if (!live()) return;
    win.classList.remove('glitch'); void win.offsetWidth; win.classList.add('glitch'); await wait(320); q.classList.add('s');
  },
  // history comes back row by row, then she creates the profile
  async recognize(root, live) {
    const rows = [...root.querySelectorAll('.rv')], cta = root.querySelector('.cta');
    reveal(rows); await wait(start() + 200);
    for (const r of rows) { if (!live()) return; r.classList.add('in'); await wait(430); }
    await wait(500); if (!live()) return;
    if (await press(cta, live)) { await wait(500); hideTap(); }
  },
  // each action lands with its points; the bar crosses into Tier 01
  async points(root, live) {
    const rows = [...root.querySelectorAll('.feed .row')], pts = root.querySelector('.ptn'), bar = root.querySelector('.track i'), tier = root.querySelector('.tier'), nm = root.querySelector('.tier .nm'), toast = root.querySelector('.toast');
    let p = 7420; const set = (v) => { bar.style.width = Math.min(100, v / 100) + '%'; };
    reveal(rows); tier.classList.remove('up'); nm.textContent = 'Tier 02 · Engaged'; toast.classList.remove('in'); pts.textContent = fmt(p); set(p);
    await wait(start() + 300);
    for (const r of rows) {
      if (!live()) return;
      r.classList.add('in'); const add = +r.dataset.add; await wait(380); if (!live()) return;
      count(pts, p, p + add, 650, live); p += add; set(p); await wait(700);
    }
    if (!live()) return;
    tier.classList.add('up'); nm.textContent = 'Tier 01 · Superfan'; await wait(450); if (!live()) return; toast.classList.add('in');
    await wait(3200); if (!live()) return; toast.classList.remove('in');   // the banner lifts away like iOS
  },
  // she taps Get tickets: in before the queue; perks unlock
  async presale(root, live) {
    const q = root.querySelector('.queue'), cta = root.querySelector('.ticket .cta'), locks = [...root.querySelectorAll('.lock')];
    const pass = root.querySelector('.pass'), web = root.querySelector('.web'); pass.classList.remove('in'); web.classList.remove('gone');
    q.classList.remove('skip'); cta.classList.remove('busy', 'done'); locks.forEach((l) => { l.classList.remove('open'); l.textContent = l.dataset.closed; });
    await wait(start() + 500);
    if (!(await press(cta, live))) return;
    cta.classList.add('busy'); await wait(1100); if (!live()) return;
    cta.classList.remove('busy'); cta.classList.add('done'); q.classList.add('skip');
    await wait(300); hideTap();
    for (const l of locks) { await wait(520); if (!live()) return; l.classList.add('open'); l.textContent = 'Unlocked'; }
    await wait(900); if (!live()) return; web.classList.add('gone');          // the phone slides away...
    await wait(260); if (!live()) return; pass.classList.add('in');            // ...and her digital ticket slides in
  },
  // rows drop in, then her rank climbs
  async board(root, live) {
    const rows = [...root.querySelectorAll('.rv')], rks = [...root.querySelectorAll('.mrk')];
    reveal(rows); rks.forEach((r) => { r.textContent = '#4,812'; });
    await wait(start());
    for (const r of rows) { if (!live()) return; r.classList.add('in'); await wait(120); }
    await wait(350); if (!live()) return;
    rks.forEach((rk) => count(rk, 4812, 212, 2000, live, (v) => '#' + fmt(v)));   // header and her row climb together
  },
  // tiers count up, the segment narrows filter by filter, presale goes out direct
  async label(root, live) {
    const ks = [...root.querySelectorAll('[data-n]')], chips = [...root.querySelectorAll('.chips .rv')], segn = root.querySelector('.segn'),
      btn = root.querySelector('.launch'), res = root.querySelector('.result'), rs = [...root.querySelectorAll('[data-r]')];
    reveal(chips); res.classList.remove('in'); btn.classList.remove('done'); btn.firstElementChild.textContent = 'Launch presale →';
    ks.forEach((k) => (k.textContent = '0')); rs.forEach((r) => (r.textContent = '0')); segn.textContent = '0';
    await wait(start()); if (!live()) return;
    ks.forEach((k) => count(k, 0, +k.dataset.n, 1400, live));
    await wait(1100); let n = 0;
    for (const c of chips) { if (!live()) return; c.classList.add('in'); const to = +c.dataset.to; count(segn, n, to, 600, live); n = to; await wait(700); }
    if (!(await press(btn, live))) return;
    btn.classList.add('done'); btn.firstElementChild.textContent = 'Presale sent ✓';
    await wait(300); hideTap(); res.classList.add('in');
    rs.forEach((r) => count(r, 0, +r.dataset.r, 1500, live));
  },
  // the loop lights up word by word, holds, repeats
  async compound(root, live) {
    const w = [...root.querySelectorAll('.loop span:not(.ar)')];
    w.forEach((x) => x.classList.remove('on')); await wait(start() + 200);
    let i = 0;
    while (live()) { w.forEach((x, k) => x.classList.toggle('on', k <= i)); i = (i + 1) % (w.length + 2); await wait(i === 0 ? 1600 : 650); }
  },
};

export function enter(cam) {
  const id = ++run, live = () => id === run;
  hideTap();
  const root = document.querySelector(`.slide[data-cam="${cam}"]`);
  if (SCENES[cam] && root) SCENES[cam](root, live);
}
