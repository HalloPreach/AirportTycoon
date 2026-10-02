const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('qa/_kanban-dump.json', 'utf8'));
const byId = {};
for (const t of d.tasks) byId[t.id] = t;
for (const t of d.tasks) {
  const m = t.title.match(/^(G[0-7]) —/);
  if (!m) continue;
  const ps = d.links.filter((l) => l.child_id === t.id).map((l) => l.parent_id);
  const names = ps.map((p) => {
    const tt = byId[p];
    return `${p} (${(tt ? tt.title.slice(0, 24) : '?')} [${tt ? tt.status : '?'}])`;
  });
  console.log(`${t.id} ${t.title} | ${t.status}`);
  console.log('  parents: ' + names.join(' ; '));
}
