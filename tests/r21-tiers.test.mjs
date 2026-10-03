// R21 (t_e37cdebf) — les 3 paliers de progression : la CONFIGURATION
// (src/data/tiers.mjs) porte pour chacun opportunité / décision / goulot /
// investissement possible / succès / échec récupérable, et distingue exigences de
// contenu (vérifiables) des cibles de durée (R37).
// tiers.mjs est des DONNÉES (pas de logique) → ce test verrouille la FORME du
// contrat que R22-R26 implémenteront :
//   1. exactement 3 paliers, dans l'ordre, chacun avec les champs requis ;
//   2. chaque décision est une ACTION vérifiable (texte non vide), pas un compteur ;
//   3. la config n'ordonne PAS tous les bâtiments : chaque palier propose au
//      moins une option « rien » (gratuite) → pas d'ordre unique obligatoire ;
//   4. le 1er palier est jouable SANS construction (réseau initial) :
//      l'entrée ne demande aucun bâtiment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, CONTENT_VS_DURATION } from '../src/data/tiers.mjs';

// Les champs obligatoires d'un palier (exigence de contenu — vérifiables).
const REQUIRED = ['id', 'name', 'entry', 'opportunity', 'decision', 'bottleneck', 'invest', 'success', 'failure', 'durationTarget'];

test('R21 : exactement 3 paliers, dans l’ordre, champs requis présents', () => {
  assert.equal(TIERS.length, 3, '3 paliers (lancer / saturation / agrandir)');
  assert.deepEqual(TIERS.map((t) => t.id), [1, 2, 3], 'paliers numérotés 1,2,3');
  for (const t of TIERS) {
    for (const k of REQUIRED) {
      assert.ok(t[k] !== undefined && t[k] !== '', `palier ${t.id} manque le champ « ${k} »`);
    }
  }
});

test('R21 : chaque décision est une action vérifiable, pas un compteur', () => {
  // « pas uniquement d’attendre un compteur » : la décision doit citer une
  // action de décision (accepter/construire/choisir/refuser…) — pas juste
  // « atteindre X ». On vérifie qu’elle n’est pas vide ET qu’elle contient un
  // verbe d’action (le critère de la carte, pas une formule copiant le texte).
  const actionVerbs = /accepter|construire|choisir|refuser|tenir|absorber|investir|décider/i;
  for (const t of TIERS) {
    assert.ok(typeof t.decision === 'string' && t.decision.length > 0, `palier ${t.id} : décision vide`);
    assert.ok(actionVerbs.test(t.decision),
      `palier ${t.id} : la décision doit être une action vérifiable (« ${t.decision.slice(0, 40)}… »)`);
    // Succès mesurable dans l’état sim (le critère, pas l’attente d’un compteur).
    assert.ok(typeof t.success === 'string' && t.success.length > 0, `palier ${t.id} : succès vide`);
  }
});

test('R21 : la config n’ordonne PAS les bâtiments — chaque palier propose une option « rien »', () => {
  // « La configuration ne nécessite pas de construire tous les bâtiments dans
  //  un ordre unique » : chaque palier doit porter au moins une option
  //  facultative (construire RIEN) → pas de séquence obligatoire.
  for (const t of TIERS) {
    assert.ok(Array.isArray(t.invest) && t.invest.length > 0, `palier ${t.id} : invest doit être une liste de choix`);
    assert.ok(t.invest.some((i) => i.optional),
      `palier ${t.id} : il faut au moins une option facultative (construire rien) → pas d’ordre unique`);
  }
});

test('R21 : le 1er palier est jouable sur le réseau initial (aucune construction requise)', () => {
  // « Premier palier possible avec le réseau initial » : l’entrée du palier 1
  // ne doit PAS exiger de construire un bâtiment — les opportunités sont
  // servables dès t=0 (réseau fourni : piste + taxiway + terminal 2 portes M).
  const t1 = TIERS.find((t) => t.id === 1);
  const entry = `${t1.entry} ${t1.opportunity}`.toLowerCase();
  assert.match(entry, /réseau initial|dès t=0|aucune construction/i,
    'palier 1 doit s’ouvrir sur le réseau initial, sans construction obligatoire');
  // Et l’investissement du palier 1 doit inclure une option « rien ».
  assert.ok(t1.invest.some((i) => i.optional), 'palier 1 : option « rien » disponible');
});

test('R21 : les cibles de durée sont distinguées des exigences de contenu', () => {
  // « Distinguer exigences de contenu et simples cibles de durée » : le contenu
  // (décisions/succès) ne peut PAS dépendre d’un compteur de durée ; la durée
  // est une cible R37 séparée (champ durationTarget, référencée par R37).
  assert.ok(CONTENT_VS_DURATION.content && CONTENT_VS_DURATION.duration,
    'le contrat contenu/durée doit être déclaré (distinction exigée par la carte)');
  for (const t of TIERS) {
    // La durée est une CIBLE (R37), jamais un critère de succès : le champ de
    // succès ne doit pas être un « atteindre X en Y minutes ».
    assert.ok(!/attendre|compteur|atteindre/i.test(t.success),
      `palier ${t.id} : le succès ne peut pas être un compteur à attendre`);
  }
});
