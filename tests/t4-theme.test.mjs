/**
 * T4 (t_eb78478e) : THEME (ui/theme.mjs), ICONS (ui/icons.mjs), TIPS (ui/tips.mjs).
 *
 * Ce que ces tests PROUVENT (aucun DOM, aucun canvas) :
 *  - THEME : un module GELÉ de design tokens (« RADAR RÉTRO » — maquette
 *    variant-c, t_bd4726e7) ; les couleurs du canvas et du DOM DOIVENT
 *    passer par ici (pas de hex en dur dans les modules UI) ; les tokens
 *    existent, sont stables (Object.is après import multiple) et conformes
 *    au format attendu (hex 3/6, rgb, px, bool, chaîne) ; les couleurs du
 *    MONDE (palette.mjs, R43) ne sont PAS des tokens de thème (le thème
 *    ne surchargee jamais les couleurs du monde).
 *  - ICONS : ICON_KINDS liste les 14 types ; drawIcon est PUR en lecture
 *    (aucune mutation de ctx non déclarée) ; iconCanvas crée un canvas
 *    (navigateur) ou null (Node) — le contrat « zéro asset » est celui du
 *    retour null, jamais d'exception.
 *  - TIPS : les 5 astuces (id stable, titre + texte) ; les conditions sont
 *    LECTURES SEULE de la sim (aucune mutation) ; la persistance passe par
 *    `state.tips.seen` (sérialisée → une seule fois par partie) ; refresh()
 *    n'émet JAMAIS deux fois la même astuce (jamais de rediffusion) et
 *    n'émet rien tant que la condition n'est pas remplie.
 *
 * Pattern de la suite : tests assertifs Node (node:assert/strict), sans
 * canvas ni DOM (les fonctions attendues retournent null / n'ont pas de
 * effet de bord ici).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { THEME, CSS_MIRRORED_KEYS, themeColor } from '../src/ui/theme.mjs';
import { drawIcon, iconCanvas, ICON_KINDS } from '../src/ui/icons.mjs';
import { makeTips, TIPS, ensureTips } from '../src/ui/tips.mjs';
import { getPalette } from '../src/ui/palette.mjs'; // les couleurs du MONDE (jamais des tokens)

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ok ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1; }
}

// ---- THEME : tokens du design « RADAR RÉTRO » (v2, t_bd4726e7) -----------
ok('theme: THEME est un objet GELÉ (pas de mutation possible)', () => {
  assert.equal(Object.isFrozen(THEME), true);
  assert.throws(() => { THEME.bg = '#ffffff'; }, TypeError);
  assert.equal(THEME.bg, '#050807'); // v2 : noir phosphore (v1 : « asphalte nuit » #0a1220)
});

ok('theme: les tokens miroirés sont tous présents et non vides', () => {
  for (const k of CSS_MIRRORED_KEYS) {
    assert.ok(k in THEME, `token manquant : ${k}`);
    const v = THEME[k];
    assert.ok(v !== undefined && v !== null && v !== '', `token vide : ${k}`);
  }
});

ok('theme: les tailles (canvas, px) sont des nombres, les polices des chaînes', () => {
  for (const k of ['titleSize', 'subtitleSize', 'hudFontSize']) {
    assert.equal(typeof THEME[k], 'number', `${k} doit être un nombre (px), reçu ${typeof THEME[k]}`);
  }
  for (const k of ['fontUi', 'versionTag']) {
    assert.equal(typeof THEME[k], 'string', `${k} doit être une chaîne, reçu ${typeof THEME[k]}`);
  }
});

ok('theme: les couleurs du MONDE (palette.mjs) ne sont PAS des tokens', () => {
  // R43 : le thème est une couche de design ; les couleurs du monde (avion,
  // sol, brouillard) vivent dans ui/palette.mjs et ne doivent JAMAIS être
  // surchargées par le thème. Vérification par le contenu (pas par le nom) :
  // aucun token ne reprend une valeur du monde (ex. le gris de la piste).
  const p = getPalette(false);
  const values = Object.values(THEME);
  assert.ok(!values.includes(p.planeBody), 'le corps de l\'avion (couleur du monde) ne doit pas être un token de thème');
});

ok('theme: COHÉRENCE avec le :root d\'index.html (miroir token ↔ variable CSS)', () => {
  // La règle du module : chaque token de CSS_MIRRORED_KEYS est MIRRORÉ en
  // variable `--at-<clé>` (kebab-case) dans le :root d'index.html — MÊME
  // valeur. Un token changé ici sans le :root fait ROUGIR ce test (et
  // inversement : la variable lue DOIT exister).
  const kebab = (s) => s.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase());
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const k of CSS_MIRRORED_KEYS) {
    const m = html.match(new RegExp(`--at-${kebab(k)}\\s*:\\s*([^;]+);`));
    assert.ok(m, `variable CSS manquante : --at-${kebab(k)}`);
    assert.equal(m[1].trim(), THEME[k], `--at-${kebab(k)} diverge : CSS=${m[1].trim()} THEME=${THEME[k]}`);
  }
});

ok('theme: themeColor() = la couleur du token (null si non-couleur)', () => {
  for (const k of CSS_MIRRORED_KEYS) assert.equal(themeColor(k), THEME[k], `themeColor(${k})`);
  assert.equal(themeColor('titleSize'), null, 'une taille (nombre) n\'est pas une couleur');
  assert.equal(themeColor('fontUi'), null, 'une police (chaîne non-couleur) n\'est pas une couleur');
  assert.equal(themeColor('inconnue'), null, 'clé absente → null (jamais d\'exception)');
});

// ---- ICONS : glyphe vectoriel par type (zéro asset) ----------------------
ok('icons: ICON_KINDS = les 14 types (11 constructions + plane, info, gear)', () => {
  assert.equal(ICON_KINDS.length, 14);
  for (const k of ['runway', 'taxiway', 'terminal', 'gate', 'fueling', 'security', 'catering', 'boarding', 'hotel', 'parking', 'cafe']) {
    assert.ok(ICON_KINDS.includes(k), `icône manquante : ${k}`);
  }
  for (const k of ['plane', 'info', 'gear']) assert.ok(ICON_KINDS.includes(k), `icône manquante : ${k}`);
});

// Un ctx « sec » qui enregistre les appels (pas de canvas réel sous Node).
// Toute la surface canvas 2D utilisée par icons.mjs (jamais d'exception).
function makeSpyCtx() {
  const calls = [];
  const rec = (name) => (...a) => calls.push([name, ...a]);
  return {
    calls,
    save: rec('save'),
    restore: rec('restore'),
    translate: rec('translate'),
    rotate: rec('rotate'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    quadraticCurveTo: rec('quadraticCurveTo'),
    arc: rec('arc'),
    ellipse: rec('ellipse'),
    fillRect: rec('fillRect'),
    strokeRect: rec('strokeRect'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    setLineDash: rec('setLineDash'),
    get fillStyle() { return '#fff'; }, set fillStyle(v) { calls.push(['fillStyle', v]); },
    get strokeStyle() { return '#fff'; }, set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    get lineWidth() { return 1; }, set lineWidth(v) { calls.push(['lineWidth', v]); },
    get lineCap() { return 'round'; }, set lineCap(v) { calls.push(['lineCap', v]); },
    get lineJoin() { return 'round'; }, set lineJoin(v) { calls.push(['lineJoin', v]); },
    get globalAlpha() { return 1; }, set globalAlpha(v) { calls.push(['globalAlpha', v]); },
  };
}

ok('icons: drawIcon dessine pour CHAQUE des 14 types (≥3 ops de dessin chacune)', () => {
  for (const kind of ICON_KINDS) {
    const ctx = makeSpyCtx();
    drawIcon(ctx, kind, 32, { color: '#fff', accent: '#4fc3f7' });
    // Les ops de dessin (pas les réglages de style) : au moins 3 par glyphe.
    const ops = ctx.calls.filter((c) => ['moveTo', 'lineTo', 'arc', 'ellipse', 'fillRect', 'strokeRect', 'fill', 'stroke', 'quadraticCurveTo'].includes(c[0]));
    assert.ok(ops.length >= 3, `icône ${kind} : ${ops.length} ops de dessin (attendu ≥3)`);
  }
});

ok('icons: kind inconnu = carré neutre (jamais d\'exception — UI fine)', () => {
  const ctx = makeSpyCtx();
  drawIcon(ctx, 'inconnu', 32, { color: '#fff', accent: '#4fc3f7' });
  assert.ok(ctx.calls.some((c) => c[0] === 'fillRect'), 'un kind inconnu doit dessiner le carré neutre');
});

ok('icons: taille 0 = pas d\'exception (boîte vide, zéro géométrie utile)', () => {
  const ctx = makeSpyCtx();
  drawIcon(ctx, 'plane', 0, { color: '#fff' }); // pas de crash
  assert.ok(ctx.calls.length > 0, 'le cadre save/restore est passé (pas de crash)');
});

ok('icons: iconCanvas = null sous Node (contrat zéro asset, jamais d\'exception)', () => {
  assert.equal(iconCanvas('plane', 20, { color: '#fff' }), null);
});

// ---- TIPS : 5 astuces d'onboarding, une seule fois, persistées -----------
// (ids réels : first-service, first-flight, treasury, weather, objective)
function freshState() {
  // L'état MINIMAL que les conditions lisent (aucune sim réelle, pas d'import du jeu).
  // weather « clear » = l'état de départ (l'astuce météo ne part qu'au 1er temps dégradé).
  const state = {
    sim: {
      economy: { money: 8000, flightsLanded: 0 },
      infra: { services: [] },
      events: { seq: 0 },
      weather: { state: 'clear', remaining: 900, acc: 0 },
    },
    tips: { seen: [] },
  };
  return state;
}

ok('tips: les 5 astuces ont des id stables + titre + texte', () => {
  assert.equal(TIPS.length, 5);
  assert.deepEqual(TIPS.map((t) => t.id), ['first-service', 'first-flight', 'treasury', 'weather', 'objective']);
  for (const t of TIPS) {
    assert.ok(t.id && t.title && t.text, `astuce incomplète : ${t.id}`);
    assert.equal(typeof t.when, 'function', `condition manquante : ${t.id}`);
  }
});

ok('tips: conditions LECTURE SEULE (aucune mutation de la sim)', () => {
  const state = freshState();
  const before = JSON.stringify(state.sim);
  for (const t of TIPS) {
    t.when(state.sim, state); // chaque condition est évaluée (état non conforme → false, sans exception)
  }
  assert.equal(JSON.stringify(state.sim), before, 'une condition a MUTÉ la sim');
});

ok('tips: refresh() n\'émet rien tant que les conditions sont fausses', () => {
  const state = freshState();
  const fired = [];
  const tips = makeTips(state, { toast: (txt, o) => fired.push(o && o.title) });
  tips.refresh();
  assert.equal(fired.length, 0, `attendu 0 toast, reçu ${fired.length}`);
});

ok('tips: refresh() émet CHAQUE astuce une fois (jamais de rediffusion)', () => {
  const state = freshState();
  const fired = [];
  const tips = makeTips(state, { toast: (txt, o) => fired.push(o && o.title) });
  // Remplir les conditions UNE PAR UNE (la sim « évolue ») :
  state.sim.infra.services = [{ kind: 'catering' }]; tips.refresh(); // first-service
  state.sim.economy.flightsLanded = 1; tips.refresh(); // first-flight
  state.sim.economy.money = 3000; tips.refresh(); // treasury (< 4 000 $)
  state.sim.weather.state = 'rain'; tips.refresh(); // weather (≠ clear)
  state.sim.events.seq = 1; tips.refresh(); // objective
  assert.equal(fired.length, 5, `attendu 5 toasts, reçu ${fired.length}`);
  assert.deepEqual(fired, TIPS.map((t) => t.title), 'l\'ordre des toasts = l\'ordre des TIPS');
  // RE-REFRESH à l'identique : PLUS RIEN (jamais de rediffusion — la règle)
  tips.refresh();
  assert.equal(fired.length, 5, 'une astuce a été RE-émise (rediffusion)');
  assert.equal(state.tips.seen.length, 5, 'la persistance (state.tips.seen) n\'a pas été remplie');
  assert.deepEqual(tips.seen(), TIPS.map((t) => t.id)); // la lecture est stable
});

ok('tips: state.tips absente → ensureTips la normalise (jamais de crash)', () => {
  const state = { sim: freshState().sim };
  const fired = [];
  const tips = makeTips(state, { toast: (t, o) => fired.push(o && o.title) });
  // makeTips est en LECTURE (zéro mutation) : c'est ensureTips (au SAVE)
  // qui normalise state.tips pour la sérialisation — jamais de crash en jeu.
  assert.equal(state.tips, undefined, 'makeTips ne doit PAS muter le state (lecture seule)');
  ensureTips(state); // la normalisation (créée pour la sérialisation)
  assert.deepEqual(state.tips, { seen: [] });
  state.sim.infra.services = [{ kind: 'fueling' }];
  tips.refresh();
  assert.equal(fired.length, 1, 'la normalisation doit laisser la mécanique marcher');
  assert.deepEqual(state.tips.seen, ['first-service']);
});

ok('tips: ensureTips FILTRE les ids inconnus (robustesse d\'un save altéré)', () => {
  const state = freshState();
  state.tips.seen = ['first-service', 'id-inventé', 'objective'];
  ensureTips(state);
  assert.deepEqual(state.tips.seen, ['first-service', 'objective']);
});

ok('tips: persistance RÉSTABLE après reload (state.tips.seen pré-rempli)', () => {
  const state = freshState();
  state.tips.seen = ['first-service', 'first-flight'];
  const fired = [];
  const tips = makeTips(state, { toast: (t, o) => fired.push(o && o.title) });
  state.sim.infra.services = [{ kind: 'hotel' }]; // déjà vue → rien
  state.sim.economy.flightsLanded = 2; // déjà vu → rien
  tips.refresh();
  assert.equal(fired.length, 0, 'les astuces déjà vues ont été RE-émises après reload');
  state.sim.economy.money = 1000; // treasury NON vue → émise
  tips.refresh();
  assert.deepEqual(fired, [TIPS.find((t) => t.id === 'treasury').title], 'seule l\'astuce non vue doit être émise');
});

ok('tips: menu (pas de sim) = refresh no-op propre (jamais de crash)', () => {
  const state = { tips: { seen: [] } }; // pas de sim (écran menu)
  const tips = makeTips(state, { toast: () => {} });
  tips.refresh(); // pas d'exception, rien n'est émis
  assert.deepEqual(state.tips.seen, []);
});

console.log(`\nt4 (theme+icons+tips) : ${passed} assertions/ok`);
