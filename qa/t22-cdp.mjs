// T2-2 (t_6344db94) — SONDAGE BROWSEUR : CAMPAGNE DE VICTOIRE + STATS
// PERSISTANTES + SUCCÈS, dans le navigateur RÉEL (le contrat Node est dans
// tests/r45-campaign.test.mjs — celui-ci vérifie le CÂBLAGE navigateur :
// le PANEAU « Saison, stats & succès » (lecture seule), la VICTOIRE de la
// saison (3 contrats réussis → prime + toast « SAISON REMPORTÉE »), un
// SUCCÈS débloqué (toast « SUCCÈS DÉBLOQUÉ »), la PERSISTANCE : campagne +
// succès sÉRIALISÉs dans la sauvegarde SURVIVENT au rechargement, et
// « Reprendre » garde l'état).
// Pattern éprouvé (qa/t21-cdp.mjs, qa/r43-cdp.mjs) : Edge headless + CDP,
// 0 dépendance, Node >= 22 (WebSocket global), serveur statique serve.mjs.
// Usage : node qa/t22-cdp.mjs   (retour 0 = PASS, 1 = FAIL)
// Rapport : qa/t22-cdp-report.json + captures evidence/t22-*.png
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
const diag = { browser: null, spawnError: null, cdpTarget: null, started: false, page: null };
const pageExceptions = [];
const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{6})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3-$4');

const EDGE_CANDIDATES = [
  process.env.QA_EDGE,
  process.env.QA_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
diag.browser = edge;

// --- 1. serveur statique local (pattern r43-cdp.mjs) ---------------------------
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
const userDataDir = mkdtempSync(join(tmpdir(), 'at-t22-')); // stockage vide garanti
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;

// --- 2. Edge headless + CDP (pattern r43-cdp.mjs) ------------------------------
async function startBrowser() {
  edgeProc = spawn(edge, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1280,800',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  edgeProc.stderr.on('data', (d) => { diag.spawnError = (diag.spawnError || '') + String(d); });
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
  if (!target) return null;
  diag.started = true;
  diag.cdpTarget = target.webSocketDebuggerUrl;
  return target;
}

async function main() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  check('serveur local répond', up, `http://127.0.0.1:${port}`);
  if (!up) return finish();
  if (!edge) {
    check('navigateur Edge introuvable', false,
      `aucun candidat existant : ${EDGE_CANDIDATES.join(' | ')}`);
    return finish();
  }
  const target = await startBrowser();
  if (!target) {
    check('navigateur démarré', false,
      `Edge headless n'expose aucune cible CDP (exécutable=${edge}) stderr=${(diag.spawnError || '').slice(0, 300)}`);
    return finish();
  }
  check('navigateur démarré (cible CDP page)', true, `${edge}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageExceptions.push(((d.exception?.description || d.text || '') + '').slice(0, 300));
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const cdp = (method, params = {}) => {
    const id = ++seq;
    return new Promise((resolve) => {
      pending.set(id, { resolve });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  async function evaluate(expression, awaitPromise = false) {
    const msg = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (msg.result.exceptionDetails) {
      throw new Error('exception page : ' + (msg.result.exceptionDetails.exception?.description || JSON.stringify(msg.result.exceptionDetails)));
    }
    return msg.result.result.value;
  }
  async function shot(name) {
    const s = await cdp('Page.captureScreenshot', { format: 'png' });
    const dir = join(import.meta.dirname, '..', 'evidence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `t22-${ts}-${name}.png`), Buffer.from(s.result.data, 'base64'));
  }
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  const url = `http://127.0.0.1:${port}/`;
  diag.page = url;
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  check('window.__game exposé', (await evaluate('typeof window.__game')) === 'object');

  // --- A. « Nouvelle partie » : campagne/stats/succès INITIALISÉS -----------
  // (initialisation paresseuse : le 1er tick crée sim.campaign/stats/
  //  achievements — on laisse quelques ticks s'écouler avant la lecture).
  const fresh = await evaluate(`(async () => {
    const g = window.__game;
    g.startNewGame();
    await new Promise((r) => setTimeout(r, 800)); // quelques ticks (création paresseuse)
    const s = g.state;
    return {
      screen: s.screen,
      campaign: JSON.parse(JSON.stringify(s.sim.campaign)),
      stats: JSON.parse(JSON.stringify(s.sim.stats)),
      pax: s.sim.passengers?.totalCarried ?? 0,
      achievements: JSON.parse(JSON.stringify(s.sim.achievements)),
    };
  })()`, true);
  check('Nouvelle partie : la CAMPAGNE est initialisée (active, 0/3, pas de prime)',
    fresh.screen === 'game' && fresh.campaign?.status === 'active'
    && fresh.campaign.wins === 0 && fresh.campaign.rewardPaid === false,
    JSON.stringify(fresh.campaign));
  check('Nouvelle partie : les STATS sont initialisées (série 0, incidents 0) + 0 pax',
    fresh.stats?.nonDeficit?.best === 0 && fresh.stats?.incidentsSurvived === 0
    && fresh.stats?.periodsClosed === 0 && fresh.pax === 0,
    JSON.stringify(fresh.stats));
  check('Nouvelle partie : les SUCCÈS sont initialisés (aucun débloqué)',
    fresh.achievements && Object.keys(fresh.achievements.unlocked).length === 0,
    JSON.stringify(fresh.achievements));

  // --- B. le PANEAU « Saison, stats & succès » est AFFICHÉ (lecture seule) ---
  const panel = await evaluate(`(() => {
    const body = document.body.textContent;
    return {
      section: body.includes('Saison, stats & succès'),
      campaignLine: body.includes('0/3 contrats réussis'),
      succas: body.includes('0/8 débloqué(s)'),
    };
  })()`);
  check('Panneau : section « Saison, stats & succès » visible (campagne 0/3 + succès 0/8)',
    panel.section && panel.campaignLine && panel.succas, JSON.stringify(panel));

  // --- C. VICTOIRE : 3 contrats réussis → la SIM déclenche la SAISON GAGNÉE --
  const won = await evaluate(`(async () => {
    const g = window.__game;
    const s = g.state;
    s.sim.campaign.wins = 3; // le règlement des 3 contrats vient d'avoir lieu (le hook countCampaignWin)
    await new Promise((r) => setTimeout(r, 1200)); // quelques ticks (la règle tickCampaign)
    const c = s.sim.campaign;
    return {
      status: c.status,
      rewardPaid: c.rewardPaid,
      endedAt: c.endedAt,
      money: s.sim.economy.money,
      revenueCampaign: s.sim.economy.revenue?.campaign ?? null,
      toastWon: document.body.textContent.includes('SAISON REMPORTÉE'),
      panelWon: document.body.textContent.includes('gagnée — 3 contrats réussis, prime 2500 $'),
      achSeason: s.sim.achievements.unlocked['season-won'] !== undefined,
    };
  })()`, true);
  check('VICTOIRE : la sim passe la campagne à « won » (prime payée UNE fois, horodatée)',
    won.status === 'won' && won.rewardPaid === true && Number.isFinite(won.endedAt),
    JSON.stringify(won));
  check('VICTOIRE : la prime 2500 $ est créditée au compte revenue « campaign »',
    won.revenueCampaign === 2500 && won.money >= 2500,
    `revenue.campaign=${won.revenueCampaign} money=${won.money}`);
  check('VICTOIRE : toast « SAISON REMPORTÉE » + le PANEAU affiche la saison gagnée',
    won.toastWon === true && won.panelWon === true, JSON.stringify(won));
  check('VICTOIRE : le SUCCÈS « Saison remportée » est débloqué (condition mesurée)',
    won.achSeason === true);
  await shot('saison-gagnee');

  // --- D. SUCCÈS : 100 pax transportés → déblocage + toast -------------------
  const ach = await evaluate(`(async () => {
    const g = window.__game;
    const s = g.state;
    s.sim.passengers.totalCarried = 150; // le compteur EXISTANT (la mesure est un fait)
    await new Promise((r) => setTimeout(r, 1200));
    return {
      pax100: s.sim.achievements.unlocked['pax-100'] !== undefined,
      toastAch: document.body.textContent.includes('SUCCÈS DÉBLOQUÉ'),
      panelCount: document.body.textContent.includes('2/8 débloqué(s)'),
      pax: s.sim.passengers?.totalCarried,
    };
  })()`, true);
  check('SUCCÈS « Premiers pas » : 100 pax transportés → débloqué + toast « SUCCÈS DÉBLOQUÉ »',
    ach.pax100 === true && ach.toastAch === true, JSON.stringify(ach));
  check('Panneau : le compteur de succès suit (2/8 : saison remportée + premiers pas)',
    ach.panelCount === true);
  check('STATS : le total pax est une LECTURE du compteur existant (≥ 150 transportés)',
    ach.pax >= 150, `totalCarried=${ach.pax}`);
  await shot('succes-debloque');

  // --- E. PERSISTANCE : campagne + succès SÉRIALISÉS dans la sauvegarde ------
  const saved = await evaluate(`(() => {
    const g = window.__game;
    g.save();
    const raw = localStorage.getItem('airport-tycoon-save');
    let parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch { /* pas un JSON */ } }
    const sim = parsed?.state?.sim;
    return {
      savedCampaign: sim?.campaign?.status ?? null,
      savedWins: sim?.campaign?.wins ?? null,
      savedPax100: sim?.achievements?.unlocked?.['pax-100'] !== undefined,
      savedPax: sim?.passengers?.totalCarried ?? null,
    };
  })()`);
  check('PERSISTANCE : la campagne (won, 3 succès) est SÉRIALISÉE dans la sauvegarde',
    saved.savedCampaign === 'won' && saved.savedWins === 3, JSON.stringify(saved));
  check('PERSISTANCE : le succès pax-100 + le compteur pax (≥ 150) sont SÉRIALISÉS',
    saved.savedPax100 === true && saved.savedPax >= 150, JSON.stringify(saved));

  // --- F. RECHARGEMENT : l'état SURVIT et « Reprendre » LE GARE -------------
  await cdp('Page.navigate', { url }); // avant le quit : auto-save (beforeunload, R14)
  await new Promise((r) => setTimeout(r, 1500));
  const resumed = await evaluate(`(async () => {
    const g = window.__game;
    const resume = [...document.querySelectorAll('.menu-btns button')]
      .find((b) => b.textContent.includes('Reprendre'));
    if (!resume || resume.style.display === 'none') return { noResumeBtn: true };
    resume.click();
    await new Promise((r) => setTimeout(r, 400));
    const s = g.state;
    return {
      screen: s.screen,
      campaignStatus: s.sim.campaign?.status,
      campaignWins: s.sim.campaign?.wins,
      pax100: s.sim.achievements?.unlocked?.['pax-100'] !== undefined,
      panelWon: document.body.textContent.includes('gagnée — 3 contrats réussis, prime 2500 $'),
    };
  })()`, true);
  check('RECHARGEMENT : « Reprendre » RESTAURE la campagne gagnée (état serialisé)',
    resumed.screen === 'game' && resumed.campaignStatus === 'won' && resumed.campaignWins === 3,
    JSON.stringify(resumed));
  check('RECHARGEMENT : le succès pax-100 SURVIT + le PANEAU garde « saison gagnée »',
    resumed.pax100 === true && resumed.panelWon === true, JSON.stringify(resumed));

  check('aucune exception de page', pageExceptions.length === 0,
    pageExceptions.slice(0, 2).join(' | ').slice(0, 200));
  return finish();

  function finish() {
    const ok = results.every((r) => r.ok) && pageExceptions.length === 0;
    writeFileSync(join(import.meta.dirname, 't22-cdp-report.json'),
      JSON.stringify({ ok, results, diag, pageExceptions }, null, 2));
    server.kill();
    if (edgeProc) edgeProc.kill();
    console.log(`\n${ok ? 'PASS' : 'FAIL'} T2-2 CDP — ${results.filter((r) => r.ok).length}/${results.length} checks`);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error('ERREUR T2-2 CDP :', e);
  server.kill();
  if (edgeProc) edgeProc.kill();
  process.exit(1);
});
