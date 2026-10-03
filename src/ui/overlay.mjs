// Overlay réseau / capacités (R18) : un écran de diagnostic LECTURE SEULE —
// le MÊME graphe pathfinding ET les MÊMES règles que la simulation :
//   - segments : le MÊME graphe de la sim (sim._graph, reconstruit par
//     rebuildGraph — la même fonction, pas de 2e règle de jonction) ;
//   - porte COUPÉE : gateReachable (infra.mjs, PRIMITIVE RÉUTILISÉE telle
//     quelle — le diagnostic écran = la règle que le planificateur applique)
//     + un avion ACTUELLEMENT bloqué dessus (phase 'blocked') → la rupture
//     se lit directement sur l'écran, pas seulement dans les stats ;
//   - occupation : les segments pris par des avions (ac.seg) + les pistes
//     fermées (incidents.runway.closed) et occupées (phases landing/exit/
//     departure — la MÊME dérivée que runwayBusy dans la sim).
// L'UI ne décide rien : elle ne fait que peindre (règle « UI fine »).
// Toggle touche O (main.mjs), inactif par défaut ; `state.networkOverlay`
// est une PREFERENCE d'affichage : absente d'une sauvegarde ancienne →
// l'overlay reste inactif à la reprise (pas d'état dérivé).
import { rebuildGraph } from '../pathfinding/path.mjs';
import { gateReachable } from '../infra/infra.mjs';
import { runwayClosed } from '../sim/incidents.mjs'; // R32 : la fermeture piste est lue PAR PISTE (attachée)

// Lecture pure de l'état de sim → structure platte pour le rendu.
// Exportée telle quelle : les tests s'appuient sur cette LECTURE (zéro
// DOM) — pas sur le canvas.
//   segs   : une entrée par segment du graphe (taxiway/piste) + occupation
//   gates  : portes { ok : joignable, ac : avion amarré, blocked : avion bloqué }
//   runways: pistes { closed : incident fermeture, busy : avion dessus }
export function overlayState(sim) {
  if (sim._graphDirty) { rebuildGraph(sim); sim._graphDirty = false; }
  const g = sim._graph;
  const segs = [];
  if (g) {
    // Position d'affichage d'un segment = la 1re de ses nœuds du graphe.
    const bySeg = new Map();
    g.nodes.forEach((n) => { if (!bySeg.has(n.seg)) bySeg.set(n.seg, { x: n.x, y: n.y }); });
    const occ = new Set();
    for (const a of sim.aircraft) if (a.seg != null) occ.add(a.seg);
    for (const b of [...sim.infra.taxiways, ...sim.infra.runways]) {
      const o = bySeg.get(b.id);
      if (!o) continue; // segment démolit : plus de nœud dans le graphe
      segs.push({ id: b.id, type: b.type, x: o.x, y: o.y, occupied: occ.has(b.id) });
    }
  }
  const runways = sim.infra.runways.map((r) => ({
    id: r.id,
    // R32 : la fermeture est ATTACHÉE à la piste — lue par actif (runwayClosed),
    // pas un champ global : fermer UNE piste n'affecte PAS l'autre.
    closed: runwayClosed(sim, r.id),
    // La même dérivée que runwayBusy (aircraft.mjs) : usage exclusif par les
    // phases, pas d'état parallèle.
    busy: sim.aircraft.some((a) => a.runwayId === r.id && ['landing', 'exit', 'departure'].includes(a.phase)),
  }));
  const acById = new Map(sim.aircraft.map((a) => [a.id, a]));
  const gates = sim.infra.gates.map((gt) => ({
    id: gt.id,
    size: gt.size,
    ok: gateReachable(sim, gt), // la règle de la sim, telle quelle
    ac: gt.acId ? acById.get(gt.acId) : null,
    // Un avion ACTUELLEMENT bloqué sur cette porte (taxi coupé) : la rupture
    // lisible sur l'écran (phase 'blocked' — la même que doBlocked dans la sim).
    blocked: sim.aircraft.some((a) => a.phase === 'blocked' && a.gateId === gt.id),
  }));
  return { segs, gates, runways };
}

// Le dessinateur canvas — la MÊME signature que les overlays du renderer
// (ctx, cam, viewSize) : le renderer l'appelle chaque frame en jeu.
export function drawNetworkOverlay(ctx, cam, viewSize, sim) {
  const ov = overlayState(sim);
  if (!ov.segs.length) return;
  const z = cam.zoom;
  const p = (x, y) => [
    (x - (cam.x - viewSize.width / 2 / z)) * z,
    (y - (cam.y - viewSize.height / 2 / z)) * z,
  ];
  // Segments : coques (grises) / rouges s'ils sont OCCUPÉS (un avion dessus).
  ctx.lineCap = 'round';
  for (const s of ov.segs) {
    const [x, y] = p(s.x, s.y);
    ctx.beginPath();
    ctx.arc(x, y, (s.occupied ? 5 : 3.5) * Math.min(2, z), 0, Math.PI * 2);
    ctx.fillStyle = s.occupied ? 'rgba(255,82,82,0.85)' : 'rgba(255,255,255,0.45)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // Portes : pastille colorée par l'état RÉSEAU de la porte —
  //   verte  = joignable (gateReachable : la règle de la sim) ;
  //   rouge  = COUPÉE (taxiway absent/coupé) OU avion bloqué dessus.
  for (const gt of ov.gates) {
    if (!gt.ac || gt.ac.x == null) continue; // porte sans avion : la sim la peint déjà
    const [x, y] = p(gt.ac.x, gt.ac.y);
    ctx.beginPath();
    ctx.arc(x, y, 10 * Math.min(2, z), 0, Math.PI * 2);
    ctx.strokeStyle = gt.blocked || !gt.ok ? '#ff5252' : '#69f0ae';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
