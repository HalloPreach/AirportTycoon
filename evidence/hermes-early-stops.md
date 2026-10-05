# Arrêts prématurés Hermes — classification (t_0aedbeaa, continuation t_b416cb13)

Lecture seule des sources (aucune modif de code). Sources :
- Kanban DB `C:\Users\Lucas\AppData\Local\hermes\kanban.db` (runs 342/343/344 de t_ed681d6a).
- Logs `C:\Users\Lucas\AppData\Local\hermes\logs\agent.log` (actif) + `agent.log.1..3` (rotation 4×50 Mo).
- `errors.log` (mêmes fenêtres).

Note de péremption : l'historique remonte à 2026-09-11 (agent.log.3) — tout antérieur est
éliminé par rotation ; la fenêtre d'intérêt (03/10-05/10) est entièrement couverte par
l'agent.log actif (rotation 4×50 Mo, agent.log couvre 10/02 16:23 → présent).
Mise à jour 05/10 14:00 (t_0aedbeaa, run 354) : rotation postérieure à la rédaction — les
lignes citées ci-dessous (6353-6354, 19565-19566, 21183-21184, 22954-23487) sont désormais
dans agent.log.1 (numéros de ligne inchangés, vérifié en lecture seule).

## Tableau de classification (qui / quand / nature / preuve log)

Nature : (a) GARDE-FOU = guardrail_halt volontaire ; (b) DÉFAUT DE CLÔTURE = le tour se termine
sans signal kanban (ni kanban_complete ni kanban_block ni request_review), le worker CLI sort,
le dispatcher compte "crashed" car pid inactif + tâche non clôturée ; (c) VÉRITABLE CRASH =
exception/faute.

| # | Quand (heure locale) | Session / tâche | Nature | Cause | Preuve log (agent.log actif, ligne) |
|---|---|---|---|---|---|
| 1 | 03/10 05:31:28 | 20261003_051832_da2f2f / t_93b886f9 | (a) garde-fou | read_file bloqué : "same result 5 times" → Turn ended reason=guardrail_halt (api 54/160) | agent.log:6353-6354 |
| 2 | 04/10 04:27:00 | 20261004_031811_083391 / t_1c21c88e | (a) garde-fou | idem, après 397 appels API / 162 tool turns (loop longue de relecture) | agent.log:19565-19566 |
| 3 | 04/10 06:08:54 | 20261004_053316_5c8af3 / t_2194baa9 | (a) garde-fou | idem (200 appels API, 47 tool turns) | agent.log:21183-21184 |
| 4 | 04/10 07:49→07:58 | 20261004_074923_0ff20b / t_ed681d6a (G7, run 342) | (b) défaut de clôture | 3× "Reasoning-only clean stop" (4796/1504/2394 chars) + 2 stop-loop nudges ignorés → Turn ended text_response 07:58:03 (ligne 22987), worker CLI sort proprement (CLI cleanup/memory shutdown 07:58:04, ligne 22994) SANS kanban_complete/block → dispatcher 07:58:26 (ligne 22995) : crashed=1 (pid inactif, tâche non clôturée), respawn | agent.log:22954-22995, DB run 342 |
| 5 | 04/10 07:58→08:19 | 20261004_075827_c8f113 / t_ed681d6a (G7, run 343) | (b) défaut de clôture | 3 stop-loop nudges (08:02:06, 08:05:26, 08:09:54 — lignes 23111, 23163, 23189) ; le modèle reprend du vrai travail (API #41-74, compression contexte 08:11) mais le worker sort à 08:19:06 (CLI cleanup, ligne 23270) SANS ligne "Turn ended" ni appel kanban_complete/block ; notifier 08:19:41 (ligne 23271-23272) : "t_ed681d6a gave up (retries exhausted), crashed (worker exited)" | agent.log:23111-23272, DB run 343 |
| 6 | 04/10 08:20→08:35 | 20261004_082037_313c5c / t_ed681d6a (G7, run 344) | OK (clôture correcte) | dispatcher respawn 08:20:37 (ligne 23300, spawned=1) ; 1 stop-loop nudge 08:34:47 (ligne 23464) puis kanban_complete 08:35:10 (ligne 23472) → run completed | agent.log:23300, 23464-23481, DB run 344 |

## Vérifications négatives (pourquoi ce n'est PAS (c))

- 0 ligne ERROR dans agent.log sur la fenêtre G7 (07:49-08:36) ; les 88 lignes de la fenêtre
  dans errors.log sont des WARNING d'outillage (commandes bloquées, rg regex invalide, LSP
  pyright/tsc WinError 193, MCP discovery retry, terminal retour en erreur) — 0 exception
  de worker dans la fenêtre. Les 2 seules mentions "Traceback" de errors.log sont hors
  fenêtre (10/03 21:07 KeyError r31body.py ; 10/05 10:47 script scratch du worker G7-e
  courant) — aucun lien avec les runs 342/343.
- Pas de timeout max_runtime (runs 342/343 : 9 min / 21 min, bien en dessous de la limite).
- Pas d'OOM (pas de faute mémoire dans les logs).
- DB kanban : runs 342/343 status='crashed' (reason "worker exited / pid not alive"),
  run 344 'completed' — cohérent avec "le process est sorti normalement sans clôturer la
  tâche", pas avec une faute. Le notifier a émis à 08:19:41 « t_ed681d6a gave up
  (retries exhausted), crashed (worker exited) » (agent.log:23271-23272) : c'est la
  sémantique kanban de "worker parti sans clôturer", pas d'un crash mémoire/faute.

## Verdict

1. Les 3 guardrail_halt (#1-3) sont des GARDE-FOUS LÉGITIMES : détection de relecture répétée
   (même résultat 5×) sur read_file → arrêt volontaire du tour. Le mécanisme s'est comporté
   comme prévu (le tour suivant reprenait via bg-review). Conformément à la consigne de la
   carte : NE PAS les désactiver, NE PAS modifier les garde-fous.
2. Les runs 342/343 (#4-5) sont des DÉFAUTS DE CLÔTURE, pas des crashs : le modèle
   (qwen3.8-27b-nvfp4, provider custom) termine le tour en réponse textuelle/réflexion sans
   appeler kanban_complete/kanban_block, en dépit de 2 stop-loop nudges ; le worker CLI
   (mode single-query) sort alors proprement et le dispatcher label "crashed" car la tâche
   n'est pas clôturée. Le même scénario ré-exécuté au run 344 s'est clôturé correctement
   après 1 nudge — le défaut est NON DETERMINISTE (comportement modèle), la boucle de
   mitigation (stop-loop nudge ×2) existe déjà et a fini par porter.
3. Cause racine : comportement du modèle (fin de tour en reasoning-only), pas un bug de code
   ou de config de ce dépôt, et pas le Qwen local (qui n'est pas le modèle des workers :
   provider custom, model qwen3.8-27b-nvfp4, via NInfer localhost:30000). Corriger cela
   exigerait soit de changer le modèle (interdit par la carte : "NE PAS modifier Chat Qwen /
   Qwen-NInfer"), soit de modifier le cœur Hermes (hors périmètre de ce dépôt, et la
   mitigation stop-loop + dispatcher re-queue + heartbeat existantes suffisent : le run 344
   a clos la tâche).
4. VERDICT FINAL : rien à corriger dans le code de AirportTycoon ; la cause des "crashs"
   342/343 est un défaut de clôture non déterministe du modèle (nature b), déjà résolu par
   rejeu au run 344 (completed, kanban_complete 08:35:10). Les garde-fous (nature a) sont
   légitimes et intacts. Aucune modif de code apportée, aucun garde-fou touché.
