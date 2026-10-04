// Demo helper: registers 5 people who share a profile and have them all report the same scam through the real API,
// which triggers the alert for everyone else with that state / age group / language.
//   node demo-seed.js [state] [ageGroup] [language] [scamId] [baseUrl]
//   e.g. node demo-seed.js FL 60+ Spanish 1
const [state = 'FL', ageGroup = '60+', language = 'Spanish', scamId = '1', base = 'http://localhost:3000'] = process.argv.slice(2);
const post = async (path, body, token) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error}`);
  return j;
};
const run = Date.now().toString(36);
console.log(`Registering 5 demo reporters (${state}, ${ageGroup}, ${language}) who all report scam #${scamId}...`);
for (let i = 1; i <= 5; i++) {
  const u = await post('/api/signup', { fullName: `Reporter${i} Demo`, email: `demo-${run}-${i}@example.com`, password: 'demo-pass1', state, ageGroup, language });
  const r = await post('/api/reports', { scamId: Number(scamId), source: 'SMS', outcome: 'blocked' }, u.token);
  console.log(`  report ${i}: stored=${r.stored}${r.alerts ? `  -> ${r.alerts} alert(s) fired!` : ''}`);
}
console.log('Done. Anyone sharing that state, age range or language now has an alert in their Alerts tab.');
