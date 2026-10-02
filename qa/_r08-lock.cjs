// Vérifie si R08 (t_dab62cfc) a un lock live ou périmé + dernier run.
const { DatabaseSync } = require('node:sqlite');
const DB = 'C:\\Users\\Lucas\\AppData\\Local\\hermes\\kanban.db';
const db = new DatabaseSync(DB, { readOnly: true });
const t = db.prepare('SELECT id, status, claim_lock, claim_expires FROM tasks WHERE id=?').get('t_dab62cfc');
console.log('R08:', JSON.stringify(t));
const now = Math.floor(Date.now()/1000);
console.log('now:', now, 'lock expire à:', t.claim_expires, '->', t.claim_expires > now ? 'LIVE' : 'EXPIRÉ/stale');
const runs = db.prepare('SELECT status, outcome, summary, started_at, ended_at FROM task_runs WHERE task_id=? ORDER BY rowid DESC').all('t_dab62cfc');
for (const r of runs) console.log('RUN', r.status, r.outcome, String(r.summary||'').slice(0,150).replace(/\n/g,' '), 'start', r.started_at, 'end', r.ended_at);
// cartes en cours d'exécution
const running = db.prepare('SELECT id, title, status, claim_lock, claim_expires FROM tasks WHERE status=?').all('running');
console.log('--- running ---');
for (const r of running) console.log(r.id, r.status, 'exp', r.claim_expires, r.title.slice(0,40));
db.close();
