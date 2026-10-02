// Panneau Sauvegarde : charge/enregistre la sauvegarde via localStorage et
// affiche le résultat en toast (succès ou échec lisible).
// Règle : la LOGIQUE (sérialiser, valider) est dans src/persistence/save.mjs ;
// ici on ne fait que relier la UI à ces fonctions et rendre les erreurs lisibles.
// A10 : une sauvegarde invalide n'est JAMAIS supprimée ici — la copie diagnostic
// est préservée par loadFromStorage (DIAG_KEY) et l'original reste en place.
import { saveToStorage, loadFromStorage, hasSave } from '../persistence/save.mjs';

export function makeSavePanel(state, { toast, syncPlanningPanel, onLoad }) {
  // Enregistre l'état courant (manuel, touche S). Uniquement en jeu : sauvegarder
  // au menu écraserait la partie avec un état de menu inutilisable.
  function saveNow() {
    if (state.screen !== 'game') { toast('Sauvegarde disponible en jeu (S)', 'info'); return false; }
    const ok = saveToStorage(state);
    toast(ok ? 'Sauvegarde effectuée' : 'Impossible de sauvegarder (espace disque)', ok ? 'ok' : 'err');
    return ok;
  }

  // Sauvegarde SILENCIEUSE (automatique : fermeture de page, quitter, périodique).
  // Même écriture que saveNow mais sans toast : l'automatique ne doit pas polluer.
  function autoSave() {
    if (state.screen !== 'game') return false;
    return saveToStorage(state);
  }

  // Y a-t-il une sauvegarde à proposer au menu (« Reprendre ») ?
  function canResume() { return hasSave(); }

  // Restaure la sauvegarde ; si elle est absente ou invalide, signale en clair.
  // A10 : sur invalide, la sauvegarde est PRÉSERVÉE (copie diagnostic, voir
  // loadFromStorage) — on ne la supprime JAMAIS ; l'incompatibilité est annoncée
  // (toast) sans crash et sans perte de la sauvegarde d'origine.
  function loadNow() {
    let restored;
    try {
      restored = loadFromStorage();
    } catch (e) {
      toast(e.message || 'Sauvegarde illisible', 'err'); // annoncée ; la copie diag est en place
      return false;
    }
    if (!restored) {
      toast('Aucune sauvegarde trouvée', 'info');
      return false;
    }
    // On remplace le contenu de `state` EN PLACE (la caméra et la boucle gardent
    // leurs références). `sim` est assigné SÉPARÉMENT : Object.assign ne
    // supprime jamais un champ absent du clone (une partie sans sim ne doit pas
    // laisser l'ancienne sim en place, et l'inverse non plus).
    Object.assign(state, restored);
    state.sim = restored.sim || null;
    state.paused = false;
    state._alertSeen = 0; // les alertes restaurées sont déjà connues du joueur
    // R06 (D2) : la préférence auto-accept (state.planningAuto) est sérialisée
    // AVEC le state entier (serialize) et restaurée ici par Object.assign → le
    // DOM du panneau suit via le hook (la UI fine n'a pas l'objet du panneau,
    // elle en émet la commande syncPlanningPanel, câblée par main.mjs).
    // (avant R06, la préférence était un flag local du panneau : le load la
    // perdait. Maintenant elle est sur le state = sérialisée = rechargée.)
    syncPlanningPanel?.(); // la case auto-accept (BL-16 / R06) suit le state restauré
    onLoad?.(); // R07 : la sélection d'inspection (pick) pointe vers l'ANCIENNE sim
                 // (objet disparu) — elle est invalidée par le hook câblé dans main.mjs
                 // (panels.invalidate), pour ne pas afficher un avion fantôme.
    toast('Jeu restauré', 'ok');
    return true;
  }

  return { saveNow, loadNow, autoSave, canResume };
}
