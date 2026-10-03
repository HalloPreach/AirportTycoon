// Panneaux NONMVP-5 : les 5 panneaux manquants — inspection avion + bâtiment
// (clic sur la carte), bilan financier détaillé, statistiques, historique
// d'alertes, diagnostic réseau (coupé / saturation). UI FINE : on ne lit que
// l'état + les getters purs EXISTANTS (economy.periodStatement, path.findPath)
// — aucune règle n'est ajoutée, aucune mutation de la sim (le panneau réseau ne
// reconstruit JAMAIS le graphe : avant le 1er tick il est null et c'est voulu,
// R3/A7 — on le dit, on ne le fabrique pas). Pattern de planning-panel : DOM
// fixe créé une fois, la zone de contenu se reconstruit seulement quand la
// signature change (les éléments ne disparaissent pas sous la souris, les
// clics ne partent pas).
import { periodStatement, lastPeriod, forecast } from '../economy/economy.mjs';
import { findPath, runwayExitNode } from '../pathfinding/path.mjs';
import { AIRCRAFT, AIRLINES, BUILDINGS, opexPerMin, opexPerHour, GROUND_SERVICE_TYPES } from '../data/catalog.mjs';
// R17 (t_fc0d1920) : la cause du retard est LUE (causeAt, aircraft.mjs) — le
// panneau ne recalcule rien, il traduit (DELAY_CAUSE_FR) ; la ponctualité
// (fenêtre bornée, dénominateur clair) vient de punctualityStats (id.).
import { causeAt, DELAY_CAUSE_FR, DELAY_WINDOW_S, punctualityStats } from '../sim/aircraft.mjs';
// R22 (t_00318fe0) : les objectifs de progression + récompense payée UNE fois —
// le panneau est une LECTURE (objectiveView) : il ne décide rien, il affiche
// l'état (à venir / atteinte / payée) et la mesure live du critère.
import { OBJECTIVES, objectiveView } from '../progression/objectives.mjs';
// R24 (t_f712f1a5) : les contrats de compagnie — LECTURE (contractView) + les
// COMMANDES de décision (decideContract/cancelContract) : la sim règle la
// prime/pénalité (tickContracts), le panneau ne décide que par ces portes.
import { contractView, decideContract, cancelContract, contractCapable } from '../flights/contracts.mjs';
import { pendingCap } from '../flights/flights.mjs'; // R26 : le plafond d'arrivées est un PARAMÈTRE de la sim (borné) — le panneau le lit, pas un nombre en dur
import { qualityView } from '../progression/quality.mjs'; // R26 : la qualité des offres (palier + mesure R17)
import { unlockView } from '../infra/unlocks.mjs';
// R27 (t_6424937a) : l'affectation des services aux terminaux — LECTURE
// (assignmentView : affectation + capacités par terminal, la sim est la
// source) + COMMANDE (setAssignment : le joueur change l'affectation, la règle
// est dans la sim, le panneau émet l'intention).
import { assignmentView, setAssignment } from '../infra/assignments.mjs';

const PHASES_FR = Object.freeze({
  approach: 'approche', holding: 'attente', landing: 'atterrissage', exit: 'sortie de piste',
  taxi: 'taxi', docking: 'amarrage', gate: 'au sol', refuel: 'carburant',
  disembark: 'désbarquement', ground: 'au sol', board: 'embarquement',
  pushback: 'poussée', departure: 'décollage', blocked: 'bloqué',
  departed: 'parti', cancelled: 'annulé',
});
// R07 : la CAUSE lisible d'un retard, lue de la phase (pas de règle de sim ici —
// le panneau ne recalcule rien, il traduit). holding = la piste qu'il visait
// est occupée (conflit de ressource, A4) ; blocked = aucun chemin (taxiway coupé
// ou porte indisponible, A-5) ; les autres phases n'ont pas de retard actif.
const CAUSE_FR = Object.freeze({
  approach: 'descente vers la piste',
  holding: 'piste occupée ou fermée — attente (conflit de ressource)',
  landing: 'roulage sur la piste',
  exit: 'sortie de piste vers une porte',
  taxi: 'taxi (segment occupé en avant)',
  docking: 'amarrage à la porte',
  gate: 'au sol (pas de retard actif)',
  refuel: 'avitaillement',
  disembark: 'désbarquement',
  ground: 'au sol (pas de retard actif)',
  board: 'embarquement',
  pushback: 'poussée (piste ou segment occupé)',
  departure: 'décollage',
  blocked: 'bloqué — taxiway coupé ou porte indisponible (retry, annulation A-5 à 10 min)',
  departed: 'parti',
  cancelled: 'annulé',
});
// R26 : le plafond d'arrivées est un PARAMÈTRE de la sim (pendingCap,
// flights.mjs — borné [MAX_PENDING, PENDING_CAP_MAX]) : le panneau le LIT,
// la constante dupliquée est supprimée (le panneau ne peut plus diverger).

function fmtClock(t) {
  const s = Math.max(0, Math.floor(t || 0));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function money(v) { return `${Math.round(v || 0).toLocaleString('fr-FR')} $`; }
function line(parent, label, value, kind) {
  const d = document.createElement('div');
  d.className = 'pline' + (kind ? ` pline--${kind}` : '');
  const l = document.createElement('span');
  l.textContent = label;
  d.append(l, document.createTextNode(value));
  parent.appendChild(d);
}

// Section : titre + zone. refresh(sigOf, paint) reconstruit la zone UNIQUEMENT
// si la signature a changé (sinon DOM stable, comme planning-panel).
function makeSection(parent, cls, title) {
  const box = document.createElement('section');
  box.className = cls;
  const h = document.createElement('h4');
  h.textContent = title;
  const body = document.createElement('div');
  box.append(h, body);
  parent.appendChild(box);
  let sig = null;
  return {
    refresh: (sigOf, paint) => {
      const s = sigOf();
      if (s === sig) return;
      sig = s;
      paint(body);
    },
  };
}

export function makePanels({ state, camera, viewSize, buildTool }) {
  const col = document.createElement('div');
  col.className = 'panels';
  col.setAttribute('role', 'complementary');
  col.setAttribute('aria-label', 'Panneaux de consultation (inspection, finances, stats, alertes, réseau)');
  document.body.appendChild(col);

  // --- 1. Inspection avion + bâtiment (clic sur la carte) -------------------
  const inspect = makeSection(col, 'panel', 'Inspection — clic sur la carte');
  let pick = null; // { kind: 'ac' | 'bldg', id } — rendu live (l'objet peut partir)
  function refreshInspect() {
    inspect.refresh(
      // R07 : la signature EST l'état de l'objet suivi (phase, pax, position
      // arrondie, porte, piste, retard). Chaque tick, si quelque chose bouge la
      // signature change → le DOM du panneau est reconstruit avec les valeurs
      // fraîches. Objet disparu → signature 'none' (rendu « parti/démoli »).
      () => {
        if (!pick || !state.sim) return 'none';
        const sim = state.sim;
        if (pick.kind === 'ac') {
          const ac = sim.aircraft.find((a) => a.id === pick.id);
          if (!ac) return 'none';
          return [ac.phase, ac.pax, Math.round(ac.x), Math.round(ac.y), ac.gateId, ac.runwayId, Math.round(ac.delayed), causeAt(sim, ac)].join('|');
        }
        const find = (arr) => (arr || []).find((b) => b.id === pick.id);
        const b = find(sim.infra.runways) || find(sim.infra.taxiways)
          || find(sim.infra.terminals) || find(sim.infra.services);
        if (!b) return 'none';
        // R27 : la signature d'un SERVICE inclut l'affectation (target + auto)
        // — le panneau se reconstruit quand le joueur la change (pas de vieux
        // affichage). Les autres bâtiments sont statiques (une seule valeur).
        if (GROUND_SERVICE_TYPES.includes(b.type)) return `bldg:${pick.id}:${b.target ?? 'n'}:${b.auto ? 'a' : 'j'}`;
        return `bldg:${pick.id}`; // les bâtiments ne bougent pas : une seule valeur
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!pick || !sim) {
          line(body, '', 'Cliquez sur un avion ou un bâtiment.');
          return;
        }
        if (pick.kind === 'ac') {
          const ac = sim.aircraft.find((a) => a.id === pick.id);
          if (!ac) { line(body, `Avion #${pick.id}`, 'parti — plus en simulation'); return; }
          const spec = AIRCRAFT[ac.acType] || {};
          const airline = (AIRLINES.find((x) => x.id === ac.airline) || { name: ac.airline }).name;
          // R17 : la CAUSE DU RETARD est LUE (causeAt) — quand l'avion est en
          // retard, on affiche le GOUTOU qui le retient (piste/porte/segment/
          // carburant/passagers) ; sinon la phase courante (R07).
          const delayed = ac.delayed > 0;
          const cause = delayed ? (DELAY_CAUSE_FR[causeAt(sim, ac)] || `goulot ${causeAt(sim, ac) || '?'}`)
                               : (CAUSE_FR[ac.phase] || ac.phase);
          line(body, `Avion #${ac.id}`, `${airline} · ${spec.name || ac.acType}`);
          line(body, 'Phase', `${PHASES_FR[ac.phase] || ac.phase}${delayed ? ` (retard ${Math.round(ac.delayed)} s)` : ''}`);
          if (delayed) line(body, 'Cause du retard', cause, 'warn');
          else line(body, 'État', cause);
          line(body, 'Passagers', `${ac.pax} pax`);
          if (ac.gateId) line(body, 'Porte', ac.gateId);
          if (ac.runwayId) line(body, 'Piste', ac.runwayId);
          line(body, 'Ressource attendue', spec.gate ? `porte ${spec.gate}` : (ac.runwayId ? `piste ${ac.runwayId}` : '—'));
          line(body, 'Position', `${Math.round(ac.x)}, ${Math.round(ac.y)}`);
        } else {
          const find = (arr) => (arr || []).find((b) => b.id === pick.id);
          const b = find(sim.infra.runways) || find(sim.infra.taxiways)
            || find(sim.infra.terminals) || find(sim.infra.services);
          if (!b) { line(body, `Bâtiment #${pick.id}`, 'démoli — plus en simulation'); return; }
          const def = BUILDINGS[b.type] || { name: b.type, sellRefund: 0 };
          line(body, `${def.name} #${b.id}`, `${b.w}×${b.h} px`);
          line(body, 'Coût d’origine', money(b.cost));
          line(body, 'Remboursement démolition', money((b.cost || 0) * def.sellRefund));
          // R15 : l'exploitation est nommée en $/min ET $/h — le /min affiché
          // EST le débit constaté sur 60 s de jeu (la sim débite opexPerMin sur
          // 60 s de jeu ; les chiffres viennent d'OPEX_PER_SEC via les accès).
          const pm = opexPerMin(b.type), ph = opexPerHour(b.type);
          if (pm > 0) line(body, 'Exploitation', `${money(pm)} /min · ${money(ph)} /h`);
          // R27 (t_6424937a) : service au sol — AFFECTATION visible (terminal
          // desservi + capacité = portes du terminal, coût d'exploitation au
          //-dessus) + COMMANDE du joueur pour la CHANGER (setAssignment : la
          // règle est dans la sim, le panneau émet l'intention — UI fine).
          if (GROUND_SERVICE_TYPES.includes(b.type)) {
            const term = sim.infra.terminals.find((t) => t.id === b.target);
            const nGates = (tid) => (sim.infra.gates || []).filter((g) => g.terminalId === tid).length;
            const gates = term ? nGates(term.id) : 0;
            line(body, 'Affectation', b.target == null
              ? (b.auto ? 'inactif (aucun terminal à servir)' : 'inactif (choix joueur)')
              : `terminal ${term.id} — auto${b.auto ? '' : ', modifié'}`,
                b.target == null ? 'warn' : '');
            line(body, 'Desservi', term ? `les ${gates} porte(s) du terminal ${term.id}` : "aucun terminal — le service n'a pas d'effet");
            line(body, 'Capacité', `soutient ${gates} porte(s)${b.type === 'fuel' ? ` · ${gates} lance(s) de plein` : ''}`);
            // R29 (t_9842f7a3) : usure + activité + effet attendu de l'équipe —
            // LECTURE seule de sim._teamActivity (la sim l'écrit à chaque tick,
            // cleanGates). Débit limité : le budget d'intervention est PARTAGÉ
            // (pas de réduction globale), priorité = la porte la plus usée d'abord.
            if ((b.type === 'cleaning' || b.type === 'hangar') && term) {
              const act = sim._teamActivity?.[b.type]?.[term.id];
              const teams = act ? act.teams : 0;
              const field = b.type === 'hangar' ? 'maintenance' : 'cleaning';
              const served = act?.servedGate ? sim.infra.gates.find((g) => g.id === act.servedGate) : null;
              const wearLabel = served ? ` · usure courante ${Math.round(served[field] ?? 0)}` : '';
              line(body, 'Équipes', `${teams} — débit limité, priorité : la porte la plus usée d'abord${wearLabel}`);
              line(body, 'Activité', act && act.servedGate
                ? `porte ${act.servedGate} · ${act.drain.toFixed(1)} usure retirée / ${act.budget.toFixed(1)} budget`
                : (teams ? 'toutes propres (aucune usure en cours)' : 'aucune équipe — usure en stagnation'),
                teams ? '' : 'warn');
            }
            // Changer l'affectation : UNE commande (setAssignment) — la mesure
            // (servicesServingGate) suit la décision au prochain tick, jamais
            // le contraire.
            const sel = document.createElement('select');
            const opts = [{ v: null, l: 'Inactif' }, ...sim.infra.terminals.map((t) => ({ v: t.id, l: `Terminal ${t.id} (${nGates(t.id)} portes)` }))];
            for (const o of opts) {
              const op = document.createElement('option');
              op.value = o.v == null ? '' : String(o.v);
              op.textContent = o.l;
              if (String(b.target ?? '') === (o.v == null ? '' : String(o.v))) op.selected = true;
              sel.appendChild(op);
            }
            sel.setAttribute('aria-label', `Changer l'affectation du service #${b.id}`);
            sel.addEventListener('change', () => {
              if (!state.sim) return;
              setAssignment(state.sim, b.id, sel.value === '' ? null : Number(sel.value));
            });
            body.appendChild(sel);
          }
          if (b.type === 'runway') line(body, 'Longueur', `${b.len} px`);
          if (b.type === 'terminal') {
            const gates = (sim.infra.gates || []).filter((g) => g.terminalId === b.id);
            line(body, 'Portes', gates.map((g) => `${g.id} (${g.size}${g.acId ? ` · avion #${g.acId}` : ''})`).join(' · ') || 'aucune');
          }
        }
      },
    );
  }

  // Clic sur la carte : avion (rayon ~30 px écran) puis bâtiment (rect).
  // L'outil de construction/démolition garde la priorité s'il est actif (son
  // propre click listener gère la pose/démolition).
  const canvas = document.querySelector('#game');
  canvas.addEventListener('click', (e) => {
    if (buildTool && buildTool.isActive()) return; // le clic est géré par l'outil
    if (state.screen !== 'game' || !state.sim) return;
    const v = viewSize();
    const wx = camera.screenToWorldX(e.offsetX, v.width);
    const wy = camera.screenToWorldY(e.offsetY, v.height);
    const sim = state.sim;
    const r = 30 / state.camera.zoom; // rayon d'inspection en unités MONDE (le zoom compte)
    const ac = sim.aircraft.find((a) => Math.abs(a.x - wx) <= r && Math.abs(a.y - wy) <= r);
    if (ac) { pick = { kind: 'ac', id: ac.id }; return; }
    const b = [...sim.infra.runways, ...sim.infra.taxiways, ...sim.infra.terminals, ...sim.infra.services]
      .find((x) => wx >= x.x && wx <= x.x + x.w && wy >= x.y && wy <= x.y + x.h);
    pick = b ? { kind: 'bldg', id: b.id } : null;
  });

  // --- 2. Bilan financier détaillé (surfacer economy.periodStatement) -------
  const fin = makeSection(col, 'panel', 'Bilan financier');
  function refreshFin() {
    fin.refresh(
      () => {
        const sim = state.sim;
        return sim ? JSON.stringify(periodStatement(sim)) : 'none';
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        const s = periodStatement(sim); // LE bilan existant (economy.mjs) — rien à recalculer
        line(body, 'Solde', money(s.money), s.money < 0 ? 'bad' : 'good');
        line(body, 'Résultat', money(s.net), s.net < 0 ? 'bad' : 'good');
        line(body, 'Recettes', money(s.revenue));
        line(body, 'Exploitation', `−${money(s.opex)}`);
        line(body, 'Carburant', `−${money(s.fuel)}`);
        line(body, 'Indemnités vols annulés', `−${money(s.compensation)}`);
        line(body, 'Investissements', `−${money(s.invest)}`);
        if (s.debt > 0) line(body, 'Dette (intérêts)', money(s.debt));
        // R16 : période récente + prévision (cumuls ci-dessus = toute la partie,
        // la période = les 5 dernières minutes de jeu ; les deux sont distincts).
        const lp = lastPeriod(sim);
        if (lp) {
          line(body, `Période ${Math.round(lp.minutes)} min (net)`, money(lp.net), lp.net < 0 ? 'bad' : 'good');
          const f = forecast(sim);
          if (f) {
            line(body, 'Prévision +1 h (projection, pas une garantie)',
              `solde projeté ${money(f.projected)} à ${money(f.perHour)} $/h`, 'warn');
          }
        }
        if (s.money < 0) line(body, 'Causes du déficit', s.causes.join(' ; '), 'warn');
        if (sim.economy.bankrupt) line(body, 'État', 'FAILLITE', 'bad');
      },
    );
  }

  // --- 3. Statistiques -------------------------------------------------------
  const stats = makeSection(col, 'panel', 'Statistiques');
  function refreshStats() {
    stats.refresh(
      () => {
        const sim = state.sim;
        if (!sim) return 'none';
        const p = sim.passengers;
        // t_2179387d : le nombre de bâtiments par service au sol est VISIBLE
        // (ressources/capacités lisibles, critère 85) — la sim reste la source.
        const svcCount = (type) => sim.infra.services.filter((s) => s.type === type).length;
        // R17 : la ponctualité (fenêtre bornée) fait partie de la signature —
        // sinon le panneau ne se met pas à jour quand un vol se termine.
        const pu = punctualityStats(sim);
        return [
          Math.floor(sim.time || 0), Math.round(p.satisfaction), p.totalCarried,
          p.queue.checkin, p.queue.security, p.queue.board,
          sim.aircraft.length, sim.planning.length,
          svcCount('fuel'), svcCount('hangar'), svcCount('cleaning'), svcCount('baggage'),
          pu.rate == null ? 'no' : `${pu.total}|${pu.onTime}|${pu.cancels}`,
        ].join('|');
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        const p = sim.passengers;
        line(body, 'Temps de jeu', fmtClock(sim.time));
        line(body, 'Passagers transportés', `${p.totalCarried}`);
        line(body, 'Satisfaction', `${Math.round(p.satisfaction)} %`);
        line(body, 'Files', `check-in ${p.queue.checkin} · sécurité ${p.queue.security} · embarquement ${p.queue.board}`);
        const inFlight = sim.aircraft.filter((a) => ['approach', 'holding', 'landing', 'blocked'].includes(a.phase)).length;
        line(body, 'Avions', `${sim.aircraft.length} (${inFlight} en vol/attente · ${sim.aircraft.length - inFlight} au sol)`);
        line(body, 'Vols planifiés', `${sim.planning.length}`);
        const svcCount = (type) => sim.infra.services.filter((s) => s.type === type).length;
        line(body, 'Services au sol',
          `carburant ${svcCount('fuel')} · hangar ${svcCount('hangar')} · nettoyage ${svcCount('cleaning')} · bagages ${svcCount('baggage')}`);
        // R17 : ponctualité sur fenêtre bornée (DELAY_WINDOW_S), dénominateur
        // CLAIR = les fins de vol récentes (départs + annulations), numérateur
        // = départs à l'heure (retard ≤ rotation nominale). null = aucun vol
        // terminé dans la fenêtre → « pas encore de vol terminé » (pas de
        // faux chiffre, R16).
        const pu = punctualityStats(sim);
        if (pu.rate == null) {
          line(body, 'Ponctualité', `— aucun vol terminé sur les ${DELAY_WINDOW_S / 60} dernières min`, 'warn');
        } else {
          const pct = Math.round(pu.rate * 100);
          const causes = Object.entries(pu.causes).map(([c, n]) => `${DELAY_CAUSE_FR[c] || c} ${n}`).join(' · ');
          line(body, `Ponctualité (${DELAY_WINDOW_S / 60} min, ${pu.total} vols, ${pu.cancels} annulés)`,
            `${pct} % à l'heure${causes ? ` — goulots : ${causes}` : ''}`,
            pct < 70 ? 'bad' : 'good');
        }
      },
    );
  }

  // --- 3b. R22 : objectifs de progression (récompense payée une fois) ------
  // UI fine : LECTURE seule (objectiveView) — le paiement est fait par la sim
  // (tickObjectives), pas par le panneau.
  const goals = makeSection(col, 'panel', 'Objectifs');
  function refreshGoals() {
    goals.refresh(
      () => {
        const sim = state.sim;
        if (!sim) return 'none';
        return OBJECTIVES.map((o) => {
          const v = objectiveView(sim, o.id);
          return [o.id, v.state, v.detail].join('|');
        }).join('§');
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        for (const o of OBJECTIVES) {
          const v = objectiveView(sim, o.id);
          line(body, `${o.name} (${o.reward} $)`, `${v.state} — ${v.detail}`,
               v.state === 'payée' ? 'good' : v.state === 'atteinte' ? 'warn' : '');
        }
      },
    );
  }

  // --- 3c. R23 : déblocages des services (conditions mesurables) ------------
  // UI fine : LECTURE seule (unlockView) — les conditions sont décidées par
  // tickUnlocks (unlocks.mjs), le panneau affiche le BÉNÉFICE + la condition
  // restante pour chaque service verrouillé (à l'avance, pas de seuil pax).
  const unlocks = makeSection(col, 'panel', 'Déblocages services');
  function refreshUnlocks() {
    unlocks.refresh(
      () => {
        const sim = state.sim;
        if (!sim) return 'none';
        return unlockView(sim).join('§');
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        for (const l of unlockView(sim)) {
          const isDone = l.startsWith('débloqué(s)') || l.startsWith('tous');
          line(body, l.split(' : ')[0] || 'Déblocages', l.split(' : ').slice(1).join(' : '), isDone ? 'good' : '');
        }
      },
    );
  }
  // --- 3d. R24 : contrats de compagnie (prime/pénalité réglées une fois) ---
  // UI fine : LECTURE seule (contractView) — le règlement est fait par la sim
  // (tickContracts), le panneau affiche l'état (proposé/actif/finis) + la
  // mesure live (vols, pax, ponctualité, temps restant) + les décisions
  // accepter/refuser/annuler (les COMMANDES contracts, pas de règle ici).
  const contracts = makeSection(col, 'panel', 'Contrats de compagnie');
  function refreshContracts() {
    contracts.refresh(
      () => {
        const sim = state.sim;
        if (!sim) return 'none';
        const v = contractView(sim);
        return [
          v.active ? `${v.active.id}:${v.active.done}:${v.active.pax}:${v.active.onTime}:${v.active.ends}:${v.active.left | 0}` : 'none',
          v.offered ? v.offered.id : 'none', v.offered ? v.offered.left | 0 : '',
          v.nextOfferAt, (v.history || []).map((h) => `${h.id}:${h.result}`).join(','),
        ].join('|');
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        const v = contractView(sim);
        if (v.offered) {
          const cap = contractCapable(sim, { acType: v.offered.acType });
          line(body, `Contrat proposé — ${v.offered.name}`,
            `décision ${v.offered.left} s (refus gratuit)`);
          line(body, '', `${v.offered.desc}`);
          line(body, 'Appareil', `${cap.name} (${cap.seats} sièges) — ` +
            (cap.capable ? 'servable par l’infra actuelle' : `non servable : ${cap.why}`));
          const ok = document.createElement('button');
          ok.textContent = 'Accepter le contrat';
          ok.addEventListener('click', () => { decideContract(sim, v.offered.id, true); refreshContracts(); });
          const no = document.createElement('button');
          no.textContent = 'Refuser (gratuit)';
          no.addEventListener('click', () => { decideContract(sim, v.offered.id, false); refreshContracts(); });
          body.append(ok, no);
        }
        if (v.active) {
          const a = v.active;
          const cap = contractCapable(sim, { acType: a.acType });
          const pct = a.rate == null ? '—' : `${Math.round(a.rate * 100)} %`;
          // Risque aprÈs DÉPART (R25) : ce qu'il reste à faire + le pire cas
          // (pénalité plafonnée, payée une fois — le contrat ne peut JAMAIS
          // coûter plus que ça ; la prime si la mesure passe au vert).
          // Le verdict onTrack vient du module (contractOnTrack — LA règle
          // unique du règlement, lue ici, jamais ré-imposée par le panneau).
          const risk = a.onTrack ? 'sur la bonne voie'
            : (cap.capable ? `reste ${Math.max(0, a.flights - a.done)} vol(s)${a.pax < a.minPax ? ` et ${a.minPax - a.pax} pax` : ''}`
                           : `infra non servable (${cap.why})`);
          line(body, `Contrat actif — ${a.name}`,
            `${a.done}/${a.flights} vols · ${a.pax}/${a.minPax} pax · ponctualité ${pct} (exigée ${Math.round((a.punctuality ?? 0) * 100)} %) · ${a.left | 0} s restantes`);
          line(body, '', `${cap.name} (${cap.seats} sièges) — ${risk}`);
          line(body, '', `Prime ${a.bonus} $ si réussi · pire pénalité ${a.penalty} $ (payée une fois)`);
          const cancel = document.createElement('button');
          cancel.textContent = 'Annuler le contrat (pénalité due)';
          cancel.addEventListener('click', () => { cancelContract(sim, a.id); refreshContracts(); });
          body.appendChild(cancel);
        }
        if (!v.offered && !v.active) {
          if (v.nextOfferAt != null) line(body, 'Prochain contrat', `proposé à ${v.nextOfferAt} pax transportés (${sim.passengers?.totalCarried ?? 0} actuels)`);
          else if (!(v.history || []).length) line(body, '', 'Aucun contrat (l’activité s’annonce — ≥ 300 pax transportés pour la première offre).');
        }
        for (const h of (v.history || []).slice(0, 4)) {
          line(body, `Fini — ${h.name}`,
            `${h.result === 'success' ? 'réussi' : h.result === 'cancelled' ? 'annulé (pénalité)' : 'manqué (pénalité)'} : ${h.done}/${h.flights} vols · ${h.pax} pax`);
        }
      },
    );
  }
  // --- 4. Historique d'alertes (sim.alerts, les plus récentes d'abord) ------
  const hist = makeSection(col, 'panel', 'Alertes (historique)');
  function refreshHist() {
    hist.refresh(
      () => {
        const sim = state.sim;
        return sim ? `${(sim.alerts || []).length}` : 'none'; // signature = longueur seule
      },
      (body) => {
        body.replaceChildren();
        const all = state.sim ? state.sim.alerts || [] : [];
        // ponytail: on n'affiche que les 50 plus récentes (l'historique complet
        // vit dans sim.alerts ; un bornage en sim si ça devient un besoin).
        const last = all.slice(-50).reverse();
        if (!last.length) { line(body, '', 'Aucune alerte.'); return; }
        for (const a of last) {
          const d = document.createElement('div');
          d.className = 'aline';
          d.textContent = a.why ? `${a.kind} — ${a.why}` : a.kind;
          body.appendChild(d);
        }
        if (all.length > 50) line(body, '', `… ${all.length - 50} plus anciennes (non affichées)`);
      },
    );
  }

  // --- 5. Diagnostic réseau : coupé / saturation ----------------------------
  const net = makeSection(col, 'panel', 'Diagnostic réseau');
  function refreshNet() {
    net.refresh(
      () => {
        const sim = state.sim;
        if (!sim) return 'none';
        const i = sim.incidents || {};
        const pending = sim.aircraft.filter((a) => ['approach', 'holding', 'landing', 'blocked'].includes(a.phase)).length;
        const q = qualityView(sim); // R26 : palier qualité (mix d'offres) + mesure sous-jacente
        return [
          sim._graph ? sim._graph.nodes.length : null, sim._graphDirty ? 1 : 0,
          sim.infra.runways.length, sim.infra.gates.length,
          pending, pendingCap(sim), i.runway?.closed > 0 ? 1 : 0, i.fuel?.out > 0 ? 1 : 0, i.surge?.active ? 1 : 0,
          q.tier, q.q.toFixed(2),
        ].join('|');
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        const i = sim.incidents || {};
        // SATURATION : file d'arrivées face au plafond (PARAMÈTRE de la sim,
        // R26 : pendingCap — le panneau le lit, la sim le borne [4, 8]).
        const pending = sim.aircraft.filter((a) => ['approach', 'holding', 'landing', 'blocked'].includes(a.phase)).length;
        const cap = pendingCap(sim);
        line(body, 'File d’arrivées', `${pending}/${cap}`, pending >= cap ? 'bad' : '');
        // R26 : la qualité module les offres (palier = le mix de tailles
        // proposé par le planificateur, mesure = la ponctualité R17).
        const q = qualityView(sim);
        line(body, 'Qualité des offres',
          `${q.tierName} (valeur ${Math.round(q.q * 100)} %) — mesure ${q.measured == null ? '—' : Math.round(q.measured * 100) + ' %'}`,
          q.tier === 2 ? 'good' : '');
        if (i.runway?.closed > 0) line(body, 'Piste', `FERMÉE (${Math.ceil(i.runway.closed)} s restants)`, 'bad');
        if (i.fuel?.out > 0) line(body, 'Carburant', `panne stations (${Math.ceil(i.fuel.out)} s)`, 'bad');
        if (i.surge?.active) line(body, 'Demande', 'pic actif (cadence doublée)', 'warn');
        // COUPÉ : lecture SEULE du graphe — JAMAIS de rebuildGraph ici (avant le
        // 1er tick le graphe est null et c'est voulu : on l'affiche, on ne le
        // fabrique pas, R3/A7).
        const g = sim._graph;
        if (!g) { line(body, 'Graphe', 'pas encore construit (avant le 1er tick)', 'warn'); return; }
        line(body, 'Graphe', `${g.nodes.length} nœuds`);
        // Par taille de porte : un chemin PISTE→PORTE existe-t-il ? (findPath,
        // occupation vide = la question « est-ce joignable », pas « qui est dessus »).
        for (const size of ['S', 'M', 'L']) {
          const gates = (sim.infra.gates || []).filter((x) => x.size === size);
          if (!gates.length) continue;
          let ok = false;
          for (const x of gates) {
            const to = g.gateNode.get(x.id);
            if (to == null) continue; // porte HORS réseau : aucun segment ne la touche
            for (const rw of sim.infra.runways) {
              const from = runwayExitNode(sim, rw.id);
              if (from != null && findPath(sim, from, to, new Set())) { ok = true; break; }
            }
            if (ok) break;
          }
          line(body, `Portes ${size}`, ok ? 'atteignables depuis la piste' : 'INACCESSIBLES (réseau coupé)', ok ? '' : 'bad');
        }
      },
    );
  }

  return {
    // Appel à chaque frame (bus 'frame') : chaque panneau ne reconstruit son DOM
    // que si sa signature a changé — coût négligeable sinon (pattern planning).
    refresh: () => { refreshInspect(); refreshFin(); refreshStats(); refreshGoals(); refreshUnlocks(); refreshContracts(); refreshHist(); refreshNet(); },
    // R07 : une sauvegarde rechargée ou une nouvelle partie change tout l'état —
    // la sélection inspecte un OBJET QUI N'EXISTE PLUS. invalidate() vide le pick
    // ; la prochaine refreshInspect rend l'état par défaut (pas un « parti »
    // stale). Câblé par save-panel (onLoad) et startNewGame dans main.mjs.
    invalidate: () => { pick = null; },
    col,
  };
}
