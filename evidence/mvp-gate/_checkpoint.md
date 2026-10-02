# BL-11 checkpoint (run 224)
Section 1 (serveur + Edge CDP + eval/CDP helpers) deja OK dans qa/mvp-gate.mjs.
Contrat UI lu : N/R au menu, B/X/1-5, S/L, P/Q, fleches (pan), wheel (zoom).
Plan scenario (toutes entrees REELLES, observation read-only) :
  1. load menu -> key 'n' -> screen game
  2. build : 'b' + '2' + pan ArrowDown + clic souris taxiway (850,1050)
  3. vols : 'f' x4 -> attendre flight-out + totalCarried > 0
  4. conflits : preuve holding/blocked/delayed
  5. finances : revenue > 0
  6. 'q' -> menu (autosave), Page.reload, 'r' -> game (graph null)
  7. 'p' (pause, le 1er tick ne reconstruit PAS _graph) + 'x' + clic taxiway
     -> demolishBuilding avec _graph null : null-guard (d43b290) -> AUCUNE exception
  8. EV-5/EV-6 : Network events tous 127.0.0.1, 0 console error, 0 exception page
Ecrits progressifs dans evidence/mvp-gate/ (rapport.txt + rapport.json + PNG).
