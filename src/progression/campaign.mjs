// T2-2 (t_6344db94) — CAMPAGNE DE VICTOIRE : un but global DÉCLARÉ et
// MESURABLE dans l'état sim (règle R21 : pas de compteur « réputation » —
// la victoire est une DÉCISION du joueur, lue dans l'état, jamais un
// compteur abstrait). Cohérente avec OBJECTIFS R22 (récompense payée UNE
// fois, événement pushEvent, affichage panneau), quality.mjs et tiers.mjs
// (palier 3 QUALITÉ : tenir un contrat qualité avant l'échéance) :
//   VICTOIRE = les 3 contrats de la saison réglés RÉUSSIS (le cycle complet
//   light → regular → qualité — la ROTATION des modèles R24/R25) AVANT
//   l'échéance de la saison (CAMPAIGN.deadline, secondes de sim).
//   ÉCHEC    = l'échéance dépassée avec moins de 3 succès.
// Le champ vit sur la SIM (sim.campaign — sérialisé avec l'état entier par
// save.mjs, pattern intro.mjs : il REPREND après sauvegarde/rechargement).
// Un contrat RÉUSSI incrémente `wins` (countCampaignWin, appelé par le
// règlement unique des contrats — contracts.mjs, jamais ailleurs).
// LA RÈGLE est décidée par tickCampaign (la sim), pas par l'UI : le panneau
// est une LECTURE (campaignView). La récompense passe par earn (compte
// revenue dédié — comptabilisable) ; faillite → aucun paiement (R22 : une
// sim en faillite ne paie aucun objectif).
import { earn } from '../economy/economy.mjs';
import { pushEvent } from '../core/sim-state.mjs';

export const CAMPAIGN = Object.freeze({
  id: 'season',
  name: 'La saison du tycoon',
  // 3 contrats réussis = le cycle complet des paliers (tiers.mjs : light →
  // regular → QUALITÉ — le palier 3 est LA victoire, la mesure est la même
  // que la règle R24/R25 du contrat : vols + pax + ponctualité avant fin de
  // période, réglés UNE fois sur mesure de PÉRIODE).
  target: 3,
  // L'échéance de SAISON : 3 h de sim (10 800 s). Les 3 périodes de contrats
  // à fond (1800 + 2400 + 3000 s) laissent ~1 h de marge pour 1-2 échecs —
  // la victoire est ATTEIGNABLE en jeu normal, et ÉCHOUABLE (échéance).
  deadline: 10800,
  // La PRIME de saison : payée UNE fois à la victoire (compte revenue dédié).
  reward: 2500,
});

// États possibles (bornés — le panneau et les tests lisent cette enum).
export const CAMPAIGN_STATUSES = Object.freeze(['active', 'won', 'lost']);

function fresh() {
  return {
    status: 'active',
    wins: 0,            // contrats RÉUSSIS (countCampaignWin, règlement unique)
    rewardPaid: false,  // la prime est payée UNE fois (jamais double, R22)
    endedAt: null,      // horodatage de fin (sim.time) — gagné ou perdu
  };
}

// Initialisation paresseuse + RÉPARATION défensive (pattern R31/R32 : un
// champ présent mais au mauvais format est reconstruit — jamais de crash).
// Sauvegarde PRÉ-T2-2 : le champ est ABSENT → campagne FRAÎCHE (la saison
// démarre à la première exécution du tick).
export function ensureCampaign(sim) {
  const c = sim.campaign;
  const ok = c && typeof c === 'object'
    && CAMPAIGN_STATUSES.includes(c.status)
    && Number.isInteger(c.wins) && c.wins >= 0
    && (c.rewardPaid === true || c.rewardPaid === false)
    && (c.endedAt === null || Number.isFinite(c.endedAt));
  if (!ok) sim.campaign = fresh();
  return sim.campaign;
}

// UN contrat réglé RÉUSSI (appelé par settle, le règlement unique des
// contrats — jamais un autre appelant) : la victoire compte les SUCCÈS de
// contrat, pas un compteur de temps. Un contrat manqué/annulé ne compte
// PAS (la mesure est le critère, R24).
export function countCampaignWin(sim) {
  const c = ensureCampaign(sim);
  if (c.status !== 'active') return; // saison terminée : plus de décompte
  c.wins += 1;
}

// LA RÈGLE de la campagne (tick, après tickContracts — le règlement des
// contrats vient d'avoir lieu) :
//   VICTOIRE : les `target` contrats réussis AVANT l'échéance, hors faillite
//   (R22 : faillite → aucun objectif payé) → la prime est créditée
//   ATOMIQUEMENT (status + flag + earn dans la même écriture) + l'événement
//   « campaign-won » (toast/juice/sfx). Idempotent : `rewardPaid` verrouille
//   la prime — des ticks suivants ne re-creditent PAS.
//   ÉCHEC : l'échéance dépassée avec moins de succès → status « lost » +
//   l'événement « campaign-lost ». La partie CONTINUE (la campagne est un
//   but, pas un game-over — comme les objectifs R22).
export function tickCampaign(sim) {
  const c = ensureCampaign(sim);
  if (c.status !== 'active') return;
  if (c.wins >= CAMPAIGN.target && !sim.economy.bankrupt) {
    if (!c.rewardPaid) {
      c.status = 'won';
      c.rewardPaid = true;
      c.endedAt = sim.time;
      earn(sim, CAMPAIGN.reward, 'campaign'); // la prime (compte revenue dédié)
      pushEvent(sim, { kind: 'campaign-won', name: CAMPAIGN.name, wins: c.wins,
                       target: CAMPAIGN.target, deadline: CAMPAIGN.deadline,
                       reward: CAMPAIGN.reward });
    }
    return;
  }
  if (sim.time >= CAMPAIGN.deadline && c.wins < CAMPAIGN.target) {
    c.status = 'lost';
    c.endedAt = sim.time;
    pushEvent(sim, { kind: 'campaign-lost', name: CAMPAIGN.name, wins: c.wins,
                     target: CAMPAIGN.target, deadline: CAMPAIGN.deadline });
  }
}

// LECTURE seule (panneau) : l'état de la saison + la mesure live (succès /
// objectif, temps restant, la prime) — le panneau ne décide rien.
export function campaignView(sim) {
  const c = ensureCampaign(sim);
  const left = Math.max(0, CAMPAIGN.deadline - (sim.time ?? 0));
  return {
    status: c.status,
    wins: c.wins,
    target: CAMPAIGN.target,
    deadline: CAMPAIGN.deadline,
    left: c.status === 'active' ? left : 0,
    reward: CAMPAIGN.reward,
    rewardPaid: c.rewardPaid,
    name: CAMPAIGN.name,
    endedAt: c.endedAt,
    // Texte lisible (affiché par le panneau).
    text: c.status === 'won'
      ? `gagnée — ${c.wins} contrats réussis, prime ${CAMPAIGN.reward} $`
      : c.status === 'lost'
        ? `échouée — ${c.wins}/${CAMPAIGN.target} contrats avant l'échéance`
        : `${c.wins}/${CAMPAIGN.target} contrats réussis — ${left} s avant l'échéance`,
  };
}
