// T51 (t_cccfbc97) — REPRODUCTION : mesure des chevauchements réels des
// couches DOM UI (Edge headless + CDP, 0 dépendance, Node >= 22).
// Usage : node qa/t51-repro-cdp.mjs
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE_CANDIDATES = [
  process.env.QA_EDGE,
  process.env.QA_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) { console.error('Edge introuvable'); process.exit(1); }

function freePort() { return 8700 + Math.floor(Math.random() * 500); }
function httpProbe(url, tries = 40) {
  return new Promise((resolve) => {
    let n = 0;
    (function attempt() {
      httpGet(url, (res) => { resolve(res.statusCode === 200); res.resume(); })
        .on('error', () => { if (++n < tries) setTimeout(attempt, 100); else resolve(false); });
    })();
  });
}

const port = freePort();
const cdpPort = freePort();
const userDataDir = mkdtempSync(join(tmpdir(), 'at-t51-'));
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function startBrowser() {
  const edgeProc = spawn(edge, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1366,768',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const target = await new Promise((resolve) => {
    let n = 0;
    (function poll() {
      httpGet(`http://127.0.0.1:${cdpPort}/json/list`, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try {
            const list = JSON.parse(body);
            const page = list.find((t) => t.type === 'page');
            if (page) resolve(page);
            else if (++n < 50) setTimeout(poll, 250);
            else resolve(null);
          } catch { if (++n < 50) setTimeout(poll, 250); else resolve(null); }
        });
      }).on('error', () => { if (++n < 50) setTimeout(poll, 250); else resolve(null); });
    })();
  });
  if (!target) { edgeProc.kill(); return null; }
  return { proc: edgeProc, target };
}

const SELS = ['#game', '.toasts', '.planning', '.panels', '.intro', '.toolbar', '.bankruptcy', '.options', '.menu-btns'];
const MEASURE = `(() => {
  const out = [];
  for (const sel of ${JSON.stringify(SELS)}) {
    const el = document.querySelector(sel);
    if (!el) { out.push({ sel, present: false }); continue; }
    const st = getComputedStyle(el);
    if (el.style.display === 'none' || st.display === 'none') { out.push({ sel, present: true, hidden: true }); continue; }
    const r = el.getBoundingClientRect();
    out.push({
      sel, present: true, hidden: false,
      pos: st.position, z: st.zIndex,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    });
  }
  return out;
})()`;

function overlap(a, b) {
  if (!a || !b || a.hidden || b.hidden || !a.present || !b.present) return 0;
  const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
  const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

async function measureSet(ws, label) {
  await new Promise((r) => setTimeout(r, 1200));
  const data = await (async () => {
    const pending = new Map();
    let seq = 0;
    const wsx = ws;
    wsx.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg); pending.delete(msg.id); }
    };
    return {
      evaluate: async (expr) => {
        const id = ++seq;
        const res = await new Promise((resolve) => {
          pending.set(id, { resolve });
          wsx.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
        });
        return res.result.result.value;
      },
      close: () => wsx.close(),
    };
  })();
  const layers = await data.evaluate(MEASURE);
  const interactive = layers.filter((l) => l.present && !l.hidden && l.w > 0 && l.h > 0 && l.sel !== '#game' && l.sel !== '.toasts');
  const pairs = [];
  for (let i = 0; i < interactive.length; i++) {
    for (let j = i + 1; j < interactive.length; j++) {
      const ov = overlap(interactive[i], interactive[j]);
      if (ov > 0) pairs.push({ a: interactive[i].sel, b: interactive[j].sel, px: Math.round(ov) });
    }
  }
  console.log(`\n=== ${label} ===`);
  for (const l of layers) {
    if (!l.present) continue;
    console.log(`  ${l.sel.padEnd(12)} ${l.hidden ? 'hidden' : `pos=${l.pos} z=${l.z} box=${l.x},${l.y} ${l.w}x${l.h}`}`);
  }
  console.log(`  chevauchements interactifs : ${pairs.length}`);
  for (const p of pairs) console.log(`    ${p.a} x ${p.b} — ${p.px} px²`);
  return { label, layers, pairs };
}

async function main() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  if (!up) { console.error('serveur down'); server.kill(); process.exit(1); }
  const b = await startBrowser();
  if (!b) { console.error('Edge down'); server.kill(); process.exit(1); }
  const ws = new WebSocket(b.target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  await new Promise((resolve) => {
    const id = 1;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) resolve(); };
    ws.send(JSON.stringify({ id, method: 'Page.enable' }));
  });
  // 1. Desktop 1366x768 — menu + jeu
  await new Promise((resolve) => {
    const id = 2;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) resolve(); };
    ws.send(JSON.stringify({ id, method: 'Page.navigate', params: { url: `http://127.0.0.1:${port}/` } }));
  });
  const m1 = await measureSet(ws, 'desktop 1366x768 — MENU');
  // 2. Desktop — partie jouée (toolbar + panels + planning + intro + toasts)
  const inGame = `(() => {
    const g = window.__game;
    g.startNewGame();
    // Forcer quelques toasts pour mesurer la pile : les toasts réels (toast.mjs)
    // apparaissent sur événements ; on les déclenche via les toasts du jeu.
    return true;
  })()`;
  await new Promise((resolve) => {
    const id = 3;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 3) resolve(); };
    ws.send(JSON.stringify({ id: 3, method: 'Runtime.evaluate', params: { expression: inGame } }));
  });
  await new Promise((r) => setTimeout(r, 3000)); // toasts de début de partie (construction…)
  const m2 = await measureSet(ws, 'desktop 1366x768 — JEU (toolbar/planning/panels/intro/toasts)');
  // 3. Mobile 390x844 — jeu
  await new Promise((resolve) => {
    const id = 4;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 4) resolve(); };
    ws.send(JSON.stringify({ id, method: 'Emulation.setDeviceMetricsOverride', params: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } }));
  });
  await new Promise((r) => setTimeout(r, 1500));
  const m3 = await measureSet(ws, 'mobile 390x844 — JEU');
  ws.close();
  const total = m1.pairs.length + m2.pairs.length + m3.pairs.length;
  console.log(`\nTOTAL chevauchements interactifs : ${total}`);
  b.proc.kill();
  server.kill();
  process.exit(0);
}

main().catch((e) => { console.error('ERREUR repro T51 :', e); server.kill(); process.exit(1); });
