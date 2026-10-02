# AC_EXTRAITS — Critères d'acceptation, MVP vs non-MVP, preuves requises

Source : SYNTHESIS_CONTINUATION.md (synthèse de CONTINUATION_BRIEF.md 144 l. +
AUDIT_2026-10-01.md 169 l.), base vérifiée `80a90ab`. Références `AC-n`,
`MVP-n`, `NONMVP-n`, `EV-n` sont les identifiants stables à citer dans le
backlog (t_14c9b7b1). Chaque critère est observable : commande d'exécution,
scénario déterministe ou artefact.

## 1. Critères d'acceptation du brief (numérotés)

### 1.1 Les 13 critères de clôture (Brief § Conditions de clôture)
AC1.  Nouvelle partie = petit aéroport utilisable fourni (piste + terminal
      minimal) — pas le terrain vide constaté. Preuve : scénario « nouvelle
      partie » → avion complet (arrivée→départ) sans construction préalable.
AC2.  Construction ET connexion d'infrastructures supplémentaires ; le réseau
      reste physique (AC14). Preuve : test connecté/déconnecté.
AC3.  Organisation/réception de vols compatibles : planning consultable
      (compagnie, appareil, passagers, horaires prévus/réels, état, retard,
      cause) + décision d'acceptation/refus. Preuve : UI + test d'attribution.
AC4.  Avions approchent, atterrissent, rejoignent RÉELLEMENT la porte puis
      repartent (AC18). Preuve : trace position/tick d'un vol complet.
AC5.  Conflits multi-vols sans double réservation (AC15). Preuve : test
      identifiants distincts, invariants après chaque tick.
AC6.  Retards explicables par une mauvaise conception, puis réduits par une
      amélioration. Preuve : scénario A/B (coupé vs agrandi) avec mesures.
AC7.  Passagers avec capacités/files/services significatifs (groupes agrégés,
      pas un simple total transporté). Preuve : files + saturation mesurables.
AC8.  Revenus ET dépenses visibles ; rentable OU déficite possible. Preuve :
      bilan financier + scénario déficit/faillite + scénario rentable.
AC9.  Agrandissements + déblocages d'améliorations utiles (pas des verrous
      bloquants). Preuve : au moins 2 déblocages avec effet jouable.
AC10. Sauvegarde pendant une activité réelle (vols en taxi, service occupé).
AC11. Quitter et fermer la page sans crash.
AC12. Réouverture : rechargement de la sauvegarde.
AC13. Continuité sans perte de vols, réservations, files, services, finances.

### 1.2 Les 5 exigences incontournables (Brief § Première priorité)
AC14. Connectivité physique : aucun chemin dans le vide/bâtiment ; porte
      distante non reliée automatiquement ; coupure réelle = blocage des
      routes concernées ; portes à destination ET accès explicites.
      Preuve : A1/A2 reproduits puis corrigés (test négatif anti-chemin hors
      taxiway).
AC15. Réservations exclusives : attribution atomique, libération sûre ; deux
      demandes au même tick ne prennent pas la même ressource ; landing et
      departure ne partagent pas la piste ; attentes équitables ; blocages
      persistants traités sans croissance infinie (A5/AC17).
      Preuve : A3/A4/A5 reproduits puis corrigés (invariants de réservation).
AC16. Changements d'infra sûrs : aucune référence orpheline ni index périmé ;
      démolition dangereuse refusée ou réaffectation explicite ; TOUTES les
      portes du terminal vérifiées ; si aucun chemin → blocage expliqué,
      pas de crash. Preuve : A6/A7 reproduits puis corrigés.
AC17. Compatibilité réalisable : chaque catégorie jouable servie par des
      infrastructures accessibles au bon stade (porte/piste L constructible ou
      vols L explicitement limités) ; aucun gros avion bloqué indéfiniment.
      Preuve : A8/A13 reproduits puis corrigés (scénario seed 42 : blocages
      finis, satisfaction non à 0 %).
AC18. Déplacement continu : aucun saut de position (alignement, quai,
      pushback) ; position réelle conservée ; orientation/phase lisibles.
      Preuve : A9 reproduit puis corrigé (delta position max par tick borné).

### 1.3 Mécaniques (Brief § Achever les mécaniques)
AC19. Persistance : sauvegarde manuelle + auto ; reprise après fermeture/
      réouverture ; `serialize` ne modifie pas la partie ; schéma/types/
      identifiants/références validés ; caches dérivés reconstruits ; sauvegarde
      invalidée préservée pour diagnostic ; incompatibilité annoncée sans crash.
      Preuve : A10/A11 reproduits puis corrigés + tests fichiers malformés,
      versions incompatibles, phases actives.
AC20. Cycle avion complet (approche→attente→autorisation→atterrissage→sortie
      →taxi→porte→débarquement→services→embarquement→pushback→taxi→attente→
      autorisation→décollage) + planning pilotable (pas un générateur
      aléatoire invisible) + attribution compatible/disponible/accessible avec
      alternatives. Preuve : trace de phases d'un vol + test de planification.
AC21. Services au sol opérationnels (carburant, nettoyage, bagages,
      maintenance) : disponibilité, capacité/temps, coût, effet sur le vol ;
      absence/saturation = attente expliquée ou issue gérée ; aucun bâtiment
      coûtant sans servir ; besoins liés taille/état de l'avion ; déblocages
      non bloquants. Preuve : test saturation service → retard mesurable.
AC22. Passagers en groupes agrégés : capacité terminal, check-in, sécurité,
      attente, débarquement, embarquement, bagages ; capacités/attente
      influencent vols et satisfaction ; groupes associés à un vol/terminal
      sans double comptage ; files visibles ; satisfaction évolutive (un
      retard ancien ne condamne pas indéfiniment). Preuve : test saturation
      files + évolution satisfaction après correction.
AC23. Économie : recettes/dépenses/investissements/remboursements séparés ;
      coût d'exploitation d'infra/services (même sans vol) ; carburant =
      dépense (pas recette négative) ; bilan par période avec causes du
      déficit ; un aéroport bien équipé peut être rentable ET un aéroport
      surdimensionné/sous-équipé peut perdre. Preuve : A12 reproduit puis
      corrigé + scénarios déficit/faillite et rentable.
AC24. Interface réellement pilotable : caméra/zoom/construction/démolition/
      pause/vitesse conservés ; + sélection/inspection avion et bâtiment,
      liste de vols/planning, bilan financier, statistiques, historique
      d'alertes (causes + action) ; capacités/occupations visibles ;
      diagnostic réseau coupé et service saturé depuis l'UI ; cliquer/glisser
      caméra ne construit pas ; raccourcis compatibles formulaires.
      Preuve : QA CDP entrées réelles (AC27) couvrant ces interactions.
AC25. Tests : scénarios déterministes (seed), invariants vérifiés APRÈS CHAQUE
      TICK, tests qui ÉCHOUENT si la sim manque (pas de succès silencieux),
      tests de régression qui échouent pour la bonne raison sur le défaut
      avant correction. Preuve : exécution `node --test tests/*.test.mjs`.
AC26. Couverture minimale (Brief § Validation) :
      (a) réseau connecté/déconnecté, coupe en cours de taxi, routes
      alternatives, suppression occupée, références réaffectées ;
      (b) demandes simultanées piste/porte/segment, séquence arrivée-départ,
      libération après incident ;
      (c) plusieurs identifiants distincts arrivés/partis, comptes conservés,
      sans multi-comptage d'un même état final ;
      (d) catégories compatibles/incompatibles, absence piste/porte ;
      (e) capacité terminal, files, saturation services, manque carburant,
      maintenance, retards et récupération ;
      (f) coût d'exploitation sans vol, construction/démolition, revenus,
      déficit/faillite, scénario rentable ;
      (g) sauvegarde/reprise multi-phases (taxi, service occupé), fichiers
      malformés, types invalides, références absentes, versions
      incompatibles ;
      (h) pause, vitesses, stabilité des résultats, comportement prolongé sans
      accumulation inexpliquée ni blocage permanent.
AC27. Validation par exécution : lancer réellement le jeu après chaque
      milestone ; validation FINALE = parcours complet via entrées
      utilisateur réelles (clics, touches, commandes UI) — pas d'injection
      d'état via `window.__game`. Preuve : run QA CDP headless + capture.
AC28. Observation : visuel, erreurs de console collectées, absence de
      requêtes vers l'extérieur pendant le fonctionnement (sans toucher au
      pare-feu). Preuve : logs réseau/console + capture visuelle.
AC29. Scénario prolongé automatisé : plusieurs journées simulées (ou charge
      équivalente) avec mesures débit vols, attentes, blocages, finances,
      population d'objets ; + session de rendu réel assez longue ; durées
      simulées et réelles TOUJOURS indiquées séparément ; jamais présenter
      une boucle accélérée en mémoire comme des heures observées.
AC30. PROGRESS.md maintenu (état backlog, preuves, décision, problème ouvert,
      prochaine tâche bornée) après chaque milestone et avant toute
      interruption.
AC31. Rapport final ou d'interruption : interruptions, révisions
      départ/fin, architecture finale, backlog + nombre réel de cartes
      terminées, fonctionnalités validées, bugs reproduits/corrigés,
      commandes de test + résultats, chemins des preuves, bilan scénario
      prolongé et sauvegarde/reprise, limites connues + exigences
      incomplètes, ce qui a été réellement délégué + revues indépendantes.
      Un bilan honnête prime sur un « complet » non démontré.
AC32. Organisation : backlog borné auto-construit (pas de carte colossale ni
      une carte par ligne du brief) ; implémentation substantielle dans
      subagents `delegate_task` à contexte frais ; reviewer indépendant pour
      les étapes critiques ; concurrence inchangée (pas de workers
      supplémentaires ni NInfer) ; aucun profil permanent/routeur/harness/
      daemon/framework agentique ; aucune modification de Chat Qwen, SOUL,
      configs Hermes, modèle local/runtime/provider.
AC33. Méthode : REPRODUIRE d'abord chaque défaut de l'audit (A1..A14) via
      les probes du dossier d'audit AVANT correction ; ajouter les tests de
      régression métier (échouant pour la bonne raison) puis vérifier la
      correction ; ne jamais garder une assertion trompeuse pour rester vert.
AC34. Préservation : base `80a90ab` ; pas de réécriture intégrale ni de
      changement de stack sans problème concret ; les modifications
      utilisateur et parties utiles préservées ; structure modulaire et
      stack Canvas 2D vanilla 0 dépendance npm conservées.
AC35. Continuité : révision relevée au lancement ; point de reprise précis ;
      pas de fermeture artificielle des cartes restantes ; limitation
      d'itérations/crash ≠ réussite (diagnostic conservé, périmètre réduit,
      reprise native, pas de boucle identique).
AC36. Local/offline : aucun LLM, API IA, serveur externe, CDN, cloud ni
      compte requis par le jeu au runtime (serveur statique `127.0.0.1`
      autorisé). Preuve : EV-net.
AC37. Interdiction de clôture précoce : ne PAS conclure sur le passage des
      anciens 36 tests + 17 contrôles ; ne PAS inscrire passagers/services/
      conflits/interfaces manquants dans « améliorations futures » pour
      justifier une clôture.

### 1.4 Contraintes de contenu (rappels testables)
AC38. Départ : petit terrain + une piste + un terminal minimal utilisables
      (cf. A-2 : le brief penche pour un aéroport de départ Fourni — décision
      à trancher au backlog). Agrandissement par infrastructures ; pas de
      système d'achat de terrain imposé.
AC39. Catégories d'avions + compagnies à effet COHÉRENT sur besoins et
      traitement (pas cosmétique) ; fret et correspondances OPTIONNELS
      (explicitement non obligatoires).
AC40. Passagers : simulation agrégée acceptée ; simple total transporté
      INTERDIT (cf. AC22).

## 2. MVP (noyau minimal à faire tourner)
Le MVP = les 5 exigences incontournables + le cycle spatial + la persistance
+ l'économie de base + la validation réelle. Tout ce qui n'est pas MVP-n
ci-dessous est exigé pour la COMPLETION mais vient APRÈS le MVP (ordre du
Brief § Première priorité + Audit § Travail recommandé, axes 3-5).

MVP-1. AC1/AC38 : nouvelle partie avec aéroport de départ utilisable
       (piste + terminal minimal) — corrige l'écart « terrain vide ».
MVP-2. AC14 : connectivité physique (R1 : A1, A2) + test négatif.
MVP-3. AC15 : réservations exclusives (R2 : A3, A4, A5) + invariants/tick.
MVP-4. AC16 : infrastructures sûres (R3 : A6, A7) — crash bloquant.
MVP-5. AC17 : compatibilité réalisable (R4 : A8, A13) — porte/piste L ou
       limitation explicite des vols L ; plafond d'arrivées compte les
       `blocked` ; croissance des recettes stoppée si satisfaction 0 %.
MVP-6. AC18 : déplacement continu (R5 : A9) — cycle spatial complet (AC20).
MVP-7. AC19 : persistance validée (R6 : A10, A11) — critères AC10-AC13.
MVP-8. AC23 base : coût d'exploitation + carburant en dépense + bilan
       recettes/dépenses (R8 : A12).
MVP-9. AC25/AC26 + AC33 : tests de régression pour R1-R6 (échec pour la
       bonne raison avant correction) ; R7 : nettoyage des faux positifs
       existants (A14, tests retournant silencieusement, comptage multi-tick).
MVP-10. AC27/AC28 : QA CDP par entrées réelles + absence requêtes externes +
       erreur de console — le MVP n'est valide QUE par exécution.

## 3. Exigences non-MVP (complétion, après le MVP)
NONMVP-1. AC21 : services au sol à effet réel (carburant/nettoyage/bagages/
           maintenance opérationnels, saturation mesurable) — Brief : après
           fondations fiables (Audit axe 3).
NONMVP-2. AC22/AC40 : parcours passager agrégé complet (capacités, check-in,
           sécurité, files, bagages, satisfaction évolutive) — Audit axe 3.
NONMVP-3. AC20/incidents : incidents opérationnels limités mais réels
           (perturbation, réaction, conséquences, récupération) — A-7 :
           APRÈS les fondations, pas de collection de pannes (Audit axe 3).
NONMVP-4. AC9/AC23 : déblocages/progression utiles multi-étapes + économie
           profonde (scénarios déficit/faillite vs rentable, bilan par
           période, conséquences retards/incidents/satisfaction) — Audit axe 4.
NONMVP-5. AC24 : interface de gestion complète (inspection avion/bâtiment,
           planning/liste de vols, bilan financier, stats, historique
           d'alertes avec action, diagnostic réseau coupé/service saturé) —
           Audit axe 4.
NONMVP-6. AC29 : scénario prolongé + session de rendu longue + reprise après
           réouverture — Audit axe 5, phase de clôture.
NONMVP-7. AC31 : rapport final complet — clôture.
NONMVP-8. AC3 : planning consultable + décision d'organisation des vols
           (si le MVP se contente de l'attribution sûre) — trancher au
           backlog ; le brief l'attend avant clôture.
NONMVP-9. Fret / correspondances : OPTIONNELS (AC39, D4) — ne pas imposer ;
           n'entrent dans ni MVP ni completion obligatoire.

Rappel dur (AC37) : NONMVP-1..5 ne sont PAS des « améliorations futures »
acceptables pour clore — ils sont exigés avant la clôture. La distinction
MVP/completion est une question d'ORIENTATION, pas d'obligation : le MVP
sécurise la base (MVP-1..10), la complétion exige NONMVP-1..8.

## 4. Preuves requises (EV-n)
EV-1. Reproductions A1..A14 : exécution des probes AVANT correction,
      résultats persistés (dossier audit :
      `C:\Users\Lucas\Documents\Codex\2026-09-14\je-veux-changer-mon-mod-le\audit-airport`
      — `probes.mjs`, `probe-test-multivols.mjs`, `probes-resultats.json`).
      Format : sortie machine (JSON/console) horodatée par commit.
EV-2. Tests de régression : `node --test tests/*.test.mjs` — chaque défaut
      corrigé (R1-R8) a un test qui ÉCHOUAIT avant correction (bonne raison)
      et passe après. Validation : sortie complète, 0 échec.
      (A-4 : le lanceur `npm test` est cassé dans cet environnement —
      `npm-cli.js` introuvable ; `node --test` est la source de vérité,
      `package.json` `npm run test` comme référence.)
EV-3. QA CDP headless par entrées réelles : scénario complet (construction,
      vols, conflits, sauvegarde/reprise, finances) via clics/touches/
      commandes UI — aucune injection `window.__game` pour la validation
      finale (AC27). Artefacts : script + sortie + captures dans `evidence/`.
EV-4. Scénario prolongé : mesures (débit vols, attentes, blocages, finances,
      population d'objets) en fichier JSON + durées simulées/réelles séparées
      (AC29, A-9 : documenter la conversion — ex. facteur de temps, jamais
      présenter la boucle mémoire comme du temps réel).
EV-5. Réseau : preuve d'ABSENCE de requêtes externes pendant le
      fonctionnement (logs réseau navigateur, sans modification du pare-feu)
      (AC36, AC28).
EV-6. Console/visuel : log d'erreurs de console (à vide ou trié) + captures
      du jeu en cours dans `evidence/` (AC28).
EV-7. PROGRESS.md (AC30) : état backlog, preuves obtenues, décision,
      problème ouvert, prochaine tâche bornée — mis à jour après chaque
      milestone et avant interruption.
EV-8. Rapport final/interruption (AC31) : contenu listé en AC31, avec
      chemins des preuves EV-1..7 ; honnêteté : limites connues + exigences
      encore incomplètes, ce qui a été réellement délégué + revues
      indépendantes ; jamais fabriquer nombre d'agents ni preuve.
EV-9. Invariants par tick : assertions post-tick dans les tests (réservation,
      position, comptes passagers, trésorerie) (AC25).
EV-10. Déterminisme : seed documenté par scénario ; état du générateur
      aléatoire conservé dans la sauvegarde pour reproductibilité (AC25, AC19).

## 5. Ambiguïtés à trancher par le backlog (cf. SYNTHESIS § 6)
A-1 seuil FPS/durée « assez long » ; A-2 aéroport de départ fourni ou à
construire (brief penche fourni → trancher ici) ; A-3 grain des cartes (à
la discrité d'Hermes) ; A-4 validateur = `node --test` (à confirmer) ;
A-5 blocages persistants : annuler, détourner ou compter (choix à écrire
dans la carte) ; A-6 comptabilité carburant (compte dédié vs recette
négative — brief exige « dépense ») ; A-7 incidents après fondations
(ordre figé ici : NONMVP-3 après MVP-10) ; A-8 mécanisme de revue
indépendante (carte reviewer via `kanban_create`) ; A-9 conversion durées
simulées/réelles (à documenter dans chaque preuve EV-4).
