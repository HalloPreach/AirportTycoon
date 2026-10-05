# RAPPORT DE LIVRAISON FINAL — Airport Tycoon (version livrée)

Carte : **T_final (t_8ea0827d)** — « Rapport de livraison final ».
Date : **2026-10-05**. Commit testé : **`7c56c9b`** (G7-e, HEAD, non poussé ; 9 commits au-dessus
de `origin/main` avant le commit de ce rapport).

**Lien avec les bundles R42/R43** : `68c39a9` (R42) est ancêtre de HEAD ; la carte R43
(`6ad85cb`) est **docs-only** — `git diff 68c39a9 7c56c9b -- src tests` est vide (le seul
delta est le harnais `qa/g7-session.mjs` + ses rapports). Le code de jeu testé ici est donc
**identique au bundle R42**, validé aux commits R42/R43. Tout ci-dessous a été **ré-exécuté
à `7c56c9b`** le 2026-10-05 (suite, 4 harnais, migrations) ; les bundles lourds (matrice G6)
sont **pointés** vers leurs rapports commités (règle du gate : rejouer 120 runs = crash).

> **Statut final : VERSION CANDIDATE.** Le noyau est entièrement vert et ré-exécuté ;
> une limite essentielle unique reste ouverte — **G7-e : la 1re session navigateur observée
> ne traverse PAS les 3 paliers** (palier 1 FAIL carburant, palier 2 NON EXERCÉ ; palier 3
> PASS). La traversée des 3 paliers est validée **par le cœur de production** (R38/G6).
> La carte G7 le permet explicitement : limite essentielle ouverte → version **candidate**,
> jamais « livraison entièrement validée ».

---

## 1. Ré-exécuté à `7c56c9b` (2026-10-05)

| Vérification | Outil | Résultat |
|---|---|---|
| **Suite complète** | `npm run test` | **317/317 pass**, 0 fail, 0 skip |
| **QA navigateur 13 flux + captures + console propre** | `node qa/r40-cdp.mjs` (Edge headless + CDP) | **19/19 pass** — 4 captures jeu régénérées (`evidence/r40-{d,f,h,i}.png`) ; console : 0 erreur, 0 exception, 0 rejet |
| **Endurance navigateur (session chargée)** | `node qa/r42-cdp.mjs` | **20/20 pass** — session **20 min de jeu** à `x4` (300 s réelles, 18 échantillons), layout chargé 2e piste + 2e taxiway, invariants durs tenus, heap stable, sauvegarde → « Reprendre » état intact ; 4 captures régénérées (`evidence/r42-*.png`) |
| **Endurance Node multi-seeds** | `node qa/r42-node.mjs` | **4/4 seeds × 24 h** (`0, 42, 1337, 2026`, `dt=2 s`) : ~8 ms/h, heap stable, `issues: []` |
| **Migrations (fixtures + cas combinés)** | `node qa/r41-migrations.mjs` | **12/12 checks OK** — `ensure*` (passagers/emprunt/incidents) + rejets lisibles (D4) ; `evidence/r41-migrations/report.json` régénéré |
| **G7-e : 1re session 3 paliers** | `node qa/g7-session.mjs` | **7/9, verdict NON EXERCÉ (palier 2)** — palier 1 **FAIL** (carburant=0 au t=305 s : départ sec malgré la station posée avant le besoin), palier 2 **NON EXERCÉ** (pic de file au plafond non déclenché dans la borne 20 min), palier 3 **PASS** (contrat c1 + upgrade achetés avant l'échéance) ; E (sauvegarde/reprise) et F (0 ressource en échec hors /favicon.ico, 0 exception, 0 erreur console) **PASS** ; 5 captures (`evidence/g7-session/`) |

Rapports régénérés : `qa/r40-report.json`, `qa/r42-cdp-report.json`, `qa/r42-node-report.json`,
`qa/g7-session-report.json` (+ captures ci-dessus). **Console propre partout** (1 message
`favicon.ico 404` connu et exclu).

## 2. Bundles pointés (commités, non rejoués ici — règle du checkpoint G7)

- `evidence/g6-integrated/rapport-g6-integrated.json` — **27/27** : matrice R36 (12 seeds × 5
  politiques × 2 pas, déterminisme byte-identique sha256, tolérance pas 0,4 s, extension 48 h)
  + 4 critères R37 sur 12 seeds + 3 scénarios R38 rejouables.
- `evidence/r36-matrix/`, `evidence/r37-validate/`, `evidence/r38-{guide,saturation,redressement}/`
  — les 3 paliers validés **par le cœur de production** (byte-identiques + invariants OK).
- `qa/r40-report.json`, `qa/r42-*.json` (versions antérieures) — remplacés par les runs §1.

## 3. Clôture de t_0aedbeaa (arrêts prématurés Hermes)

Close par `evidence/hermes-early-stops.md` (commitée, t_0aedbeaa) : les 3 `guardrail_halt`
sont des **garde-fous légitimes** (détection de relecture répétée) — non désactivés ; les runs
342/343 (G7) sont des **défauts de clôture non déterministes du modèle** (fin de tour en
réponse textuelle sans `kanban_complete`), **pas** des crashs mémoire/faute et **pas** un bug
de ce dépôt. Mitigation existante (stop-loop nudges + re-queue) a porté au run 344 (completed).
**Aucune modif de code exigée ici** → pas de 2e commit de fix. Qwen local / NInfer inchangés.

## 4. Limites honnêtes (portées du RAPPORT_FINAL, à nouveau assumées)

- **G7-e (limite essentielle unique)** : traversée des 3 paliers en un seul tenant navigateur
  **non close** (paliers 1/2). Pour clore entièrement : session ~40 min de jeu (`x4`)
  franchissant les seuils des paliers 2/3 — le harnais existe (`qa/g7-session.mjs`,
  paramètre `GAME_SECONDS`) ; rien à construire.
- **Graphique** : sprites vectoriels simples — à remplacer par de vrais assets sans toucher la sim.
- **Équilibrage** : chiffres des `UNLOCK_RULES` / paliers = cibles (R37), pas des exigences.
- **Multi-terminal** : 2e terminal constructible et fonctionnel ; le chemin « multi-terminal
  complet » n'est pas l'objectif validé de cette version.
- **Incidents / contrats / emprunt** : bornés et lisibles (R32 limités, D5 capé) ; la
  profondeur stratégique est volontairement limitée — extension sans refonte.

## 5. Fichiers de cette carte

- **Ce rapport** : `RAPPORT_LIVRAISON_FINAL.md` (nouveau, gate final).
- **Régénérés à `7c56c9b`** : `qa/{r40,r42-cdp,r42-node,g7-session}-report.json`,
  `evidence/r40-{d,f,h,i}*.png`, `evidence/r42-*.png` (4), `evidence/r41-migrations/report.json`,
  `evidence/g7-session/` (5 captures, commitées pour la 1re fois).
- **Non commités (bruit, décision reprise de G7)** : `RECONCILIATION_*.md`,
  `evidence/r37-*/` (orphelins), scratchs `qa/_*`, `docs/R_*` (spécifs de création de cartes).

---
*Chaque chiffre du §1 est issu d'une exécution du 2026-10-05 au commit `7c56c9b`. Tout ce qui
n'est pas ré-exécuté ici (§2) est **pointé** vers son bundle commité, jamais repris comme
« vérifié ici ». Le statut final reste **CANDIDATE** tant que G7-e paliers 1/2 est ouvert.*
