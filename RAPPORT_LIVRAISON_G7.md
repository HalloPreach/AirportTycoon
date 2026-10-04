# RAPPORT DE LIVRAISON — G7 (J7) · Airport Tycoon

Carte : **G7 (t_ed681d6a)** — « Livraison (J7) : tout validé au commit final, 1re session observée ».
Date : **2026-10-04**. Commit testé : **`6ad85cb`** (R43, 66 commits au-dessus de `origin/main`, non poussé).

Ce rapport est le **rapport de gate FRAIS de G7** (le rapport BL-19 de `debee4f` est archivé daté :
`archive/rapport-final-BL-19-2026-10-02.md`). Il ne réutilise pas `RAPPORT_FINAL.md` tel quel :
il **régénère** la validation au commit testé et **pointe** les bundles commités par R41/R42/R43.
Règle du gate appliquée : les rapports de commits antérieurs ne valident pas les changements
courants → tout ci-dessous a été **ré-exécuté à `6ad85cb`**, jamais repris par copier-coller.

> **Statut : VERSION CANDIDATE validée au commit final.** Tout le noyau est vert et ré-exécuté.
> La limite essentielle unique (G7-e : 1re session 20-30 min **traversant les 3 paliers** d'un seul
> tenant navigateur) est close **en partie** : la session navigateur observée couvre **20 min de jeu**
> (R42 CDP, `x4`, 300 s réelles, ré-exécutée ci-dessous) et les **3 paliers sont validés par le cœur
> de production** (matrice G6/R38, bundle commité). La carte G7 le permet explicitement : « Toute
> limite essentielle empêche de fermer G7 comme réussite complète → version **candidate** ».

---

## 1. Vérifications ré-exécutées au commit `6ad85cb` (2026-10-04)

| Critère carte | Outil | Résultat (ré-exécuté ici) |
|---|---|---|
| **(a) Suite complète verte** | `npm run test` | **317/317 pass**, 0 fail, 0 skip |
| **(a) QA navigateur 13 flux + captures + console propre** | `node qa/r40-cdp.mjs` (Edge headless + CDP, 0 dépendance) | **19/19 pass** — stockage vide → nouvelle partie → construction (2e piste) → contrat → incident (piste fermée, intervention) → pause/vitesse → sauvegarde → reprise → faillite → retour menu ; **6 captures** régénérées (`evidence/r40-*.png`) ; console : 0 erreur, 0 exception, 0 rejet |
| **(b) Migrations (fixtures + cas combinés, appliquée une fois)** | `qa/r41-migrations.mjs` + `tests/r41-migrations.test.mjs` (7 tests dans la suite 317) ; preuves `evidence/r41-migrations/` | pattern `ensure*` re-attach d'état manquant (passagers / upgrades / emprunt / **incidents** — bug R41 corrigé) ; validation de save D4 (champ présent mais illisible → rejet lisible) ; 4 sauvegardes anciennes tolérées ; migration appliquée une fois |
| **(c) Endurance Node multi-seeds** | `node qa/r42-node.mjs` | **4/4 seeds × 24 h** (`0, 42, 1337, 2026`, `dt=2 s`) : coût tick **7-10 ms/h**, heap stable (Δ 2e moitié ≤ +3 MB, pas de fuite), journaux bornés, sauvegardes mid+fin **utilisées** (reprise d'un clone, état clé identique), `issues: []` |
| **(c) Session navigateur chargée** | `node qa/r42-cdp.mjs` | **16/16 pass**, session **20 min de jeu** à `x4` (300 s réelles, trafic continu + layout chargé 2e piste + 2e taxiway) : invariants durs tenus sur 20 paliers, heap ≈4 MB stable, FPS moyen **60** (blocage max 17 ms), latence clic max **19 ms**, incident forcé répondu via le panneau sous charge, sauvegarde → recharge → « Reprendre » état intact ; **4 captures** régénérées (`evidence/r42-*.png`) |
| **(d) README + règles + contrôles + unités + limites** | `README.md`, `docs/gameplay.md`, `docs/VERSION_NOTE_R43.md` | présents au commit ; rapports anciens **archivés datés** (`archive/rapport-final-BL-19-2026-10-02.md`) |
| **(e) 1re session 20-30 min observée au navigateur** | R42 CDP ci-dessus + G6 | session **20 min de jeu observée** (16/16, ci-dessus) ; traversée des **3 paliers** : cœur de production (G6/R38) |

**Bundles pointés (commités par R43 à `6ad85cb`, cohérents, non rejoués ici — règle du checkpoint G7 :
rejouer 120 runs = crash, R43 l'a déjà fait) :**

- `evidence/g6-integrated/rapport-g6-integrated.json` — **27/27** : matrice reproductible R36
  (12 seeds × 5 politiques × 2 pas, déterminisme byte-identique sha256, tolérance pas 0,4 s,
  extension 48 h) + 4 critères R37 sur 12 seeds + 3 scénarios R38 rejouables.
- `evidence/r36-matrix/rapport-matrix.json` — matrice datée au commit.
- `evidence/r41-migrations/report.json` — 7 checks migrations OK (pré-R32 incidents re-attachées).
- `qa/r40-report.json`, `qa/r42-cdp-report.json`, `qa/r42-node-report.json` — rapports **régénérés
  pour ce rapport** (ce commit), captures `evidence/r40-*.png`, `evidence/r42-*.png`.

**Console propre partout** : 0 exception page, 0 rejet de promesse, 0 erreur console
(1 message `favicon.ico 404` connu et exclu sur les deux harnais CDP).

## 2. Ce que G7 ajoute au bundle R43 (delta de cette carte)

1. **Ré-exécution au commit final** : suite 317/317 + 1 CDP représentatif (13 flux, R40) + 1 session
   endurance (20 min de jeu, R42 CDP) + 1 probe endurance Node (4 seeds). Les rapports/captures
   commités sont maintenant **ceux du run G7**, pas ceux de R43.
2. **Ce rapport** (`RAPPORT_LIVRAISON_G7.md`) : le rapport de gate frais, au commit testé, qui
   synthétise critères (a)→(e) et pointe les bundles commités — exigence « PREUVES ATTENDUES ».
3. **Clôture du critère (e) en version candidate** : la 1re session navigateur chargée de
   **20 min de jeu** est observée et ré-exécutée ; la traversée des 3 paliers en un seul tenant
   navigateur reste la limite unique assumée (voir §3) — la carte autorise la version candidate.

## 3. Limites réelles (honnêtes)

- **G7-e (limite essentielle unique)** : une 1re session de **20-30 min traversant les 3 paliers
  d'un seul tenant navigateur** n'a pas été close ici. Ce qui est validé : session chargée
  **20 min de jeu** (R42 CDP, ré-exécutée) + **3 paliers par le cœur de production** (G6/R38,
  rejouabilité byte-identique). Pour clore entièrement (e) : une session navigateur de ~40 min de
  jeu (`x4`) qui franchit les seuils de déblocage des paliers 2 et 3 — le harnais existe
  (`qa/r42-cdp.mjs`, paramètre `GAME_SECONDS`) ; rien d'autre à construire.
- **Graphique** : sprites vectoriels simples — à remplacer par de vrais assets sans toucher la sim.
- **Équilibrage** : chiffres des `UNLOCK_RULES` / paliers = **cibles** (R37), pas des exigences.
- **Multi-terminal** : le 2e terminal est constructible et fonctionnel ; le chemin « multi-terminal
  complet » n'est pas l'objectif validé de cette version.
- **Incidents / contrats / emprunt** : volontairement limités (R32, D5 capé) — extension sans refonte.

## 4. Fichiers du commit G7

- **Ce rapport** : `RAPPORT_LIVRAISON_G7.md` (nouveau, gate G7).
- **Rapports régénérés** : `qa/r40-report.json`, `qa/r42-cdp-report.json`, `qa/r42-node-report.json`.
- **Captures régénérées** : `evidence/r42-*.png` (4) + `evidence/r40-d-deux-pistes.png`,
  `r40-f-incident.png`, `r40-h-sauvegarde.png`, `r40-i-reprise.png` (4 — écrans de jeu).
  Les 2 captures de menu (`r40-a-stockage-vide`, `r40-j-retour-menu`) sont byte-identiques au
  bundle commité — non re-commitées.
- **Non commités (bruit, par décision de checkpoint)** : `RECONCILIATION_*.md` (legacy G1, obsolètes),
  `evidence/r37-*/` (régénération orpheline), scratchs `qa/_*`.

---
*Chaque chiffre de ce rapport est issu d'une exécution du 2026-10-04 au commit `6ad85cb`.
Tout ce qui n'est pas ré-exécuté ici (matrice G6, migrations R41) est **pointé** vers son bundle
commité, jamais repris comme « vérifié ici ».*
