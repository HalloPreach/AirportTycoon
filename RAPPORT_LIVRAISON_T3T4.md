# RAPPORT DE LIVRAISON T3+T4 — Airport Tycoon

Carte racine : **t_e79021d4** (coordination). Date : 2026-10-14 (coût ≈ 60 445 cr).
Coordination : cartes filles exécutées en worker isolés (workspace partagé, séquence stricte),
vérification indépendante du coordinateur à la livraison (ci-dessous, §2), push final par le
coordinateur sur cette même carte.

---

## 1. Ce qui est livré

### T3 — 5 nouveaux systèmes de jeu (chaque livraison = tests node --test + preuve CDP 0 exception)

| Carte | Commit | Contenu | Preuve |
|---|---|---|---|
| t_9b665a8b | `f72351b` | Météo : 5 états (clair/nuageux/pluie/neige/orage) à effets MESURABLES (retard +40s par vol, visibilité, trafic pax), cycle 180s, save migration EV-10, 6 tests | qa/t3-meteo-cdp.mjs : 9/9 checks PASS + 5 captures |
| t_4c9baadc | `7eb0339` | Événements dynamiques : TABLE EVENTS (conférence/pic tourisme/grève 20s), tirages aléatoires, save migration, 6 tests | qa/t3-events-cdp.mjs : 9/9 + 3 captures |
| t_88aee6d5 | `b71747d` | Contenu statique : 3 bâtiments services (sécurité/boutique/salon VIP) + 3 aéronefs cargo (Fret Horizon/Cargo Express/Freightliner 800), 11 bâtiments/7 aéronefs au total, save backward-compat, 8 tests | qa/t3-content-cdp.mjs : 10/10 + 3 captures |
| t_76744b22 | `b1b198e` | Horloge + saisons : 2400s/jour, tint jour/soir/soirée/nuit, 4 saisons (visibilité/vent/demande), save migration, 9 tests | qa/t3-clock-cdp.mjs : 10/10 + 5 captures |
| t_79820790 (stretch) | `39c7500` | Second aéroport « Cap Nord » (profils de spawn diff, 0 duplication de code), save migration, 7 tests | qa/r49-airports-cdp.mjs : 14/14 + 3 captures |

Garde-fous T3 respectés : pas de nouveaux scénarios, pas de re-balance, pas de nouveau son.

### T4 — Polish + release (carte t_eb78478e, commit `a3444b2`)

1. **Direction artistique « tour de contrôle la nuit »** : design tokens figés (src/ui/theme.mjs)
   + écran-titre animé (ciel nuit, 90 étoiles déterministes, 0 allocation/frame), HUD surfaces nuit,
   14 icônes vectorielles canvas (0 asset image), 5 tips onboarding persistés (jamais rediffusés).
2. **Version autonome** : `tools/build-standalone.mjs` (Node stdlib seul, 0 bundler) →
   `dist/standalone.html` + `standalone.js` (50 modules inlinés, cycle contracts→infra→aircraft→unlocks
   traité par SCC Tarjan + substitution live des bindings rétrogrades). **Jouable hors-ligne file://,
   0 dépendance, 0 appel réseau.**
3. 19 tests (tests/t4-theme.test.mjs).

### Ajout d'ordre utilisateur entre T3 et T4 (dans l'arbre livré)

- **T51** (t_cccfbc97, commits `0595c70` + `3ce3a40`) : correction du chevauchement des couches UI
  (« tout se superpose ») — hiérarchie z-index explicite + layout par zones + bascule menu/jeu unique.
  Régression CDP : `qa/ui-no-overlap-cdp.mjs` (3 viewports × 3 états, 0/9 chevauchements, PASS).

## 2. Vérification indépendante du coordinateur (2026-10-14, sur l'arbre final)

| Check | Résultat |
|---|---|
| Suite complète `node --test tests/*.test.mjs` | **440/440 PASS, 0 fail** |
| `npm run qa` (cdp-boot, Edge headless) | **PASS** (recettes/dépenses, sauvegarde/rechargement, 0 exception) |
| `npm run qa:standalone` (qa/t4-standalone-cdp.mjs) | **17/17 PASS** — boot http + **boot file:// HORS-LIGNE**, 0 ressource src/ (tout inline), 0 exception, menu/partie/sauvegarde-rechargement ; rapport `qa/t4-standalone-cdp-report.json` (verdict PASS, re-verification coordinateur 2026-10-14 00:29) |
| Endurance r42 re-run sur l'arbre final | `qa/r42-cdp-report.json` : **pass=true**, 1200 s de jeu (300 s réelles, 18 échantillons), 0 exception page, 0 NaN/infini, heap stable |
| Reproductibilité du build autonome | `npm run build` sur l'arbre final → dist reproductible à un **timestamp** près (build-report.json + header) ; le dist commité est cohérent avec le source final |
| Arborescence | 8 commits au-delà d'origin/main : `7eb0339 f72351b b71747d b1b198e 39c7500 0595c70 3ce3a40 a3444b2` + les 2 commits de livraison de ce rapport |

## 3. Comment jouer

- **Release autonome (0 dep, 0 réseau)** : ouvrir `dist/standalone.html` directement (file://)
  ou via n'importe quel serveur statique.
- **Dév** : `npm run serve` (http://localhost:8000), `npm run test`, `npm run build`,
  `npm run qa`, `npm run qa:standalone`.

## 4. Contraintes — vérifiées

- 0 dépendance npm (package.json sans `dependencies`), vanilla JS ESM + Canvas 2D.
- 0 appel réseau au runtime : prouvé par la QA standalone (0 ressource externe chargée, mode file://).
- Sauvegardes pré-fonction : migration EV-10 — les counters météo/horloge/événements sont
  restaurés à la relecture (aucun crash, aucun NaN), vérifié par les QA CDP (étapes « save altéré
  avant la fonctionnalité »).

## 5. Limites et non-exercices (honnêtes)

- **HUD canvas mobile** : le HUD peint DANS le canvas (Temps/Vitesse/Fonds) peut passer derrière
  les panneaux pleine largeur en portrait mobile — préexistant, **déclaré hors périmètre par T51**
  (règle de régression = éléments INTERACTIFS seulement). Signalé ici, non corrigé.
- **Warnings AudioContext** dans la console Edge headless (« not allowed to start sans gesture ») :
  comportement normal du navigateur, 0 exception page — non bloquant.
- **19 captures intermédiaires** (runs intermédiaires/échoués des QA CDP) restent **untracked,
  locales uniquement, volontairement non poussées** : pattern établi des 6 cartes (seuls les runs
  finaux sont commités). Elles ne polluent ni l'arbre distant ni la livraison.
- **Publication GitHub Pages** : hors périmètre (décision Lucas) — la release autonome est
  techniquement prête pour ça.
- T3 : **pas** de nouveaux scénarios, **pas** de re-balance, **pas** de nouveau son (garde-fous).

## 6. Traitement des résidus (décision explicite de livraison)

- Les 6 fichiers QA modifiés (4 captures r42 + `qa/r42-cdp-report.json` du re-run sur l'arbre final,
  `evidence/jeu-en-cours.png` régénéré par le dernier cdp-boot, `qa/t4-standalone-cdp-report.json`
  de la re-verification) → **commit explicite de balayage** (R50).
- Les 19 captures untracked intermédiaires → laissées locales (non destructives, non poussées),
  documentées ci-dessus.

## 7. Push

Arborescence poussée par le coordinateur vers `origin/main` après vérification (carte t_e79021d4) :
les 8 commits de livraison listés en §2 + R50 (balayage QA) + R51 (ce rapport).
