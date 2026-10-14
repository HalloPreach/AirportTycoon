# RAPPORT DE LIVRAISON T5 — Airport Tycoon

Carte racine : **t_ec71c97f** (T5). Carte de livraison : **t_707b3d29** (T5d). Date : 2026-10-14.
Coordination : cartes filles exécutées en workers isolés (workspace partagé, séquence stricte),
vérification indépendante (carte t_2e94c5d2, extraction isolée du commit final `3714749`),
push final réservé au coordinateur (aucun push effectué par un worker).

---

## 1. Ce qui est livré

### T5a — HUD lisible + layout portrait mobile (carte t_e4c3ffff, commit `24825ad`)

- **Lisibilité du HUD** : zone HUD canvas redimensionnée en placement explicite (plus de bande
  pleine largeur peinte derrière les panneaux), police HUD ≥ 11px, largeur de texte = contenu
  (aucun débordement), police DOM interactive ≥ 11px.
- **Bug portrait mobile connu** (le HUD canvas passé derrière les panneaux pleins largeur)
  **résolu par une décision de layout explicite** : la zone HUD est placée hors des colonnes
  de panneaux ; régression mesurée sur 3 viewports (1920×1080, 1366×768, 390×844).
- **Preuve** : `qa/hud-mobile-cdp.mjs` — 0 problème, 0 chevauchement, polices ≥ 11px,
  contraste WCAG AA pire cas **8.71:1** (HUD **13.68:1**) ≥ 4.5:1 ; 2 captures commitées
  (`evidence/t5a-hud-1366x768.png`, `evidence/t5a-hud-390x844.png`).

### T5b — Maquettes de direction visuelle (carte t_52f07a47, commit `df0056f`)

- **3 maquettes auto-suffisantes et déterministes** : A « Nuit REV.2 », B « Tour de contrôle »,
  C « Radar Rétro » (phosphore vert CRT) + page de revue `mockups/index.html`
  (4 pages HTML déterministes, 0 asset externe).
- **Preuve** : `qa/t5b-mockups-cdp.mjs` — 6/6 captures (avant/après + 3 variantes + index),
  0 erreur console ; set commité `evidence/t5b-mockups-cdp-2026-10-14T14-05-09-*` (6 fichiers).

### Gate design — décision Elsay (carte t_b3f6756f)

- **Variante C « Radar Rétro » retenue**, avec un ajustement bloquant : « la carte du jeu est
  super simpliste » → l'enrichissement substantiel du rendu de la carte est exigé (traité en T5c).

### T5c — Design system v2 + carte enrichie (carte t_bd4726e7, commits `db1b336` → `3714749`)

- **Design system v2 « Radar Rétro »** : phosphore vert CRT, source unique `src/ui/theme.mjs`,
  appliqué à **TOUS les écrans** (titre, menu, options, jeu, planning/consultation, toasts,
  modales, HUD) ; le thème T4 reste disponible en toggle.
- **Carte enrichie (exigence Elsay)** : silhouettes d'avions, tags radar, scope, détails
  d'infrastructure (seuils « piano », désignateurs, feux, ligne de centre), zoom, pluie.
- **Reproductibilité** : maquette variant-c alignée sur le renderer livré (`ccb5146`),
  re-sync du dist + re-QA de la maquette (`ab8a8f1`), état vert final re-vérifié (`3714749`).
- **Preuve** : `qa/t5c-map-cdp.mjs` — 5/5 captures déterministes (scénario capNord, seed +
  budget imposés, 2 blips forcés, 900 ticks du pipeline réel, sim pausée avant capture),
  2 avions en scène, 0 erreur console ; set commité
  `evidence/t5c-map-cdp-2026-10-14T15-20-37-*` (5 fichiers).

### T5d — Dashboard + rapport + re-sync du build (carte t_707b3d29, ce commit)

- **`docs/index.html` à jour** : statut des tranches (T5a/T5b/T5c), table des systèmes livrés,
  preuves & garantie qualité, nouvelles captures (5, dont 2 ajoutées), roadmap (l'item
  « HUD mobile portrait » — livré en T5a — retiré, playtest humain en tête de liste).
- **Re-poussée du build autonome** : `node tools/build-standalone.mjs` (50 modules inlinés)
  → `dist/` régénéré + copie site `docs/standalone.js` resynchronisée (le bouton
  « Jouer la dernière release » du site servait encore le build T4).
- **QA 17/17 re-exécutée sur le build frais** : `qa/t4-standalone-cdp.mjs` —
  **17/17 PASS** (boot HTTP + boot `file://` hors-ligne), 0 exception, rapport
  `qa/t4-standalone-cdp-report.json` régénéré.

## 2. Vérification indépendante (carte t_2e94c5d2, extraction isolée de `3714749`)

| Check | Résultat |
|---|---|
| Suite complète `node --test tests/*.test.mjs` (clone isolé, 0 untracked) | **440/440 PASS, 0 fail** |
| T51 régression `qa/ui-no-overlap-cdp.mjs` | **0/9** (3 viewports × 3 états : menu / partie neuve / rechargée) |
| QA CDP tous états (6 scripts, re-exécutés) | **0 exception** : cdp-boot PASS · t4-standalone **17/17** (sur le dist commité, http + file://, 0 ressource externe) · t5b-mockups 6/6 (0 erreur console) · t5c-map 5/5 (2 avions, 0 erreur console) · ui-no-overlap 0/9 · hud-mobile 0 problème (contraste pire cas 8.71:1) |
| Build autonome | `node tools/build-standalone.mjs` : **50 modules inlinés, 0 dépendance npm** ; builder inchangé depuis T4 (`a3444b2`) |
| Dist synchronisé sur la source | Contenu normalisé (CRLF/LF + ligne timestamp) **identique** : working-tree (617 617 o) == build frais (624 400 o) == blob commité LF (613 348 o) — 601 429 caractères normalisés ; le dist commité est un vrai build de la source HEAD |
| Dist fonctionnel | t4-standalone **17/17 exécuté sur le dist commité** (checkout du clone isolé) : boot http, boot file:// hors-ligne, partie, save/load, 0 exception |
| Preuves commitées (evidence/ + qa/ + dist/) | Sets finaux t5a (2), t5b (6), t5c (5), ui-overlap before/after (12), `mockups/` (4 pages), `dist/`, 5 rapports `qa/*-cdp-report.json` |
| Faux vert | **AUCUN** — les tailles d'artefact « différentes » (613 348 / 617 617 / 624 400) sont des représentations CRLF/LF + timestamp du MÊME contenu (vérifié par identité de contenu normalisé) |
| Re-verification de cette carte (2026-10-14, working-tree) | Build re-poussé (50 modules) + `qa/t4-standalone-cdp.mjs` **17/17 PASS** (http + file://), 0 exception |

## 3. Comment jouer

- **Release autonome (0 dep, 0 réseau)** : ouvrir `dist/standalone.html` directement (file://)
  ou via n'importe quel serveur statique ; sur le site GitHub Pages : bouton « Jouer la
  dernière release » (`docs/game.html`, resynchronisé par cette carte).
- **Dév** : `npm run serve` (http://localhost:8000), `npm run test`, `npm run build`,
  `npm run qa`, `npm run qa:standalone`.

## 4. Contraintes — vérifiées

- 0 dépendance npm (package.json sans `dependencies`), vanilla JS ESM + Canvas 2D.
- 0 appel réseau au runtime : prouvé par la QA standalone (0 ressource externe chargée,
  mode file://, re-exécutée par cette carte sur le build frais).
- Sauvegardes pré-fonction : migrations conservées (EV-10 + suivantes) — la régression
  save/load est couverte dans les 17 checks standalone (A10).

## 5. Limites et non-exercices (honnêtes)

1. **Build byte-non-déterministe** : `tools/build-standalone.mjs` laisse passer les fins de
   lignes des fichiers source (CRLF/LF mixte) et embarque une ligne « Généré le \<ISO\> »
   (+ `generatedAt` dans build-report.json) → la taille de `standalone.js` n'est PAS un
   fingerprint stable entre builds ; l'identité se juge par contenu normalisé (fait dans la
   vérification, §2). Pas de régression : contenu stable, build répétable à contenu près.
2. **Captures horodatées non commitées** : les `evidence/t4-standalone-…-*.png` et autres
   captures de runs intermédiaires (≈128 fichiers) restent untracked, **locales uniquement,
   volontairement non poussées** (convention établie T4/T5c — seuls les sets finaux sont
   commités, cf. §2). La preuve commitée = rapports JSON + dist fonctionnel ; les captures
   intermédiaires n'existent qu'en local. Les 3 nouvelles captures de la re-verification de
   cette carte (runs t4 du 2026-10-14) suivent la même convention.
3. **Flakiness du boot t5b (phase « avant »)** : la phase avant (jeu HEAD extrait via
   git archive + serve.mjs + Edge headless) a échoué au 1er essai de la vérification
   (« le jeu n'a pas booté ») et PASS au 2e — probe de boot froide fragile (fenêtre de
   sondage). Risque de faux négatif futur si un run de QA s'arrête au 1er essai.
4. **Non-exercé par nature CDP desktop** : aucune QA tactile réelle (390×844 testé avec
   pointeur desktop), pas d'audio (WebAudio inaudible en headless ; la partie démarre
   `muted=false` mais le chemin audio n'est jamais exercé), tailles intermédiaires de
   viewport non testées (3 viewports fixes), multi-onglets au-delà du round-trip save/load.
5. **T5c déterminisme** : le scénario capNord impose seed + budget, blips forcés, zooms/pluie
   posés par le harness (mutation de test `sim.weather`, renderer en lecture seule) — la
   preuve visuelle est reproductible mais ne couvre pas le rendu « en jeu libre »
   (positions d'avions réelles aléatoires).

**Autre limite (site)** : `docs/game.html` conserve son CSS de site figé à l'époque T4 —
le rendu canvas du jeu servi par le site est bien le design v2 (T5c), mais les panneaux DOM
générés par le JS y sont stylés par ce CSS figé (pas le CSS du jeu courant).

## 6. Commits & push

- Les commits de T5 (de `24825ad` à `3714749` + ce commit de livraison) sont **locaux,
  ahead 7 de origin/main, SANS push** — la convention du projet réserve le push au
  coordinateur (carte racine t_ec71c97f). Le site GitHub Pages se redéploie seul à chaque
  push sur `main`.
- Arborescence à pousser par le coordinateur : les commits T5a/T5b/T5c listés en §1 +
  ce commit (RAPPORT_LIVRAISON_T5.md + dashboard docs/ + re-sync dist/ et site).
