// R43 — export de suivi du tableau /kanban (lecture seule, snapshot au commit final).
// Un fichier de sortie : docs/KANBAN_TRACKING_EXPORT_R43.md (tableau R01-R43 + G0-G7).
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const db = new DatabaseSync(process.env.USERPROFILE + '/AppData/Local/hermes/kanban.db', { readOnly: true });
const all = db.prepare('select id, title, status, completed_at from tasks').all();
const rows = all.filter((r) => /^\s*(R\d+|G\d+)/.test(r.title))
  .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));

let md = `# Export de suivi du tableau /kanban — snapshot R43 (2026-10-04)\n\n`;
md += `Source : \`~/.hermes/kanban.db\` (lecture seule, ${rows.length} cartes R/G). ` +
      `Le tableau est la source de vérité ; ce fichier est un snapshot de livraison (R43) — ` +
      `ne le rééditer pas à la main.\n\n`;
md += `| Carte | Titre | Statut | Terminée |\n|---|---|---|---|\n`;
const dts = (v) => (v == null ? '—' : new Date(typeof v === 'number' ? v * 1000 : v).toISOString().slice(0, 10));
for (const r of rows) {
  md += `| ${r.id} | ${String(r.title).slice(0, 60)} | ${r.status} | ${dts(r.completed_at)} |\n`;
}
const done = rows.filter((r) => r.status === 'done').length;
md += `\n**Récap** : ${done}/${rows.length} cartes R/G « done ». ` +
      `R43 = livraison (cette carte) ; G7 = barrière de livraison J7 (dépend de R39-R43). ` +
      `Une limite essentielle (1re session 20-30 min observée traversant les 3 paliers) ` +
      `reste ouverte → la version est livrée comme **candidate**, pas « livraison validée ».\n`;

writeFileSync(new URL('../docs/KANBAN_TRACKING_EXPORT_R43.md', import.meta.url), md);
console.log(`export : ${rows.length} cartes (${done} done) → docs/KANBAN_TRACKING_EXPORT_R43.md`);
