// État live des 51 cartes R/G : label -> id, status, dernier run. Lecture seule.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const DB = 'C:\\Users\\Lucas\\AppData\\Local\\hermes\\kanban.db';
const ROOT = 'C:\\Users\\Lucas\\Documents\\AirportTycoon';
const spec = JSON.parse(fs.readFileSync(ROOT + '\\docs\\R_KANBAN_CREATION_SPEC.json', 'utf8'));
const db = new DatabaseSync(DB, { readOnly: true });
const tasks = db.prepare('SELECT id, title, idempotency_key, status FROM tasks').all();
const runs = db.prepare('SELECT task_id, status, summary, outcome FROM task_runs ORDER BY rowid DESC').all();
db.close();
const last = {}; for (const r of runs) if (!last[r.task_id]) last[r.task_id] = r;
const order = [];
for (const l of Object.keys(spec.cards)) {
  const pre = l + ' ';
  const hit = tasks.find(t => (t.idempotency_key && t.idempotency_key.startsWith(pre)) || t.title.startsWith(pre));
  if (!hit) { console.error('MISSING', l); order.push([l,'MISSING']); continue; }
  const jr = last[hit.id];
  const s = jr ? (jr.status + '/' + (jr.outcome||'-') + ' ' + String(jr.summary||'').replace(/\n/g,' ').slice(0,70)) : '(no run)';
  order.push([l, hit.id, hit.status, s]);
}
for (const r of order) console.log(r.join(' | ').slice(0,170));
const cnt = {}; for (const t of tasks) if (t.idempotency_key && /^[RG]\d/.test(t.idempotency_key)) cnt[t.status]=(cnt[t.status]||0)+1;
console.log('=== statuts 51 R/G ==='); console.log(JSON.stringify(cnt));
