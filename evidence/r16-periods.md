# R16 — périodes financières stables + prévision simple — preuve (t_007f2297)

## Règle implémentée (economy.mjs)
- **PÉRIODE = 5 min de jeu (300 s, `PERIOD_S`)** — stable et mesurable, échelle
  de la seconde de jeu (R15). La clôture est un **compteur accumulateur**
  (`economy._periodAcc`, pattern `_spawnAcc` de flights.mjs) : un gros tick ne
  duplique pas (1200 s de jeu = 4 clôtures), et **0 s de jeu (pause → tick à 0)
  ne clôt rien** — la fermeture ne se base pas sur le temps de jeu consommé.
- **Une période = delta des comptes CUMULÉS depuis la clôture précédente**
  (revenue/opex/fuel/compensation/construction/debt). Net par l'identité R12 :
  `net = revenue − opex − fuel − compensation − invest − debt` (dette comptée
  UNE fois) → **les composants reconstituent le net** (R26), et le net
  rapproche le solde (comptabilité, pas un chiffre à côté).
- **Historique BORNE : les 4 dernières périodes** (`MAX_PERIODS = 4`, comme
  R14) : prévision + lisible, pas de journal infini.
- **Prévision simple (`forecast`)** : tendance LINÉAIRE depuis la DERNIÈRE
  période close — `rate = net / (minutes × 60)` ($/s de jeu, même échelle que
  `OPEX_PER_SEC`), horizon 1 h de jeu, `projected = solde + rate × 3600`.
  **SANS historique → `null` : prévision INDETERMINÉE, jamais un faux chiffre.**
  L'étiquette « projection, pas une garantie » est rendue par l'UI
  (src/ui/panels.mjs, panneau « Bilan financier » : ligne « Période 5 min (net) »
  + ligne « Prévision +1 h (projection, pas une garantie) »).
- Les cumuls (`periodStatement`, « toute la partie ») et la période récente
  (5 dernières minutes de jeu) sont DISTINCTS, tous deux affichés.

## Compatibilité (sauvegarde)
- Nouveaux champs additifs sur `economy` : `periods: []`, `_periodAcc: 0`,
  `_periodBase` (sim-state.mjs). Une sauvegarde ANCIENNE (sans ces champs)
  charge sans rejet : `validateSim` tolère les champs absents (R10) ; au 1er
  close post-reprise, `closePeriod` recrée `periods: []` et mesure depuis la
  base actuelle (le cumulé antérieur n'est PAS ré-attribué à la période) ;
  `lastPeriod`/`forecast` renvoient `null` tant que rien n'est close.
- **Pas de bump de SAVE_VERSION** (v1 reste) : les champs additifs ne cassent
  pas le format ; la migration D4 n'est pas nécessaire.

## Preuve
- `tests/r16-periods.test.mjs` : **7/7** — état neuf (periods vides + base
  zéro) ; pause ne clôt rien, gros tick ne duplique pas, borne 4 (R14) ;
  reconstitution du net par ses composants (R12) ; net ≈ solde (comptabilité) ;
  sans historique → prévision INDETERMINÉE (null, jamais un faux chiffre) ;
  prévision = tendance de la dernière période (taux + horizon 1 h) ;
  sauvegarde ancienne dégrade proprement au 1er close.
- Suite : **186/186** (`npm run test`, `node --test tests/*.test.mjs`).
- Compatibilité : R10 (validation schéma) inchangée, champs additifs tolérés ;
  les fixtures de migration et les sauvegardes v1 chargent sans rejet.

## Limitation (documentée, non une bug)
- La prévision est une TENDANCE LINÉAIRE (1 période) : elle ne capture ni le
  cycle des incidents (R04) ni les variations de recette (A8) — elle est
  étiquetée « projection, pas une garantie » ; un modèle multi-périodes
  pondéré serait le chemin d'amélioration (hors scope R16).
- La première période d'une partie neuve mesure bien depuis t=0 (base zéro au
  `newSimState`) ; pour une REPRIE post-reprise sans base sauvegardée, elle
  mesure depuis la reprise (dégradation lisible, pas un faux zéro).
