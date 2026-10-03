// R27 — AFFECTATION des services aux terminaux : UN module de mesure.
//
// Avant R27, l'existence d'un bâtiment dans UN coin du terrain renforçait
// l'aéroport ENTIER : cleanGates nettoyait toutes les portes, les lances
// comptaient toutes les stations, la salle bagages boostait le check-in
// global. C'est le « bonus implicite dû uniquement à l'existence d'un
// bâtiment dans un coin du terrain » que l'exigence R27 interdit.
//
// La règle : chaque service AU SOL a une AFFECTATION — le terminal qu'il
// dessert (`svc.target`), sérialisée avec l'état. Affectation automatique
// DÉTERMINISTE : le terminal le PLUS PRÊCH (distance point→rectangle entre
// le centre du service et le rectangle du terminal) ; en égalité, le plus
// ANCIEN (id le plus petit). Le joueur change l'affectation (setAssignment)
// : les capacités mesurées de chaque terminal suivent la décision.
// Terminal supprimé : les services qui le servaient sont RÉAFFECTÉS à la
// règle du placement (ou restent inactifs s'il ne reste aucun terminal) —
// motif lisible, jamais d'orphelin en silence.
//
// Migration (exigence : « migrer les anciens services avec une affectation
// expliquée ») : les sauvegardes pré-R27 n'ont pas de champ `target` —
// ensureAssignments les assigne par la règle du placement (déterministe) et
// le nombre de services touchés est retourné (l'UI annonce la migration).
// Appel : deserialize (reprise) ET après build/demolish de terminal.
//
// Les MESURES (ci-dessous) sont l'unique source d'effet : la sim et l'UI
// appellent servicesServingGate / countTypeServing, jamais de re-dérivation.
import { GROUND_SERVICE_TYPES } from '../data/catalog.mjs';

// Le type d'un service n'a de SENS qu'ici : un type CONNU (catalogue) sert ;
// un type inconnu (corruption, future carte) n'a JAMAIS d'effet — pas de
// bonus gratuit dû à un bâtiment que la sim ne comprend pas.
export function serviceTypeKnown(type) {
  return GROUND_SERVICE_TYPES.includes(type);
}

// Le terminal le plus proche de b (distance point→rectangle : 0 si b touche
// ou entre dans le terminal). En égalité : le plus ANCIEN (id ascendant).
// null si aucun terminal (le service part INACTIF — il ne sert personne).
export function nearestTerminal(sim, b) {
  const ts = sim.infra.terminals;
  if (!ts.length) return null;
  const bx = b.x + b.w / 2, by = b.y + b.h / 2;
  let best = null, bestD = Infinity;
  for (const t of ts) {
    const dx = Math.max(Math.abs(bx - (t.x + t.w / 2)) - t.w / 2, 0);
    const dy = Math.max(Math.abs(by - (t.y + t.h / 2)) - t.h / 2, 0);
    const d = Math.hypot(dx, dy);
    if (d < bestD || (d === bestD && t.id < best.id)) { bestD = d; best = t; }
  }
  return best;
}

// La règle du placement : affectation déterministe + `auto = true` (appliquée
// PAR LA SIM, pas le joueur → ensureAssignments peut la réaffecter si le
// target devient inactif/périmé) + migrated (l'UI annonce l'affectation).
function assignTarget(sim, svc) {
  const t = nearestTerminal(sim, svc);
  svc.target = t ? t.id : null; // null = inactif (aucun terminal à servir)
  svc.auto = true;
  svc.migrated = true;
  return svc.target;
}

// Placement NOUVEAU (buildBuilding) : la règle s'applique au moment où le
// service est POSÉ. Pas d'annonce (migrated=false) : c'est la règle du
// placement, pas une migration. S'il n'y a pas de terminal, le service part
// INACTIF (target null, auto=true) : ensureAssignments le réaffectera dès
// qu'un terminal existera.
export function autoAssign(sim, svc) {
  const t = assignTarget(sim, svc);
  svc.migrated = false;
  return t;
}

// Migration + réaffectation : chaque service AU SOL dont l'affectation est
// ABSENTE (sauvegarde pré-R27) ou PÉRIMÉE (auto + target pointant vers un
// terminal supprimé, ou target null alors qu'un terminal existe) reçoit la
// règle du placement (déterministe). Le choix EXPLICITE du joueur
// (auto=false, même target null = « inactif volontaire ») n'est JAMAIS
// écrasé. Idempotent. Retourne le nombre de services touchés (l'UI n'annonce
// QUE s'il y en a — migration lisible, pas de spam à chaque tick).
export function ensureAssignments(sim) {
  if (!sim?.infra?.services?.length) return 0;
  let n = 0;
  for (const svc of sim.infra.services) {
    if (!serviceTypeKnown(svc.type)) continue; // type inconnu : pas de règle
    const known = sim.infra.terminals.some((t) => t.id === svc.target);
    if (svc.target === undefined) { assignTarget(sim, svc); n++; }
    else if (svc.auto && !known) { assignTarget(sim, svc); n++; }
  }
  return n;
}

// Commande du JOUEUR : ré-affecter `serviceId` au terminal `target`
// (null = inactif volontaire : le service reste construit, il sert AUCUN
// terminal — et l'affectation volontaire n'est JAMAIS écrasée, auto=false).
// Retourne true si l'affectation a CHANGÉ (l'UI peut l'annoncer) : la sim
// n'applique aucun effet — la mesure lit le champ (la capacité de chaque
// terminal suit la décision, c'est tout). Garde d'entrée : service inconnu
// ou terminal inexistant → false.
export function setAssignment(sim, serviceId, target) {
  const svc = sim.infra.services.find((s) => s.id === serviceId);
  if (!svc || !serviceTypeKnown(svc.type)) return false;
  if (target != null && !sim.infra.terminals.some((t) => t.id === target)) return false;
  if (svc.target === target) return false;
  svc.target = target;
  svc.auto = false; // choix joueur : ensureAssignments ne le retouche plus
  svc.migrated = false;
  return true;
}

// MESURES par terminal (capacités lues, pas re-dérivées) — la sim les
// consomme, l'UI les affiche :
//   - servicesServingGate(sim, type, gate) : les services du type affectés
//     au terminal de la porte (nettoyage/hangar/carburant — la sim) ;
//   - countTypeServing(sim, type, terminalId) : le comptage brut (l'UI).
// Un service affecté à A ne renforce JAMAIS B (critère R27) — la mesure EST
// la règle.
export function servicesServingGate(sim, type, gate) {
  const tid = gate.terminalId;
  return sim.infra.services.filter((s) => s.type === type
    && serviceTypeKnown(s.type) && s.target === tid);
}
export function countTypeServing(sim, type, terminalId) {
  return sim.infra.services.filter((s) => s.type === type && s.target === terminalId).length;
}

// La VUE pour l'UI (affectation + capacités par terminal). L'UI est FINE :
// elle lit, elle n'écrase pas — la commande est setAssignment (règle dans la
// sim, UI fine).
export function assignmentView(sim) {
  const services = sim.infra.services
    .filter((s) => serviceTypeKnown(s.type))
    .map((s) => ({
      id: s.id, type: s.type, target: s.target ?? null,
      label: s.target == null ? 'inactif'
        : `terminal ${sim.infra.terminals.find((t) => t.id === s.target)?.id ?? '?'}`,
    }));
  const counts = {};
  for (const t of sim.infra.terminals) {
    counts[t.id] = {};
    for (const type of GROUND_SERVICE_TYPES) counts[t.id][type] = countTypeServing(sim, type, t.id);
  }
  return { services, counts };
}
