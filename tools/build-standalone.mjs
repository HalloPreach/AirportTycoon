// T4 (t_eb78478e) : générateur de la VERSION AUTONOME (release standalone).
//
// Produit un artefact unique JOUABLE hors-ligne à partir des modules ESM du
// projet, SANS outil de build externe (zéro dépendance npm — Node stdlib
// uniquement) :
//
//   dist/standalone.html  — index.html avec le <script type="module"> remplacé
//                           par <script src="./standalone.js"> (script classique)
//   dist/standalone.js    — TOUT le graphe de modules ESM inliné (IIFE,
//                           ordre topologique, 0 appel réseau à l'exécution)
//   dist/build-report.json — manifeste de build (modules, taille, horodatage)
//
// Principes (contrats du projet) :
//   • Chaque module devient une IIFE `(function (__exports) {...})(__reg[id])`
//     dont l'objet d'exports est enregistré AVANT exécution (registre `__reg`).
//   • Cycles : le graphe réel EN CONTIENT UN (unlocks → aircraft → infra →
//     unlocks — détecté par SCC de Tarjan, vérifié pas supposé). L'ordre est
//     topologique sur le GRAPE CONDENSÉ (SCC) ; dans une SCC, l'ordre est
//     déterministe (alphabétique) et les ARÊTES RÉTROGRADEES (import d'un
//     module du même SCC placé plus tard) sont traitées par SUBSTITUTION des
//     sites d'usage en `(__ns('<id>').name)` — lecture LIVE au moment de
//     l'APPEL (tout le registre est peuplé), jamais à l'init. GARDIEN : un
//     usage du binding rétrograde en NIVEAU SUPÉRIEUR (hors fonctions) du
//     module ABORTE le build avec un message de refactorisation précis.
//   • `import { a, b as c } from 'REL'`  →  `const { a, b: c } = __ns('<id>')`
//   • `import('REL')` (dynamique)        →  `__dyn('<id>')` =
//     `Promise.resolve(namespace)` — l'API async (await, .then, .catch,
//     Promise.all) est préservée (c'est le cas d'usage sim.mjs / build-tool).
//   • `export { x } from 'REL'` (ré-export) → getter LIVE sur __exports
//     (toujours juste, même si le module source est chargé plus tard).
//   • `export const/function/class X` → déclaration locale + enregistrement
//     `__exports.X = X` EN FIN de module (les déclarations multi-lignes sont
//     donc gérées sans parsing).
//   • STRICT : toute ligne `import`/`export` non reconnue = build ABORTÉ
//     (message précis) — jamais de transform silencieux.
//   • Après génération : vérification SYNTAXIQUE (vm.Script, sans exécution)
//     + absence de syntaxe ESM résiduelle + manifeste.
//
// Usage : node tools/build-standalone.mjs   (code retour 0 = OK, 1 = échec)
// (appelé par `npm run build`)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, posix } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');

const fail = (msg) => {
  console.error(`BUILD ÉCHEC : ${msg}`);
  process.exit(1);
};

// --- 1. Entrée : le <script type="module"> de index.html ---------------------
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const m = indexHtml.match(/<script\s+type="module"\s+src="([^"]+)">\s*<\/script>/);
if (!m) fail('aucun <script type="module"> trouvé dans index.html');
const ENTRY = posix.normalize(m[1]); // './src/main.mjs'
if (!existsSync(join(ROOT, ENTRY))) fail(`entrée inexistante : ${ENTRY}`);

// --- 2. Graphe des modules (BFS) ---------------------------------------------
// Formes ESM du projet (audit 2026-10-14) :
//   • imports nommés STATIQUES (une seule forme d'import)
//   • imports DYNAMIQUES `import('REL')` (5 sites : sim.mjs ×3, build-tool ×2)
//   • ré-exports `export { x } from 'REL'` (2 : economy, infra)
//   • exports de déclaration (const/function/class)
//   • AUCUN : import par effet de side-effect, default, namespace, multi-ligne.
const RE_STATIC_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*;?\s*(?:\/\/.*)?$/;
const RE_REEXPORT = /^export\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*;?\s*(?:\/\/.*)?$/;
const RE_EXPORT_LIST = /^export\s*\{([^}]*)\}\s*;?\s*$/;
const RE_EXPORT_DEFAULT = /^export\s+default\b/;
const RE_EXPORT_DECL = /^export\s+(async\s+)?(function\s*\*?|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/;
const RE_DYNAMIC = /import\s*\(\s*(['"])([^'"]+)\2\s*\)/g;

function specifiersOf(file, text) {
  const specs = new Set();
  for (const line of text.split('\n')) {
    const t = line.trim();
    let mm = t.match(RE_STATIC_IMPORT) || t.match(RE_REEXPORT);
    if (mm) { specs.add(mm[3]); continue; }
    for (const dm of t.matchAll(RE_DYNAMIC)) specs.add(dm[2]);
  }
  return [...specs];
}

function resolveSpec(fromFile, spec) {
  if (!/^\.\.?\//.test(spec)) fail(`spécifieur non relatif (hors périmètre bundle) : "${spec}" dans ${fromFile}`);
  const abs = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  if (!existsSync(join(ROOT, abs))) fail(`module inconnu : ${spec} (vu de ${fromFile})`);
  return abs;
}

const graph = new Map(); // posixRelPath → [deps posixRelPath]
{
  const queue = [ENTRY];
  const seen = new Set([ENTRY]);
  while (queue.length) {
    const f = queue.shift();
    const deps = specifiersOf(f, readFileSync(join(ROOT, f), 'utf8'))
      .map((s) => resolveSpec(f, s));
    graph.set(f, deps);
    for (const d of deps) if (!seen.has(d)) { seen.add(d); queue.push(d); }
  }
}
const modules = [...graph.keys()];

// --- 3. Ordre d'exécution : SCC (Tarjan) + topologique sur le condensé ------
// Contrainte : un module s'exécute APRÈS ses dépendances. Les SCC (composantes
// fortement connexes) forment des CYCLES : elles s'exécutent « en bloc » après
// leurs dépendances hors-SCC ; à l'intérieur, l'ordre est déterministe
// (alphabétique) — les ARÊTES RÉTROGRADEES (import d'un module du même SCC
// placé plus tard) sont ensuite traitées par substitution LIVE (section 4).
function tarjan() {
  let idx = 0;
  const index = new Map(), low = new Map(), onStack = new Set();
  const stack = [];
  const sccs = [];
  const strong = (v) => {
    index.set(v, idx); low.set(v, idx); idx += 1;
    stack.push(v); onStack.add(v);
    for (const w of graph.get(v) || []) {
      if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      for (;;) {
        const w = stack.pop(); onStack.delete(w); comp.push(w);
        if (w === v) break;
      }
      sccs.push(comp);
    }
  };
  for (const f of modules) if (!index.has(f)) strong(f);
  return sccs;
}
const sccs = tarjan();
const sccOf = new Map();
for (const [i, comp] of sccs.entries()) for (const f of comp) sccOf.set(f, i);
// Condensé : SCC A dépend de SCC B si un module de A importe un module de B.
// Une SCC s'exécute APRÈS toutes celles dont elle dépend.
const sccDeps = new Map(sccs.map((_, i) => [i, new Set()]));
for (const f of modules) for (const d of graph.get(f)) {
  const A = sccOf.get(f), B = sccOf.get(d);
  if (A !== B) sccDeps.get(A).add(B);
}
const sccInDeg = new Map([...sccDeps].map(([k, s]) => [k, s.size]));
const sccOrder = [];
{
  const ready = [...sccDeps.keys()].filter((i) => sccInDeg.get(i) === 0);
  while (ready.length) {
    const i = ready.shift();
    sccOrder.push(i);
    for (const [g, s] of sccDeps) if (s.has(i)) {
      s.delete(i);
      sccInDeg.set(g, s.size);
      if (s.size === 0) ready.push(g);
    }
  }
}
if (sccOrder.length !== sccs.length) fail('graphe condensé cyclique (inattendu)');
// Ordre final : SCC dans l'ordre topologique ; modules d'une SCC en
// alphabétique (déterministe — build re-productible à l'identique).
const order = [];
for (const i of sccOrder) order.push(...[...sccs[i]].sort());
const posOf = new Map(order.map((f, i) => [f, i]));
// Arêtes rétrogrades : import M→D dont D est placé APRÈS M (même SCC).
const backEdges = new Map(); // module → [{ binding, alias, dep, local }]
for (const f of modules) {
  const text = readFileSync(join(ROOT, f), 'utf8');
  const list = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    const mm = t.match(RE_STATIC_IMPORT);
    if (!mm) continue;
    const dep = resolveSpec(f, mm[3]);
    if (posOf.get(dep) < posOf.get(f)) continue; // dépendance avant → pas rétrograde
    for (const n of mm[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const p = n.split(/\s+as\s+/);
      list.push({
        binding: p[0].trim(),
        local: p.length === 2 ? p[1].trim() : p[0].trim(),
        dep,
      });
    }
  }
  if (list.length) backEdges.set(f, list);
}
const sccInfo = sccs
  .map((c) => (c.length > 1 ? `CYCLE ${c.join(' → ')} → ${c[0]}` : null))
  .filter(Boolean);
if (sccInfo.length) {
  console.log('Build : SCC fortement connexe(s) traité(s) par substitution live :');
  for (const s of sccInfo) console.log('  ' + s);
}
// (chemins posix : f est déjà normalisé en '/')
const ID = (f) => 'm_' + f.replace(/\.mjs$/, '').replace(/\//g, '_');

// --- 4. Transform par module --------------------------------------------------
// Utilitaires de substitution sûre (strings/comments neutralisés).
function neutralize(line) {
  // '…', "…", `…` et les commentaires // → espaces (positions stables : la
  // longueur est conservée pour ne pas décaler les index de remplacement).
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const close = ch;
      const start = i;
      i++;
      while (i < line.length && line[i] !== close) { if (line[i] === '\\') i++; i++; }
      out += line.slice(start, i + 1).replace(/[^\s]/g, ' ');
    } else out += ch;
  }
  const s = out;
  const c = s.indexOf('//');
  return c === -1 ? s : s.slice(0, c) + ' '.repeat(line.length - c);
}
// Niveau supérieur (hors fonctions) : lignes à indent 0 + la suite des
// déclarations multi-lignes qui s'ouvrent à indent 0 (tables littérales).
// Les lignes import/export sont EXCLUES (l'import est l'origine du binding,
// le ré-export est émis en getter live — ce ne sont pas des USAGES).
function topLevelUsage(text, ident) {
  const lines = text.split('\n');
  const re = new RegExp(`(?<![A-Za-z0-9_$])${ident}(?![A-Za-z0-9_$])`);
  let depth = 0;
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const clean = neutralize(line);
    if (/^\s*(import\b|export\b)/.test(line)) continue;
    if (depth > 0) {
      if (re.test(clean)) hits.push(i + 1);
      for (const ch of clean) { if (ch === '{' || ch === '(') depth++; if (ch === '}' || ch === ')') depth--; }
    } else if (!/^\s/.test(line)) {
      if (re.test(clean)) hits.push(i + 1);
      for (const ch of clean) { if (ch === '{' || ch === '(') depth++; if (ch === '}' || ch === ')') depth--; }
    }
    depth = Math.max(0, depth);
  }
  return hits;
}
// Substitution d'USAGE (hors strings/comments) d'un identifiant en
// `(__ns('<id>').name)` — lecture live (juste au moment de l'appel).
function substituteUsages(text, ident, depId, file) {
  const rep = `(__ns('${depId}').${ident})`;
  const lines = text.split('\n');
  let replaced = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const clean = neutralize(line);
    const re = new RegExp(`(?<![A-Za-z0-9_$])${ident}(?![A-Za-z0-9_$])`, 'g');
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(clean)) !== null) {
      const at = m.index;
      const before = line.slice(0, at).trimEnd();
      const after = line.slice(at + ident.length).trimStart();
      if (before.endsWith('.')) {
        fail(`substitution impossible : "${ident}" en ACCÈS MEMBRE dans ${file} (ligne ${li + 1})`);
      }
      if (/[{,]\s*$/.test(before) && after.startsWith(':')) {
        fail(`substitution impossible : "${ident}" utilisé comme CLÉ d'objet dans ${file} (ligne ${li + 1}) — refactoriser (renommer le local ou l'objet)`);
      }
      out += line.slice(last, at) + rep;
      last = at + ident.length;
      replaced++;
    }
    out += line.slice(last);
    lines[li] = out;
  }
  return { text: lines.join('\n'), replaced };
}

function transform(file, text) {
  let body = text;
  // (1) Bindings rétrogrades : SUBSTITUTION des sites d'usage en accès live
  //     `(__ns('<id>').name)` — la lecture n'a lieu qu'au moment de l'APPEL
  //     (tout le registre est peuplé), jamais à l'init.
  for (const b of backEdges.get(file) || []) {
    const hits = topLevelUsage(body, b.local);
    if (hits.length) fail(`cycle : le binding rétrograde "${b.local}" (de ${b.dep}) est utilisé en NIVEAU SUPÉRIEUR de ${file} (lignes ${hits.join(', ')}) — déplacer l'appel dans une fonction (la substitution live ne couvre que les usages différés)`);
    const r = substituteUsages(body, b.local, ID(b.dep), file);
    body = r.text;
    if (r.replaced === 0) fail(`cycle : le binding rétrograde "${b.local}" n'a AUCUN site d'usage dans ${file} — import mort ou transform inattendu`);
  }
  // (2) Transform ligne à ligne (le corps substitué est re-scané).
  const lines = body.split('\n');
  const out = [];
  const declExports = []; // identifiants des `export const/function/class X`
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    // Un import DYNAMIQUE est une EXPRESSION (peut être indented, en
    // argument, en début de ligne — ex. `Promise.all([ import('./x.mjs'),
    // … ])`) : substitution `__dyn('<id>')` partout sur la ligne. Une ligne
    // qui DÉBUTE par `import(` est un import dynamique en position de
    // déclaration ; les `import {` / `export` sont les formes ESM ci-dessous.
    if (t.startsWith('import') && /^import\s*\(/.test(t)) {
      out.push(raw.replace(RE_DYNAMIC, (_all, _q, spec) => `__dyn('${ID(resolveSpec(file, spec))}')`));
      continue;
    }
    if (!t.startsWith('import') && !t.startsWith('export')) {
      // Import DYNAMIQUE éventuellement à l'intérieur d'une ligne de code :
      out.push(raw.replace(RE_DYNAMIC, (_all, _q, spec) => `__dyn('${ID(resolveSpec(file, spec))}')`));
      continue;
    }
    let mm = t.match(RE_STATIC_IMPORT);
    if (mm) {
      const dep = resolveSpec(file, mm[3]);
      const names = mm[1].split(',').map((s) => s.trim()).filter(Boolean).map((n) => {
        const p = n.split(/\s+as\s+/);
        return p.length === 2 ? `${p[0].trim()}: ${p[1].trim()}` : n;
      });
      if (posOf.get(dep) > posOf.get(file)) {
        // Ligne d'import rétrograde : bindings SUBSTITUÉS ci-dessus — la
        // ligne est écartée (remplacée par une trace commentée).
        out.push(`// import rétrograde de ${dep} substitué en accès live (${names.join(', ')})`);
      } else {
        out.push(`const { ${names.join(', ')} } = __ns('${ID(dep)}');`);
      }
      continue;
    }
    mm = t.match(RE_REEXPORT);
    if (mm) {
      const dep = resolveSpec(file, mm[3]);
      for (const n of mm[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        const p = n.split(/\s+as\s+/);
        const src = p[0].trim(), loc = p.length === 2 ? p[1].trim() : src;
        out.push(`Object.defineProperty(__exports, '${loc}', { get() { return __ns('${ID(dep)}').${src}; }, enumerable: true });`);
      }
      continue;
    }
    mm = t.match(RE_EXPORT_LIST);
    if (mm) {
      for (const n of mm[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        const p = n.split(/\s+as\s+/);
        const loc = p.length === 2 ? p[1].trim() : p[0].trim();
        const src = p[0].trim();
        out.push(`__exports.${loc} = ${src};`);
      }
      continue;
    }
    if (RE_EXPORT_DEFAULT.test(t)) {
      out.push(`__exports.default = ${t.replace(/^export\s+default\s*/, '')}`);
      continue;
    }
    mm = t.match(RE_EXPORT_DECL);
    if (mm) {
      declExports.push(mm[3]);
      out.push(raw.replace(/^(\s*)export\s+/, '$1'));
      continue;
    }
    fail(`forme ESM non reconnue (${file}:${i + 1}) : ${t.slice(0, 80)}`);
  }
  for (const id of declExports) out.push(`__exports.${id} = ${id};`);
  return out.join('\n');
}

// --- 5. Émission du bundle ----------------------------------------------------
const parts = [];
parts.push(`/* Airport Tycoon — VERSION AUTONOME (T4, t_eb78478e) */
/* Généré le ${new Date().toISOString()} par tools/build-standalone.mjs — NE PAS ÉDITER À LA MAIN. */
/* ${modules.length} modules ESM inlinés (ordre topologique, cycles traités par substitution live), 0 dépendance, 0 appel réseau : jouable hors-ligne (file:// ou serveur statique). */
(() => {
'use strict';
const __reg = { ${modules.map((f) => `'${ID(f)}': {}`).join(', ')} };
function __ns(id) { return __reg[id]; }
function __dyn(id) { return Promise.resolve(__reg[id]); }
`);
for (const f of order) {
  parts.push(`/* --- module ${f} --- */\n(function (__exports) {\n${transform(f, readFileSync(join(ROOT, f), 'utf8'))}\n})(__reg['${ID(f)}']);\n`);
}
parts.push(`/* --- fin du graphe (entrée : ${ENTRY}) --- */\n})();`);
const bundleJs = parts.join('\n');

// --- 6. Vérifications post-build ----------------------------------------------
// (a) syntaxe valide (compilation SANS exécution — le DOM n'existe pas ici)
try { new vm.Script(bundleJs, { filename: 'standalone.js' }); }
catch (e) { fail(`bundle incompilable : ${e.message}`); }
// (b) aucune syntaxe ESM résiduelle en tête de ligne
const leftover = bundleJs.split('\n').filter((l) => /^import\s/.test(l.trim()) || /^export\s/.test(l.trim()));
if (leftover.length) fail(`${leftover.length} ligne(s) ESM résiduelle(s), ex. : ${leftover[0].trim().slice(0, 80)}`);
// (c) hors-ligne : ni fetch, ni XHR, ni Worker dans le bundle
for (const pat of [/\bfetch\s*\(/, /XMLHttpRequest/, /new Worker\(/]) {
  if (pat.test(bundleJs)) fail(`appel réseau inattendu dans le bundle (${pat})`);
}

// --- 7. Émission dist/ ----------------------------------------------------------
mkdirSync(DIST, { recursive: true });
const standaloneHtml = indexHtml.replace(
  /<script\s+type="module"\s+src="[^"]+">\s*<\/script>/,
  '  <script src="./standalone.js"></script>',
);
writeFileSync(join(DIST, 'standalone.js'), bundleJs);
writeFileSync(join(DIST, 'standalone.html'), standaloneHtml);
const report = {
  generatedAt: new Date().toISOString(),
  entry: ENTRY,
  moduleCount: modules.length,
  modules,
  cycles: sccInfo,
  backEdges: Object.fromEntries(
    [...backEdges.entries()].map(([k, v]) => [k, v.map((b) => `${b.local} ← ${b.dep}`)]),
  ),
  jsBytes: Buffer.byteLength(bundleJs),
  htmlBytes: Buffer.byteLength(standaloneHtml),
};
writeFileSync(join(DIST, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');

console.log(`BUILD OK : ${modules.length} modules inlinés → dist/standalone.{html,js}`);
console.log(`  standalone.js  ${report.jsBytes} o`);
console.log(`  standalone.html ${report.htmlBytes} o`);
console.log(`  (preuve d'exécution : node qa/t4-standalone-cdp.mjs — CDP + captures horodatées)`);
