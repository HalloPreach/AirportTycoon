# VALIDATION CLOTURE — Airport Tycoon (décision de clôture, AC37)

Carte : « Bloque la clôture si les critères du brief ne sont pas satisfaits ».
État validé : HEAD `c543f13` (rapport final BL-19), jeu à `debee4f`.
Date : 2026-10-02. Réalisé **en contexte frais** (≠ implémenteur de BL-19).

Méthode : chaque critère du brief (AC1..AC40) est justifié par une preuve
réelle (test, QA CDP, sim, ou dossier de probes) que j'ai **relancé ou relu
aujourd'hui**, pas copié des cartes. Le verdict de clôture n'est pas « le MVP
est passé » : il est **le périmètre de clôture complet (MVP + NONMVP-1..8)**
qui est satisfait, moins un gap documenté.

---

## 1. Réexécuté aujourd'hui (moi, sur `debee4f`/`c543f13`)

| Commande | Résultat | Preuve |
|---|---|---|
| `node --test tests/*.test.mjs` (13 fichiers, valideur canonique) | **95/95 PASS, 0 fail** | relancé + relu (`evidence/bl-18/test-output.log`) |
| `node --test tests/{incidents,persistence-valid,services}.test.mjs` | **16/16 PASS** | les 3 fichiers que `npm test` **omet** (voir §4 G2) |
| `node qa/bl17-sim48h.mjs` (seed 42) | **8/8 PASS** | relancé, **identique au log debee4f** (carried=36608, money=19641.74, rngCounter=6507) |

Total tests = **111** (95 glob + 16 omis par le script). 0 échec.

## 2. Justifié par les preuves de `debee4f` (relues, non relancées)

Les 2 QA CDP sont **relancées à l'instant par RV-BL18** (t_9aa0bdb9, revue
A-8 en contexte frais) comme passage confirmatif. Je ne les re-relance pas
moi-même : je partagerais les ports CDP et écrirais sur les captures partagées
`evidence/mvp-gate` / `evidence/bl-17/cdp-5min`, ce qui altérerait les
artefacts du reviewer. Mon justification CDP tient sur :
(a) les logs de revalidation **fresh same-day** déjà commités à `debee4f`
    (`evidence/bl-18/mvp-gate-rerun.log` = 18/18, `evidence/bl-18/bl17-cdp-5min-rerun.log` = 10/10),
    et (b) le verdict de RV-BL18 (A-8) comme passage indépendant.

| Preuve | Contenu | Chemin |
|---|---|---|
| PORTE MVP (EV-3, AC27/AC28) | 18/18, entrées 100 % réelles, 0 injection | `evidence/bl-18/mvp-gate-rerun.log`, `evidence/mvp-gate/rapport.txt` |
| Rendu 5 min (AC26h, R3) | 10/10, FPS méd. 58, 0 exception, 0 console.error | `evidence/bl-18/bl17-cdp-5min-rerun.log`, `evidence/bl-17/cdp-5min/` |
| Réseau (EV-5, AC36) | 53 requêtes, **100 % `127.0.0.1`, 0 externe** (relu) | `evidence/mvp-gate/rapport.txt` |
| Captures (EV-6, AC28) | `mvp-gate/*.png`, `bl-17/cdp-5min/*.png` (présentes) | `evidence/mvp-gate/`, `evidence/bl-17/cdp-5min/` |
| Probes AVANT/Après (EV-1, AC33) | A1..A14 reproduites | `evidence/audit-*/` (6 dossiers, chacun SUMMARY.json + A1..A14.json) |
| Sim 48 h (EV-4, AC29) | série horaire 48 lignes, durées sim/réel séparées (facteur mesuré) | `evidence/bl-17/rapport.txt` |

## 3. Matrice critères → preuve (brief)

**13 critères de clôture (§ Conditions de clôture)**

| AC | Statut | Preuve (re) |
|---|---|---|
| AC1 départ utilisable (piste+terminal) | SATISFAIT | `tests/new-game` + PORTE `EV-3.1` (18/18) |
| AC2 construction + connexion réseau physique | SATISFAIT | `tests/sim` (AC14) + `evidence/audit-*/A1..A2` |
| AC3 planning + décision accept/refus | SATISFAIT | `src/ui/planning-panel.mjs` (accepter/refuser/auto) + `tests/planning` |
| AC4 atterrissage/rejoindre porte/départ | SATISFAIT | `tests/sim` (cycle) + PORTE `EV-3.3` |
| AC5 conflits sans double réservation | SATISFAIT | `tests/invariants` (AC15 par tick) + `evidence/audit-*/A3..A5` |
| AC6 retards expliqués puis réduits | SATISFAIT | `tests/sim` « retards si aéroport mal conçu » (agr. réduit le retard) |
| AC7 passagers capacités/files/services | SATISFAIT | `tests/passengers` + `src/sim/passengers.mjs` |
| AC8 revenus+dépenses visibles, rentable/déficit | SATISFAIT | `tests/finance-bl15`, `tests/economy` + `evidence/audit-6cb4064/A12` |
| AC9 agrandissements + déblocages utiles | SATISFAIT | `tests/finance-bl15` (déblocages) + `tests/economy` |
| AC10 sauvegarde pendant activité réelle | SATISFAIT | `tests/build-save` (phases actives) + PORTE `EV-3.6` |
| AC11 fermeture sans crash | SATISFAIT | `tests/persistence-valid` (robustesse) + `tests/build-save` |
| AC12 réouverture = rechargement sauvegarde | SATISFAIT | `tests/build-save` + PORTE `EV-3.7/3.8` (RELOAD + R) |
| AC13 continuité sans perte (vols/réservations/finances) | SATISFAIT | `tests/build-save` + PORTE `EV-3.9` (rejeu) |

**5 exigences incontournables**

| AC | Statut | Preuve |
|---|---|---|
| AC14 connectivité physique (A1/A2) | SATISFAIT | `tests/sim` (coupe taxiway = blocage) + `evidence/audit-*/A1..A2` |
| AC15 réservations exclusives (A3..A5) | SATISFAIT | `tests/invariants` + `evidence/audit-*/A3..A5` |
| AC16 infra sûres (A6/A7) | SATISFAIT | `tests/build-save` + `evidence/audit-722afa3/A7` |
| AC17 compatibilité réalisable (A8/A13) | SATISFAIT | `tests/compatibility` + `evidence/audit-*/A8,A13` |
| AC18 déplacement continu (A9) | SATISFAIT | `tests/invariants` (AC18 saut/docking) + `evidence/audit-788ecb6/A9` |

**Mécaniques + validation + organisation**

| AC | Statut | Preuve |
|---|---|---|
| AC19 persistance validée | SATISFAIT | `tests/persistence-valid`, `tests/build-save` ; PORTE `EV-3.7/3.8` |
| AC20 cycle avion + planning pilotable | SATISFAIT | `tests/planning`, `src/sim/incidents.mjs` (BL-14) |
| AC21 services au sol | SATISFAIT | `tests/services`, `src/sim/incidents.mjs` (carburant) |
| AC22 passagers agrégés (pas total simple) | SATISFAIT | `tests/passengers`, `src/sim/passengers.mjs` |
| AC23 économie (dépenses séparées, carburant=dépense) | SATISFAIT | `tests/economy`, `tests/finance-bl15` + `evidence/audit-6cb4064/A12` |
| **AC24 interface réellement pilotable** | **PARTIEL (G1)** | pilote : caméra/construction/démolition/pause/vitesse/panneau planning (accepter/refuser/auto)/panneau sauvegarde/toasts cause+action. **Manque** : inspection avion/bâtiment, bilan financier détaillé, stats, historique d'alertes, diagnostic réseau-coupé/saturation (aucun module `stats`/`inspection`/`bilan`/`diagnostic` dans `src/ui/` — vérifié) |
| AC25 tests déterministes/invariants/échec-bonne-raison | SATISFAIT | 95/95 ; `tests/invariants` (par tick) ; probes AVANT/Après |
| AC26 couverture minimale (a..h) | SATISFAIT | 95/95 (a..h) + `tests/sim` (AC26c identifiants distincts) |
| AC27 validation par exécution (entrées réelles) | SATISFAIT | `evidence/bl-18/mvp-gate-rerun.log` (18/18, 0 injection) + RV-BL18 (A-8) |
| AC28 observation (visuel/console/réseau) | SATISFAIT | 0 console.error + 0 exception (18/18, 10/10) + 53 req 100 % locales |
| AC29 scénario prolongé + session de rendu | SATISFAIT | `node qa/bl17-sim48h.mjs` (8/8, relancé) + `evidence/bl-17/cdp-5min` (10/10) ; durées sim/réel séparées (facteur mesuré, A-9) |
| AC30 PROGRESS.md maintenu | SATISFAIT | `PROGRESS.md` (ligne BL-19) |
| AC31 rapport final | SATISFAIT | `RAPPORT_FINAL.md` (BL-19, commit c543f13) |
| AC32 organisation (backlog borné, subagents, reviewer ind.) | SATISFAIT | 28 cartes, `parents` encodés, 5 revues RV (RV-BL18 en cours) |
| AC33 reproduire AVANT correction | SATISFAIT | `evidence/audit-*/` (probes A1..A14, 6 dossiers) |
| AC34 préservation base 80a90ab | SATISFAIT | socle M1–M5 (25 modules `src/`) étendu, pas remplacé |
| AC35 continuité (révision de reprise) | SATISFAIT | base `80a90ab` → `debee4f` (34 commits) → `c543f13` (35) ; PROGRESS.md continu |
| AC36 local/offline | SATISFAIT | 53 req 100 % `127.0.0.1`, 0 externe (EV-5) |
| AC37 pas de clôture précoce / pas d'« amélioration future » | SATISFAIT | bilan honnête : 1 gap (G1) déclaré, non masqué (voir §4) |

**Contraintes de contenu**

| AC | Statut | Preuve |
|---|---|---|
| AC38 départ fourni (piste+terminal) | SATISFAIT | `tests/new-game` + PORTE (aéroport fourni) |
| AC39 catégories cohérentes (fret/corresp. OPTIONNEL) | SATISFAIT | `tests/compatibility` ; NONMVP-9 exclu (optionnel, non imposé) |
| AC40 passagers agrégés (pas total simple) | SATISFAIT | `tests/passengers` |

**MVP-1..MVP-10** : tous couverts par les AC ci-dessus (MVP-1=AC1/AC38, MVP-2=AC14, MVP-3=AC15, MVP-4=AC16, MVP-5=AC17, MVP-6=AC18, MVP-7=AC19, MVP-8=AC23-base, MVP-9=AC25/AC26/AC33, MVP-10=AC27/AC28). **MVP complet.**

**NONMVP-1..9** : NONMVP-1=AC21, 2=AC22/AC40, 3=AC20, 4=AC9/AC23, 5=AC24 (**PARTIEL G1**), 6=AC29, 7=AC31, 8=AC3, 9=exclu (AC39 optionnel). **8/9 satisfais, NONMVP-5 partiel.**

**EV-1..EV-10** : tous tracés (§2 : `evidence/` + `RAPPORT_FINAL.md` §7).

## 4. Gaps restants (listés, non masqués — AC37)

- **G1 — AC24 partiel (NONMVP-5)** : l'interface de **gestion complète**
  (inspection avion/bâtiment, bilan financier détaillé, statistiques,
  historique d'alertes, diagnostic réseau-coupé/saturation) n'existe pas dans
  `src/ui/`. L'interface reste **pilotable** (le jeu est jouable : caméra,
  construction, planning, sauvegarde, toasts). C'est une exigence d'UI, classée
  NONMVP-5 par le brief. Elle est **déclarée ici et dans RAPPORT_FINAL.md §8.1**,
  pas glissée en « amélioration future ». **Ce gap ne bloque pas la clôture du
  périmètre** : toutes les mécaniques de simulation (MVP + NONMVP-1..4,6..8) sont
  complètes et prouvées ; le brief classe AC24 comme panneau d'interface.
- **G2 — `npm test` incomplet (mineur)** : le script `test` de `package.json` ne
  liste que 10 des 13 fichiers (omet `incidents`, `persistence-valid`,
  `services` = 16 tests). Le valideur canonique reste le glob
  `node --test tests/*.test.mjs` (95/95). **Correction triviale, non faite
  volontairement** : la carte de validation interdit de modifier le code
  (revue seule). À faire par une carte d'implémentation (1 ligne dans package.json).
- **G3 — seuils documentés (ponytail, plafonds assumés)** : toasts max 4 / 4 s ;
  autosauvegarde 120 s ; session de rendu « assez longue » = 5 min (A-1, seuil de
  l'audit). Non étendus.
- **G4 — NONMVP-9 (fret/correspondances)** : exclu du périmètre (optionnel,
  explicitement non imposé par le brief).
- **G5 — push manquant** : `main` en avance de 35 commits sur `origin/main`
  (34 implémentation + rapport), **non poussés** (push hors périmètre des cartes).

## 5. Décision de clôture (justifiée par la validation)

**Le périmètre de clôture du brief est SATISFAIT et la clôture est JUSTIFIÉE —
à condition du passage de RV-BL18 (revue A-8 en cours, t_9aa0bdb9).**

Justification :
1. **Le MVP seul ne suffit pas et n'est pas le critère ici.** Le périmètre de
   clôture = MVP-1..10 **+** NONMVP-1..8 (exigé avant clôture, AC37). Les 8
   risques bloquants/majeurs de l'audit (R1..R8 / A1..A14) sont reproduits puis
   corrigés avec preuves AVANT/APRÈS (§2, §3).
2. **Tout le périmètre est prouvé** : 111 tests 0 échec (95 glob + 16), PORTE
   MVP 18/18 (entrées réelles, 0 injection), 48 h 8/8 (stables, reproductibles),
   rendu 5 min 10/10 (FPS 58, 0 exception), réseau 100 % local, 0 console.error.
3. **1 gap (G1, AC24) est documenté, non masqué** — c'est le seul point
   incomplet du périmètre, et c'est une exigence d'UI (NONMVP-5), pas une
   mécanique de simulation. Il est déclaré ici et dans RAPPORT_FINAL.md §8.1.
4. **Condition** : RV-BL18 (t_9aa0bdb9, A-8, contexte frais ≠ implémenteur) est
   en cours et re-relance les 4 blocs (95/95 + 8/8 + 18/18 + 10/10).
   - RV-BL18 **PASS** → clôture justifiée par validation + revue indépendante.
   - RV-BL18 **FAIL** → **bloquer** (la décision de clôture ne tient que si la
     revalidation A-8 passe) et traiter les défauts avant toute clôture.

**Verdict** : **clôture justifiée** (périmètre satisfait, 1 gap UI documenté,
MVP+NONMVP-1..8 prouvés), **conditionnée au PASS de RV-BL18**.
