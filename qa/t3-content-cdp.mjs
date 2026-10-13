// T3 (t_88aee6d5) — SONDAGE BROWSEUR : LE CONTENU STATIQUE T33 (3 bâtiments
// services, 2 compagnies, 3 améliorations, 3 règles R23 — TOUTES dans
// src/data/catalog.mjs), dans le navigateur RÉEL (le contrat Node est dans
// tests/r47-t33-static-content.test.mjs — celui-ci vérifie le CÂBLAGE
// navigateur : le contenu ADDITIF est VISIBLE dans l'UI (barre d'outils 11
// types + touches 1-9 SANS ligne de code ajoutée — la liste est dérivée du
// catalogue), MESURABLE (OPEX R37 dans la table, offre de vol par la nouvelle
// compagnie via le générateur EXISTANT, déblocage/débit/amélioration par le
// module cache du jeu — MÊME instance que la boucle), et il SURVIT à la
// sauvegarde + au rechargement (« Reprendre ») dans le jeu réel.
// Pattern éprouvé (qa/t3-events-cdp.mjs, qa/t22-cdp.mjs) : Edge headless +
// CDP, 0 dépendance, Node >= 22 (WebSocket global), serveur statique
// serve.mjs. Usage : node qa/t3-content-cdp.mjs   (retour 0 = PASS, 1 = FAIL)
// Rapport : qa/t3-content-cdp-report.json + captures evidence/t3-content-cdp-*.png (horodatées)
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

// --- 1. serveur statique local (pattern t22-cdp.mjs) --------------------------
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
const userDataDir = mkdtempSync(join(tmpdir(), 'at-t3c-')); // stockage vide garanti (pas de sauvegarde ancienne)
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;

// --- 2. Edge headless + CDP (pattern t22-cdp.mjs) ------------------------------
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
    writeFileSync(join(dir, `t3-content-cdp-${ts}-${name}.png`), Buffer.from(s.result.data, 'base64'));
  }
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  const url = `http://127.0.0.1:${port}/`;
  diag.page = url;
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  check('window.__game exposé', (await evaluate('typeof window.__game')) === 'object');

  // --- A. NOUVELLE PARTIE : l'aéroport de départ est posé (A-2) --------------
  const fresh = await evaluate(`(async () => {
    const g = window.__game;
    g.startNewGame();
    await new Promise((r) => setTimeout(r, 800)); // quelques ticks (la boucle tourne)
    const sim = g.state.sim;
    return {
      screen: g.state.screen,
      runway: sim.infra.runways.length,
      gates: sim.infra.gates.length,
      money: sim.economy.money,
    };
  })()`, true);
  check('NOUVELLE PARTIE : jeu démarré + aéroport de départ fourni (piste + 2 portes M)',
    fresh.screen === 'game' && fresh.runway >= 1 && fresh.gates >= 2,
    JSON.stringify(fresh));

  // --- B. BARRE D'OUTILS : les 11 types du catalogue sont DANS L'UI ----------
  // (le contenu est ADDITIF : la liste est dérivée du BUILDINGS (build-tool.mjs
  //  + main.mjs lisent Object.keys(BUILDINGS)) — aucune ligne de code ajoutée
  //  pour les 3 nouveaux types, ni pour leurs libellés/couts).
  const toolbar = await evaluate(`(() => {
    // 15 boutons .tool au total (11 bâtiments + 4 contrôles de jeu) : les
    // 11 BÂTIMENTS sont identifiés par leur libellé « N · nom (coût $) ».
    const buildingBtns = [...document.querySelectorAll('.toolbar .tool')]
      .filter((b) => !b.classList.contains('tool--danger') && /^\\d+ · /.test(b.textContent));
    const text = document.body.textContent;
    return {
      count: buildingBtns.length,
      labels: buildingBtns.map((b) => b.textContent),
      hasSecurity: text.includes('Salle de sécurité'),
      hasDutyfree: text.includes('Boutique libre-service'),
      hasLounge: text.includes('Salon VIP'),
      aria: document.querySelector('.toolbar')?.getAttribute('aria-label') || '',
    };
  })()`);
  check('BARRE : 11 types de construction (8 d’origine + 3 T33) rendus depuis le catalogue',
    toolbar.count === 11, JSON.stringify({ count: toolbar.count }));
  check('BARRE : les 3 nouveaux services T33 sont VISIBLES (libellé + coût du catalogue)',
    toolbar.hasSecurity && toolbar.hasDutyfree && toolbar.hasLounge,
    JSON.stringify({ hasSecurity: toolbar.hasSecurity, hasDutyfree: toolbar.hasDutyfree, hasLounge: toolbar.hasLounge }));
  check('BARRE : l’aria-label est DÉRIVÉ (1-' + (toolbar.aria.includes('1-11') ? 11 : '?') + ')',
    toolbar.aria.includes('1-11'), toolbar.aria);

  // --- C. CLAVIER : la touche 9 = NOUVEAU type (sécurité) — sans code ajouté --
  // (les 8 d'origine gardent leurs touches 1-8 ; la liste KINDS est la MÊME
  //  dans main.mjs — borne aux touches simples, le reste passe par la barre).
  const keys = await evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' })); // mode construction ON
    await new Promise((r) => setTimeout(r, 150));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '9' })); // KINDS[8] = « security »
    await new Promise((r) => setTimeout(r, 150)); // sync() est SYNCHRONE (T33 : setKind appelle sync)
    const btns = [...document.querySelectorAll('.toolbar .tool')]
      .filter((b) => !b.classList.contains('tool--danger') && /^\\d+ · /.test(b.textContent));
    const active = btns.map((b) => ({ i: btns.indexOf(b), active: b.classList.contains('tool--active') }));
    return { labels: btns.map((b) => b.textContent), active: active.map((a) => a.active) };
  })()`, true);
  const activeIdx = keys.active.findIndex((a) => a);
  check('CLAVIER : la touche 9 active le 9e bouton (NOUVELLE salle sécurité — liste dérivée du catalogue)',
    activeIdx === 8 && (keys.labels[8] || '').includes('Salle de sécurité'),
    JSON.stringify({ activeIdx, label9: keys.labels[8] }));
  await shot('toolbar-11-buildings');

  // --- D. CATALOGUE EN PAGE (instance du module CACHE du jeu) ---------------
  // (le contenu est VIVANT côté jeu : la table lue est celle des modules
  //  importés par la boucle — MÊME instance que celle qui produit la sim).
  const cat = await evaluate(`(async () => {
    const C = await import('/src/data/catalog.mjs');
    return {
      airlines: C.AIRLINES.map((a) => a.id),
      upgradeKinds: Object.keys(C.UPGRADES),
      opex: { security: C.OPEX_PER_SEC.security, dutyfree: C.OPEX_PER_SEC.dutyfree, lounge: C.OPEX_PER_SEC.lounge },
    };
  })()`, true);
  check('CATALOGUE : les 2 NOUVELLES compagnies T33 sont dans la table du jeu (additif)',
    cat.airlines.includes('boreal') && cat.airlines.includes('horizon')
      && cat.airlines.includes('solaire') && cat.airlines.includes('atlantique'),
    JSON.stringify(cat.airlines));
  check('CATALOGUE : les 3 NOUVELLES améliorations T33 sont dans la table du jeu (6 choix)',
    cat.upgradeKinds.length === 6
      && cat.upgradeKinds.includes('boarding') && cat.upgradeKinds.includes('marketing') && cat.upgradeKinds.includes('comfort'),
    JSON.stringify(cat.upgradeKinds));
  check('OPEX (R37) : les 3 nouveaux services ont leur DÉBIT DANS LA TABLE (bonne amélioration vs PIÈGE)',
    cat.opex.security === 1 && cat.opex.dutyfree === 1 && cat.opex.lounge === 2.5,
    JSON.stringify(cat.opex));

  // --- E. OFFRE DE VOL : la NOUVELLE compagnie opère via le générateur -------
  // (planOneFlight du module cache du jeu + rng DÉTERMINISTE : le verdit n'est
  //  PAS forcé — c'est le code du jeu qui pioche. Terminal de départ = 2 portes
  //  M uniquement → le « large » n'est PAS servable (verdit du jeu, honnête) →
  //  « medium » ; pool medium = [atlantique, boreal, horizon] → 0,9 → index 2
  //  = HORIZON (nouvelle compagnie T33). Les L-gates (construits plus tard)
  //  servent « large » : c'est le test r47 Node qui le prouve socle pour socle.)
  const offer = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const F = await import('/src/flights/flights.mjs');
    const o = F.planOneFlight(sim, () => 0.9);
    return o ? { acType: o.acType, airline: o.airline, pax: o.pax, status: o.status } : null;
  })()`, true);
  check('OFFRE : le générateur EXISTANT pioche la NOUVELLE compagnie Horizon Express (vol « medium » — bornes M du départ)',
    !!offer && offer.acType === 'medium' && offer.airline === 'horizon' && offer.pax > 0 && offer.status === 'planned',
    JSON.stringify(offer));

  // --- F. DÉBLOCAGE EN PAGE : la MÊME règle que le build-tool (unlockState) ---
  // (totalCarried=600 déclenche security (600), dutyfree (400) ET lounge (500)
  //  — les seuils vivent dans UNLOCK_RULES ; CONDS dans src/infra/unlocks.mjs,
  //  lue par le build-tool ET la boucle — jamais deux règles).
  const unlocks = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const U = await import('/src/infra/unlocks.mjs');
    sim.passengers.totalCarried = 600;
    U.tickUnlocks(sim); // la MÊME fonction que core/tick.mjs (module cache)
    const st = (s) => U.unlockState(sim, s);
    return {
      security: st('security').unlocked, dutyfree: st('dutyfree').unlocked, lounge: st('lounge').unlocked,
      flag: !!sim._unlocked && sim._unlocked.security === true,
    };
  })()`, true);
  check('DÉBLOCAGE : les 3 NOUVEAUX services T33 se DÉVERROUILLent via la MÊME règle que le build-tool',
    unlocks.security === true && unlocks.dutyfree === true && unlocks.lounge === true && unlocks.flag === true,
    JSON.stringify(unlocks));

  // --- G. CONSTRUCTION + AMÉLIORATION T33 (modules cache du jeu) -------------
  const build = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const I = await import('/src/infra/infra.mjs');
    const A = await import('/src/infra/upgrades.mjs');
    const [term] = sim.infra.terminals;
    const moneyBefore = sim.economy.money;
    const svc = I.buildBuilding(sim, 'security', 350, 950); // la NOUVELLE salle sécurité
    const up = A.buyUpgrade(sim, term.id, 'boarding'); // la NOUVELLE amélioration T33
    return {
      built: !!svc,
      services: sim.infra.services.filter((s) => s.type === 'security').length,
      moneyDelta: Math.round(moneyBefore - sim.economy.money),
      buyOk: up.ok, level: A.upgradeLevel(sim, term.id, 'boarding'),
      gateOps: A.gateOpsMult(sim, term.id),
    };
  })()`, true);
  check('CONSTRUCTION : la NOUVELLE salle sécurité est CONSTRUITE (débit OPEX + coût du catalogue)',
    build.built === true && build.services === 1 && build.moneyDelta >= 1200,
    JSON.stringify(build));
  check('AMÉLIORATION : le NOUVEAU choix « boarding » est ACHETÉ (niveau 1 → ops au sol ×0,75)',
    build.buyOk === true && build.level === 1 && build.gateOps === 0.75,
    JSON.stringify({ level: build.level, gateOps: build.gateOps }));
  await shot('security-built');

  // --- H. PERSISTANCE : le contenu T33 est SÉRIALISÉ (R10) -------------------
  const saved = await evaluate(`(() => {
    const g = window.__game;
    const sim = g.state.sim;
    g.save();
    const raw = localStorage.getItem('airport-tycoon-save');
    let parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch { /* pas un JSON */ } }
    const s = parsed?.state?.sim;
    const tid = s?.infra?.terminals?.[0]?.id;
    const up = tid != null ? (s.upgrades?.[String(tid)] || s.upgrades?.[tid] || {}) : {};
    return {
      savedSecurity: s?.infra?.services?.some((x) => x.type === 'security') ?? null,
      savedBoarding: up.boarding ?? null,
      savedFlag: s?._unlocked?.security ?? null,
    };
  })()`);
  check('PERSISTANCE : la salle sécurité T33 + le niveau boarding sont SÉRIALISÉS dans la sauvegarde',
    saved.savedSecurity === true && saved.savedBoarding === 1 && saved.savedFlag === true,
    JSON.stringify(saved));

  // --- I. RECHARGEMENT : « Reprendre » RESTAURE le contenu T33 ---------------
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  const resumed = await evaluate(`(async () => {
    const g = window.__game;
    const resume = [...document.querySelectorAll('.menu-btns button')]
      .find((b) => b.textContent.includes('Reprendre'));
    if (!resume || resume.style.display === 'none') return { noResumeBtn: true };
    resume.click();
    await new Promise((r) => setTimeout(r, 600));
    const sim = g.state.sim;
    const A = await import('/src/infra/upgrades.mjs');
    const [term] = sim.infra.terminals;
    return {
      screen: g.state.screen,
      securityRestored: sim.infra.services.some((s) => s.type === 'security'),
      boardingRestored: A.upgradeLevel(sim, term.id, 'boarding'),
      flag: sim._unlocked?.security === true,
    };
  })()`, true);
  check('RECHARGEMENT : la salle sécurité T33 + le niveau boarding SONT RESTAURÉS (« Reprendre »)',
    resumed.screen === 'game' && resumed.securityRestored === true && resumed.boardingRestored === 1
      && resumed.flag === true,
    JSON.stringify(resumed));
  await shot('resume-restored');

  check('aucune exception de page', pageExceptions.length === 0,
    pageExceptions.slice(0, 2).join(' | ').slice(0, 200));
  return finish();

  function finish() {
    const ok = results.every((r) => r.ok) && pageExceptions.length === 0;
    writeFileSync(join(import.meta.dirname, 't3-content-cdp-report.json'),
      JSON.stringify({ ok, ts, results, diag, pageExceptions }, null, 2));
    server.kill();
    if (edgeProc) edgeProc.kill();
    console.log(`\n${ok ? 'PASS' : 'FAIL'} T3 CONTENU CDP — ${results.filter((r) => r.ok).length}/${results.length} checks`);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error('ERREUR T3 CONTENU CDP :', e);
  server.kill();
  if (edgeProc) edgeProc.kill();
  process.exit(1);
});
