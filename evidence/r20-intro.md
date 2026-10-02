# R20 (t_55701859) — Preuve : introduction du premier cycle + boutons souris

## Tâche
Introduction courte et désactivable du PREMIER CYCLE (accepter un vol → observer
sa porte → consulter les finances → comprendre un goulot → investir si utile)
et boutons utilisables à la souris pour nouvelle partie, pause, vitesse,
sauvegarde et reprise. Les raccourcis complètent ces commandes.

## Résultat
- **Carte d'intro** (src/ui/intro.mjs) : 5 étapes courtes, affichée en jeu tant
  que l'intro n'est ni terminée (« Terminer l'intro ») ni passée
  (« Passer l'intro »). La progression vit sur `state.intro`
  (`{ step: 0, done: false, skipped: false }`), donc SÉRIALISÉE : elle
  REPREND après sauvegarde. Aucune récompense — l'intro ne touche aucune règle
  de la sim (les étapes sont des pointeurs vers les panneaux existants).
- **Boutons souris** : menu = « Nouvelle partie (N) » + « Reprendre la
  sauvegarde (R) » (ce dernier affiché QUE si une sauvegarde existe) ;
  toolbar = « Pause (P) », « Vitesse (F) », « Sauvegarder (S) »,
  « Charger la sauvegarde (L) ». Le label vitesse suit `state.speedIndex`
  (x1/x2/x4) et la classe active suit `state.paused` (refresh par frame).
  Les touches N/R/P/F/S/L restent les raccourcis qui COMPLÈTENT la souris.

## Fichiers
- `src/ui/intro.mjs` (nouveau) — la carte, DOM factice testable
- `src/core/new-game.mjs` — `state.intro` initialisé (nouvelle partie = étape 1)
- `src/main.mjs` — câblage intro + boutons (menu via renderer, toolbar via
  build-tool) + `resumeFromSave` borné au menu + `__game.intro` exposé (CDP)
- `src/ui/renderer.mjs` — boutons du menu (DOM créé une fois, idempotent par
  frame ; masqué au retour au menu)
- `src/ui/build-tool.mjs` — groupe `controls` optionnel + `refreshControls()`
- `src/ui/save-panel.mjs` — commentaire du champ intro (le load Object.assign
  le restaure, même pattern que planningAuto)
- `index.html` — CSS `.menu-btns` (haut, centré) + `.intro` (bas gauche)
- `tests/r20-intro.test.mjs` (nouveau, 8 tests) + `qa/_r20-probe.mjs`
  (nouveau, 18 checks CDP) + `evidence/r20-intro-cdp.png`

## Preuve
1. **Node** : `tests/r20-intro.test.mjs` 8/8 — nouvelle partie (étape 1, carte
   en jeu, masquée au menu) ; bornage Suivant/Précédent 0..4 ; done/skipped
   masquent la carte ET survivent au save/load ; sauvegarde sans champ intro ne
   RESETTE PAS la progression courante ; étape corrompue bornée ; terminer/
   passer ne touche aucune règle sim (passengers/economy/aircraft intacts) ;
   aller-retour serialize/deserialize de state.intro.
2. **Suite** : `npm run test` = **209/209** (aucune assertion enlevée).
3. **Navigateur (CDP, Edge headless)** : `node qa/_r20-probe.mjs` = **18/18
   PASS** — menu : barre de boutons présente, « Reprendre » masqué sans
   sauvegarde, clic souris démarre le jeu ; jeu : carte 1/5 visible,
   Suivant → étape 2 ; sauvegarde JSON contient `intro:{step:1}` et la reprise
   REPREND l'étape ; « Terminer » en 5/5 (done=true, carte masquée, et le
   done SURVIT au rechargement) ; « Passer » (skipped) ; toolbar : 4 boutons
   de commande présents, clic Pause gèle le temps (label « Reprendre (P) »,
   classe active), clic Vitesse x1→x2→x4→x1 ; aucune exception page ;
   capture `evidence/r20-intro-cdp.png`.
4. **PORTE régression** : `node qa/cdp-boot.mjs` = **18/18 PASS** avec ces
   changements (vols complets, finances, sauvegarde/rechargement, menu) — la
   capture `evidence/jeu-en-cours.png` est régénérée par cette porte.

## Compatibilité
- Champ additif sur le state : une sauvegarde ANCIENNE (sans `intro`) charge
  sans bump de version — la progression courante de la session est conservée
  (jamais re-supprimée par Object.assign, pattern `state.sim`/R07) ; le test
  Node « sauvegarde sans champ intro » le verrouille.
- `makeBuildTool` : `controls` optionnel (défaut `[]`) — les appels existants
  (tests) passent sans changement.
- `makeRenderer` : `onMenuCommands` optionnel (défaut `null`) — pas d'impact.

## Limitation
- La carte d'intro ne VÉRIFIE pas que le joueur a réellement accepté un vol
  (ponytail : le brief demande une intro courte, désactivable, pas un
  tutoriel à conditions de succès) ; elle pointe vers les panneaux existants
  et la sim décide.
- Le premier cycle COMPLET observable (recevoir → comprendre → choisir) reste
  la validation du jalon G2 (t_93b886f9, enfant de cette carte).

## Suite
- G2 (t_93b886f9) : validation navigateur du premier cycle complet
  (observations CDP, captures, valeurs affichées = valeurs sim).
