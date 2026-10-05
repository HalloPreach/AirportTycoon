# Vérification des constats de l'audit (2026-10-04) — AirportTycoon @ 69ef8e7

Tâche kanban : t_26ae6729 · 2026-10-05 · Lecture seule (0 changement de code)
Source vérifiée : `C:\Users\Lucas\Documents\Codex\2026-09-14\je-veux-changer-mon-mod-le\audit-2026-10-04.md`
Checkout : `69ef8e7` (G7) sur `main` ; 175 fichiers untracked (bruit de régénération, non-commités par décision G7).
Méthode : lecture des fichiers + requêtes SQLite lecture seule (`mode=ro`) + re-exécution `npm run test`.
Scriptes de vérification (untracked, `qa/_verify-audit-*.py`, lecture seule) : _verify-audit-constats.py, _2, _3, _4, _5, _6, _7.

## Verdict par constat

### 1. « Session 20 min de jeu au x4 » — **INVALIDÉ (vitesse), VÉRIFIÉ (invariants)**

| Point | Verdict | Preuve |
|---|---|---|
| `session.gameSeconds` = 1200, `realSeconds` = 300 | **Vérifié** | `qa/r42-cdp.mjs:6-11` ; `qa/r42-cdp-report.json` → `"session":{"speed":4,"gameSeconds":1200,"realSeconds":300,"samples":20}` |
| « x4 » réellement appliqué | **INVALIDÉ** | Deltas game-sec/palier (15 s réelles) : `15.13 / 40.67 / 60.53` qui se répètent exactement (palier 0→1 = 15.13 ≈ x1 ; 1→2 = 40.67 ≈ x2 ; 2→3 = 60.53 ≈ x4). La session **cycle x1→x2→x4 toutes les 15 s**, moyenne ≈ **2.8x** sur 300 s réelles. |
| 1re palier t=127.77, dernier t=840.8 (14:01) | **Vérifié** | `r42-cdp-report.json` samples[0].t=127.77, samples[19].t=840.82 — cohérent avec un début de session t≈120 s et ~14 min de jeu effectif, **pas 20 min**. |
| Raison (mécanisme) | Vérifié | `r42-cdp.mjs:174` — la « restauration x4 » après chaque mesure de latence est un `for (i<3 && !label.includes('x4')) btn.click()` aveugle : le label ne suit qu'au frame suivant (aucun `await` entre les 3 clics), donc le clic 3 atterrit à x1 (cycle x1→x2→x4→x1). Fragilité réelle : dépend de la phase du RAF, non déterministe. |
| Impact | Modéré | Les invariants durs (C) sont indépendants de la vitesse → pas d'effet sur la conclusion R42. Mais l'affirmation « 20 min de jeu » du `RAPPORT_LIVRAISON_G7.md:29` est exagérée : **~14 min de jeu effectif**. Pour clore G7-e (~40 min de jeu) il faudra corriger la restauration x4 (clics déterministes) avant de lancer une session longue. |

### 2. Invariants R42 — **VÉRIFIÉ (C), INVALIDÉ (la sous-assertion « 1× sur la ponctualité »)**

- `r42-cdp-report.json` : `contractHistory = 0` sur les 20 paliers ; `punctuality = 0` sur les 20 paliers ; `orphanGates = 0` ; `nonFinite = []` ; `bankrupt = false` partout. → invariants durs tenus, 0 palier cassé.
- **Bogue de sémantique** : `r42-cdp.mjs` (expr SAMPLE) lit `sim.passengers.punctuality?.recent`, mais le vrai journal est écrit par `ensurePunctuality` → `sim.punctuality` (`src/sim/aircraft.mjs:66-70`). Le check « ponctualité 1× » est donc **aveugle** : il compte toujours 0 car il lit le mauvais objet. `sim.passengers` (`src/sim/passengers.mjs`) n'a pas de champ `punctuality` (grep `sim.punctuality` → 0 occurrence hors `aircraft.mjs`).
- **Bogue de sémantique 2** : la détection de doublons de contrat (Set des `c.id` sur `sim.contracts.history`) est exploitable seulement si un contrat se clôture. Sur les 20 paliers `contractHistory = 0` → le check passe **trivialement** (rien à vérifier). Non vérifiable en pratique ici ; à re-vérifier sur une session où au moins 1 contrat se clôture.
- `pax` non monotone : le code ne le checke pas (pas de `check(...)` sur pax monotone) → l'affirmation « non monotone, non-inclu dans les invariants durs » est **vérifiée** par absence dans `r42-cdp.mjs`.
- Impact : la conclusion « invariants durs tenus » tient ; la sous-assertion « 1× sur la ponctualité » est **fausse de fait** (journal non lu). À corriger dans le harnais (pointer `sim.punctuality`) avant de s'appuyer sur ce check.

### 3. Contrats double-settlement — **NON VÉRIFIABLE (zéro contrat actif)**

- `r42-cdp.mjs` (expr SAMPLE) : `activeSettled = sim.contracts.active && h.some((c) => c.id === sim.contracts.active.id)` ; `dupes` via Set sur `sim.contracts.history`.
- Sur les 20 paliers `contractHistory = 0` → ni `activeSettled` ni `dupes` ne peuvent être non-triviaux. Le check passe sans rien vérifier. **Non vérifiable** sur ce run ; requiert une session avec ≥1 contrat terminé.

### 4. « Guardrails jamais activés, agent jamais arrêté » — **INVALIDÉ**

- `turn_stop_gates.py` existe : `C:\Users\Lucas\AppData\Local\hermes\hermes-agent\agent\turn_stop_gates.py` ; contient le gate `idempotent_no_progress_block` et le mot « guardrail ». **Vérifié.**
- **INVALIDÉ** : `logs/agent.log` contient **3 lignes** `Turn ended: reason=guardrail_halt` dans la fenêtre 03/10–05/10 :
  - `2026-10-03 05:31:28` session `20261003_051832_da2f2f`
  - `2026-10-04 04:27:00` session `20261004_031811_083391`
  - `2026-10-04 06:08:54` session `20261004_053316_5c8af3`
  - `kanban/logs/t_1c21c88e.log` (R39) et `t_2194baa9.log` (R41) contiennent « Tool guardrail halted read_file: idempotent_no_progress_block » (1 occurrence chacun).
  - `t_ed681d6a.log` (G7) : 0 occurrence.
- **Compteurs DB (lecture seule, `kanban.db`)** :
  - `tasks.status='done'` = **259** (+ 4 archived = 263, ce qui correspond au « 263 » cité par l'audit si on compte les archivées).
  - `task_runs.outcome` (fenêtre 03/10 18h → 05/10) : total = 33, completed = 8, crashed = 2, blocked = 2.
  - G7 (t_ed681d6a) : 3 runs — run 342 crashed (`pid 33316 not alive`), run 343 crashed (`pid 31992 not alive`), run 344 completed 06:20:37→06:35:10. G7.status = `done`, `completed_at = 2026-10-04 10:21:50`.
- L'audit dit « R39, R41, G7 sont bloqués par cascade » → **stale** : au moment de la vérification, G7 est `done`. R39 (t_1c21c88e) est `done`. R41 (t_2194baa9) est `done`. Les cascades R39/R41/R43 sont clôturées.
- Impact : l'affirmation « jamais arrêté » est fausse ; 3 arrêts guardrail sont documentés. L'audit sous-estime la friction du workflow.

### 5. « RAPPORT_LIVRAISON_G7.md dit validé ; VALIDATION_G0-G7.md dit bloqué » — **NON CONTRADICTOIRE (ancrages temporels différents)**

- `VALIDATION_G0-G7.md:28` : G7 = **BLOQUÉ** (cascade R39-R43 en todo, amont G6 non validé), commit testé `e3dc3fc`, date 2026-10-02. C'est un **état instantané** à 10-02.
- `RAPPORT_LIVRAISON_G7.md:4` : commit testé `6ad85cb` (R43), date 2026-10-04. Le rapport déclare explicitement : « les rapports de commits antérieurs ne valident pas les changements courants » (§1, règle du gate). Il **régénère** la validation, il ne contredit pas l'ancien état bloqué à 10-02.
- Les deux documents sont **cohérents** : 10-02 = G7 bloqué (R39-R43 non faites) ; 10-04 = R39-R43 faites, G7 validé sur le nouveau commit. Pas de contradiction, juste deux horizons. **Non invalidé.**

## Tâches R39/R41/G7 — statuts actuels (DB)

| Tâche | ID | statut DB | runs (fenêtre) |
|---|---|---|---|
| R39 — Améliorer le retour visuel utile | t_1c21c88e | done | 1 crashed (pid 16812) + 1 completed |
| R41 — Migrations inter-fonctionnalités | t_2194baa9 | done | 1 crashed (pid 31740) + 1 completed |
| G7 — Livraison (J7) | t_ed681d6a | done | 2 crashed (pids 33316, 31992) + 1 completed |

Les cascades sont clôturées. G7 est `done` au 10-04 10:21.

## Suite de tests

`npm run test` re-exécutée ici (2026-10-05) sur `69ef8e7` : **317 pass, 0 fail, 0 skip, 0 cancelled** (duration 619 ms). Cohérent avec `RAPPORT_LIVRAISON_G7.md:25`.

## Récapitulatif

| # | Constat | Verdict |
|---|---|---|
| 1 | x4 / 20 min de jeu | **INVALIDÉ** (vitesse) — cycle x1/x2/x4, ~14 min de jeu. Invariants tenus (indépendants de la vitesse). |
| 2 | Invariants R42 | **VÉRIFIÉ** (durs). Sous-assertion ponctualité : **INVALIDÉ** (mauvais objet lu : `sim.passengers.punctuality` au lieu de `sim.punctuality`). |
| 3 | Contrats double-settlement | **NON VÉRIFIABLE** (0 contrat actif dans le run). |
| 4 | Guardrails jamais activés | **INVALIDÉ** — 3 `guardrail_halt` dans la fenêtre, dont 1 pendant G7. |
| 5 | G7 validé vs bloqué | **NON CONTRADICTOIRE** — deux horizons (10-02 vs 10-04), pas de divergence. |

**Aucun changement de code effectué.** Les 2 bogues de sémantique du harnais (constats 1 et 2) et l'invalidation du constat 4 sont documentés ; aucune correction appliquée (tâche = lecture seule).
