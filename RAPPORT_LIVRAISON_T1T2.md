# RAPPORT DE LIVRAISON — Airport Tycoon (T1 + T2 livrés)

Carte racine : **t_a1b30f59** — « T1 + T2 livrés » (orchestrateur/coordonnateur).
Date : **2026-10-13**. Commit testé (HEAD) : **`cab66cb`**. Remote : `origin` →
`https://github.com/HalloPreach/AirportTycoon.git` (main avant push : `44fba4d`, 0 behind /
6 ahead → fast-forward).

**Périmètre livré** :
- **Tranche 1 (game feel)** : ① audio (Web Audio synthétisé, 0 asset) · ② juice (feedback
  visuel canvas : particules/éclats, nombres $ flottants, shake, animations de panneau) ·
  ③ écran titre + menu principal (titre « Airport Tycoon », commandes Nouvelle partie /
  Reprendre (si sauvegarde) / Options / Scénarios + sélecteur de difficulté) · ④ options
  (volume / daltonien (palettes standard + Wong) / vitesse — persistantes en localStorage).
- **Tranche 2 (objectifs & difficulté)** : ① difficulté (facile/normal/difficile,
  paramètre de spawn + persistance) · ② campagne de victoire (3 contrats réussis avant
  l'échéance de saison → prime 2 500 $ payée une fois) · ③ succès + stats persistantes
  (8 succès, série sans déficit, pax/bénéfice cumulés, incidents survivus) · ④ 3 nouveaux
  scénarios rejouables (CRISE TOTALE / DÉFI DIFFICILE / DÉFI FACILE — mêmes règles, config
  explicite + objectif R22 annoncé).

> **Statut final : LIVRÉ (T1+T2 complet et vérifié).** Les 4 exigences T1 et les 4 exigences
> T2 sont toutes livrées ; la suite complète est **verte (397/397)** et la QA navigateur a
> des **preuves commitées**. Aucune limite ouverte **dans le périmètre T1+T2**. Les seules
> limites restantes sont **pré-existantes et hors périmètre** (graphisme vectoriel simple,
> traversée G7-e des 3 paliers — héritées de la livraison T_final/G7, §6). Elles ne
> conditionnent pas la livraison T1+T2.

---

## 1. Les 6 commits enfants livrés (tous commités explicitement, 1 groupe logique chacun)

| # | Commit | Carte | Contenu | Vérif (enfant) |
|---|---|---|---|---|
| 1 | `3ce8180` R43 | t_62bd0be8 | options persistantes (volume/daltonien/vitesse) + palettes standard/Wong | Node 187/187 + CDP 16/16 + 2 captures |
| 2 | `bbbca0f` Juice | t_5065be95 | feedback visuel canvas (particules, $ flottants, shake, animations) | Node 318/318 + CDP 11/11 + 2 captures |
| 3 | `dbd82fe` R44 | t_ebbb202e | audio synthétisé (Web Audio, 0 asset) + mute persistant via save + SFX | Node 372/372 + boot 18/18 + r44-cdp 13/13 |
| 4 | `7d87483` R45 | t_d5da994c | difficulté facile/normal/difficile (spawn + persistance + migration saves) | Node 379/379 + boot 18/18 + t21-cdp 14/14 + 2 captures |
| 5 | `eb9642e` R46 | t_7b04f863 | 3 nouveaux scénarios rejouables (crise totale / difficile / facile) | Node 397/397 + QA r38 6/6 (snapshots byte-identiques) |
| 6 | `cab66cb` R45 | t_6344db94 | campagne de victoire + stats persistantes + 8 succès (panneau lecture seule) | Node 397/397 + boot 18/18 + t22-cdp 19/19 + 2 captures |

Chaîne vérifiée par le coordinateur : `44fba4d` → `3ce8180` → `bbbca0f` → `dbd82fe` →
`7d87483` → `eb9642e` → `cab66cb` (ordre correct, 6 commits au-dessus de `origin/main`).

## 2. Vérifications ré-exécutées par le coordinateur à `cab66cb` (état empilé final)

| Vérification | Outil | Résultat |
|---|---|---|
| **Suite complète** | `node --test tests/*.test.mjs` | **397/397 pass**, 0 fail, 0 skip |
| **QA racine — boot de l'état empilé (les 6 combinés)** | `node qa/cdp-boot.mjs` (Edge headless + CDP) | **18/18 PASS** — 0 exception page ; aéroport fourni (1 piste + 1 terminal 2 portes + 1 taxiway), vols complets, sauvegarde/rechargement cohérent, retour menu |
| **QA racine — 2 captures horodatées + 0 exception** | `node qa/root-delivery.mjs` | **9/9 PASS** — capture 1 = MENU (titre + Nouvelle partie / Options / 5 scénarios / difficulté Normal) ; capture 2 = JEU (HUD + section T2-2 « Saison, stats & succès » rendue, 0 exception) |
| **Chaîne de commits + état net** | `git log` / `git status` | 6 commits enfants présents, ordre correct, 0 behind ; 1 by-produit cdp-boot non commité (décision reprise, §5) |

**Captures racines commitées** (état empilé final) : `evidence/root-20261013171819-menu.png`,
`evidence/root-20261013171819-jeu-panneau.png`.

**Contrôle visuel (garde-fou « faux PASS »)** : les 2 captures racines sont **cohérentes
avec les captures des enfants** (`t21-game-difficile.png`, `t22-20261013150943-*.png`) :
carte initiale (grille + bande) et pile de panneaux droite identiques → **aucune régression
introduite par l'état empilé**. La section T2-2 « Saison, stats & succès » est bien présente
dans le DOM (vérif texte) et validée par la QA de l'enfant `t22-cdp` (19/19).

## 3. Couverture des exigences (toutes livrées)

| Exigence | Livrée par | Preuve |
|---|---|---|
| T1-1 Audio (SFX + ambiance, mute persistant, 0 asset) | `dbd82fe` (R44) | Web Audio synthétisé ; mute dans `state.audio` (save) ; r44-cdp 13/13 |
| T1-2 Juice (particules, nombres $, shake, animations) | `bbbca0f` | canvas (z-order correct) ; 2 captures faillite/particules ; CDP 11/11 |
| T1-3 Écran titre + menu principal | `bbbca0f`+`7d87483`+`3ce8180` (R20/R38/R43/R45) | titre + boutons Nouvelle partie / Reprendre (si save) / Options / Scénarios / difficulté ; capture racine 1 |
| T1-4 Options (volume/daltonien/vitesse, persistantes) | `3ce8180` (R43) | palettes standard + Wong ; localStorage ; r43-cdp 16/16 + 2 captures |
| T2-1 Difficulté (facile/normal/difficile) | `7d87483` | spawn (capital × incidents × OPEX) + persistance + migration ; t21-cdp 14/14 + 2 captures |
| T2-2 Objectif de victoire (campagne, prime) | `cab66cb` | 3 contrats → saison gagnée + prime 2 500 $ (une fois) ; t22-cdp 19/19 + 2 captures |
| T2-3 Succès + stats (persistantes) | `cab66cb` | 8 succès + pax/bénéfice/série sans déficit/incidents ; sérialisation ; t22-cdp 19/19 |
| T2-4 2-3 scénarios (réutilisant les mécaniques) | `eb9642e` (R46) | CRISE TOTALE / DÉFI DIFFICILE / DÉFI FACILE (mêmes règles) ; QA r38 6/6 (byte-identiques) |

## 4. Preuves commitées (QA des enfants, pointées — non rejouées ici)

- `qa/r43-cdp-report.json`, `qa/r44-cdp-report.json`, `qa/t21-cdp-report.json`,
  `qa/t22-cdp-report.json`, `qa/r38-scenarios.mjs` (+ snapshots `evidence/r38-*/`).
- Captures : `evidence/r43-game-{standard,daltonien}.png`, `evidence/juice-20261013-161944-*.png`,
  `evidence/t21-{menu-difficulte,game-difficile}.png`, `evidence/t22-20261013150943-*.png`,
  `evidence/r38-{crise,difficile,facile}/`.
- **Console propre partout** (0 erreur / 0 exception ; seul le `favicon.ico 404` connu, exclu).

## 5. By-produit non commité (décision reprise des sœurs)

- `evidence/jeu-en-cours.png` (by-produit du harnais `cdp-boot`) reste **non commité** —
  convention des sœurs (bruit, régénéré à chaque run cdp-boot ; pas un livrable). Aucune
  action git de nettoyage n'est faite ici (conforme à la consigne de la carte).

## 6. Limites honnêtes (pré-existantes, HORS périmètre T1+T2 — héritées de T_final/G7)

- **G7-e** : traversée des 3 paliers en un seul tenant navigateur **non close** (paliers 1/2)
  — héritée de la livraison T_final (version candidate) ; hors périmètre T1+T2, non régressée.
- **Graphisme** : sprites vectoriels simples — à remplacer par de vrais assets sans toucher la sim.
- **Finition visuelle** : chevauchement léger de texte dans la pile de panneaux droite (transparence)
  + toasts qui recouvrent partiellement l'outils en bas — constaté sur toutes les captures
  (pré-existant, non introduit par T1+T2).
- **Équilibrage / profondeur** : chiffres des paliers = cibles (R37), pas des exigences ;
  incidents/contrats/emprunt bornés et lisibles (extension sans refonte).

> Ces limites ne conditionnent **pas** la livraison T1+T2 : les 4 exigences T1 et les 4
> exigences T2 sont livrées et vérifiées. Le statut global du projet reste **CANDIDAT** tant
> que G7-e (hors périmètre) n'est pas close ; le périmètre **T1+T2 est LIVRÉ**.

## 7. Push (coordinateur — autorisé par Elsay, 2026-10-13)

- Poussé à `origin/main` : les 6 commits enfants (`3ce8180`…`cab66cb`) + le commit racine de
  ce rapport/QA. Fast-forward (0 behind). Aucun `git add -A` ; commit explicite du travail de
  la carte uniquement.

## 8. Fichiers de cette carte

- **Ce rapport** : `RAPPORT_LIVRAISON_T1T2.md` (nouveau).
- **QA racine** : `qa/root-delivery.mjs` (nouveau harnais) + `evidence/root-20261013171819-{menu,jeu-panneau}.png` (2 captures).
- **Ré-exécutés ici** : `node --test` (397/397), `qa/cdp-boot.mjs` (18/18), `qa/root-delivery.mjs` (9/9).

---
*Chaque chiffre du §2 est issu d'une exécution du 2026-10-13 au commit `cab66cb`. Tout ce qui
n'est pas ré-exécuté ici (§4) est **pointé** vers les rapports/captures commités des enfants,
jamais repris comme acquis sans preuve.*
