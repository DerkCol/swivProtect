import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { RECOVERY } from './recovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
const PORT = process.env.PORT || 3000;

// Rules: keep in sync with data/live_db.py (the tested reference implementation).
const ALERT_THRESHOLD = 5, PAIR_CAP = 15, WINDOW_DAYS = 30;
const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const AGE_GROUPS = ['18-25', '26-40', '41-60', '60+'];
const LANGUAGES = ['English', 'Spanish', 'Chinese', 'Tagalog', 'Vietnamese'];
const DIMS = ['state', 'age_group', 'language'];
const PAIRS = [['state', 'age_group'], ['state', 'language'], ['age_group', 'language']];

// ---- databases: live.db (accounts, reports, alerts) + catalog.db (static scam catalog) ----
const catalogPath = path.join(DATA, 'catalog.db');
if (!fs.existsSync(catalogPath)) { console.error('catalog.db not found. Run: npm run setup'); process.exit(1); }
const db = new DatabaseSync(path.join(DATA, 'live.db'));
db.exec('PRAGMA foreign_keys = ON');
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='users'").get()) db.exec(fs.readFileSync(path.join(DATA, 'live_schema.sql'), 'utf8'));
db.exec(`ATTACH DATABASE '${catalogPath.replace(/'/g, "''")}' AS catalog`);

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const q = sql => db.prepare(sql);

function purge() {
  const c = `-${WINDOW_DAYS} days`;
  q("DELETE FROM reports WHERE created_at < datetime('now', ?)").run(c);
  q("DELETE FROM alerts WHERE fired_at < datetime('now', ?)").run(c);
  q("DELETE FROM notifications WHERE created_at < datetime('now', ?)").run(c);
}
purge();
setInterval(purge, 3600e3).unref();

// ---- accounts ----
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const firstOf = n => n.includes(', ') ? n.split(', ').slice(1).join(', ') : n;
function splitName(full) {   // "Alex Morgan" or "Morgan, Alex" -> stored as "Last, First"
  full = full.trim().replace(/\s+/g, ' ');
  if (full.includes(',')) { const [l, f] = full.split(',').map(x => x.trim()); return f ? { first: f, last: l } : { first: l, last: '' }; }
  const parts = full.split(' ');
  return { first: parts[0], last: parts.slice(1).join(' ') };
}
const publicUser = u => ({ userName: u.user_name, firstName: firstOf(u.user_name), email: u.email, token: u.token, memberSince: u.created_at, profile: { state: u.state, ageGroup: u.age_group, language: u.language } });
function cleanProfile(b) {
  if (!STATES.includes(b.state)) throw new HttpError(400, 'Please choose your state.');
  if (!AGE_GROUPS.includes(b.ageGroup)) throw new HttpError(400, 'Please choose your age range.');
  if (!LANGUAGES.includes(b.language)) throw new HttpError(400, 'Please choose your language.');
  return { state: b.state, age_group: b.ageGroup, language: b.language };
}
const userFrom = req => {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const u = t && q('SELECT * FROM users WHERE token = ?').get(t);
  if (!u) throw new HttpError(401, 'Not signed in.');
  return u;
};

// ---- reports + the alert trigger ----
function flagsFor(scamId, language) {
  const flags = q('SELECT flag FROM catalog.red_flags WHERE scam_id = ? AND language = ? ORDER BY position').all(scamId, language).map(r => r.flag);
  const tpl = q('SELECT template FROM catalog.notification_templates WHERE language = ?').get(language).template;
  return { flags: flags.join(', '), message: tpl.replace('{flags}', flags.join(', ')) };
}

function submitReport(u, scamId, source, outcome) {
  purge();
  if (!q('SELECT 1 FROM catalog.scams WHERE id = ?').get(scamId)) throw new HttpError(400, 'Unknown scam type.');
  if (!['Email', 'SMS'].includes(source)) throw new HttpError(400, 'Choose Email or SMS.');
  if (!['blocked', 'fell_for', 'unsure'].includes(outcome)) outcome = 'unsure';
  if (q('SELECT 1 FROM reports WHERE user_id = ? AND scam_id = ?').get(u.id, scamId)) return { stored: false, reason: 'duplicate', alerts: 0 };
  for (const [a, b] of PAIRS) {
    const n = q(`SELECT COUNT(*) n FROM reports WHERE scam_id = ? AND ${a} = ? AND ${b} = ?`).get(scamId, u[a], u[b]).n;
    if (n >= PAIR_CAP) return { stored: false, reason: 'cap', alerts: 0 };
  }
  q('INSERT INTO reports (user_id, scam_id, source, outcome, state, age_group, language) VALUES (?,?,?,?,?,?,?)')
    .run(u.id, scamId, source, outcome, u.state, u.age_group, u.language);

  let fired = 0;
  for (const dim of DIMS) {
    const val = u[dim];
    const n = q(`SELECT COUNT(DISTINCT user_id) n FROM reports WHERE scam_id = ? AND ${dim} = ?`).get(scamId, val).n;
    if (n < ALERT_THRESHOLD) continue;
    if (q('SELECT 1 FROM alerts WHERE scam_id = ? AND dimension = ? AND value = ?').get(scamId, dim, val)) continue;
    const audience = q(`SELECT id, language FROM users WHERE ${dim} = ? AND id NOT IN (SELECT user_id FROM reports WHERE scam_id = ? AND ${dim} = ?)`).all(val, scamId, val);
    const alertId = q('INSERT INTO alerts (scam_id, dimension, value, flags) VALUES (?,?,?,?)').run(scamId, dim, val, flagsFor(scamId, 'English').flags).lastInsertRowid;
    const msgByLang = {};
    for (const r of audience) {
      if (q('SELECT 1 FROM notifications WHERE user_id = ? AND scam_id = ?').get(r.id, scamId)) continue;   // one alert per scam per person
      msgByLang[r.language] ??= flagsFor(scamId, r.language).message;
      q('INSERT INTO notifications (user_id, alert_id, scam_id, message) VALUES (?,?,?,?)').run(r.id, alertId, scamId, msgByLang[r.language]);
    }
    fired++;
  }
  if (fired) q('UPDATE reports SET started_alert = 1 WHERE user_id = ? AND scam_id = ?').run(u.id, scamId);
  return { stored: true, reason: null, alerts: fired };
}

// ---- "during attack": scan a message against the catalog's red-flag words ----
const FLAG_ROWS = q('SELECT scam_id, flag FROM catalog.red_flags').all();
const SCAMS = Object.fromEntries(q('SELECT id, name, summary FROM catalog.scams').all().map(s => [s.id, s]));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "grandma/grandpa" -> two alternatives; "$" matches any amount; letters at the edges must not sit inside a longer word.
const FLAG_RE = FLAG_ROWS.map(r => {
  const alts = r.flag.split('/').map(a => a.trim()).filter(Boolean).map(a => {
    const body = esc(a).replace(/\\\$/g, '\\$?[\\d,.]*').replace(/\s+/g, '\\s+');
    return (/^[A-Za-z]/.test(a) ? '(?<![A-Za-z])' : '') + body + (/[A-Za-z]$/.test(a) ? '(?![A-Za-z])' : '');
  });
  return { scamId: r.scam_id, flag: r.flag, re: new RegExp(alts.join('|'), 'i') };
});
const PAYMENT_RE = /gift card|tarjeta de regalo|礼品卡|thẻ quà tặng|wire transfer|bitcoin|crypto|cripto|加密|zelle|cash app|prepaid|prepago/i;

function analyze(text) {
  const byScam = {};
  for (const f of FLAG_RE) if (f.re.test(text)) (byScam[f.scamId] ??= []).push(f.flag);
  let [best, hits] = Object.entries(byScam).sort((a, b) => b[1].length - a[1].length)[0] || [null, []];
  let score = hits.length;
  if (score && PAYMENT_RE.test(text)) score++;
  if (score && /https?:\/\//i.test(text)) score++;
  const level = score >= 3 ? 'high' : score === 2 ? 'medium' : 'low';
  return { level, score, scam: level === 'low' ? null : SCAMS[best], hits: level === 'low' ? [] : hits };
}

const T = {
  English: { high: 'Very likely a scam. Do not respond.', medium: 'This looks suspicious. Be careful.', low: 'Nothing obviously wrong, but stay careful.' },
  Spanish: { high: 'Muy probablemente es una estafa. No responda.', medium: 'Esto parece sospechoso. Tenga cuidado.', low: 'Nada parece raro, pero tenga cuidado.' },
  Chinese: { high: '极有可能是诈骗，请不要回复。', medium: '这条信息看起来可疑，请小心。', low: '看起来没有明显问题，但仍请保持警惕。' },
  Tagalog: { high: 'Malamang scam ito. Huwag sumagot.', medium: 'Mukhang kahina-hinala ito. Mag-ingat.', low: 'Walang halatang mali, pero mag-ingat pa rin.' },
  Vietnamese: { high: 'Rất có thể đây là lừa đảo. Đừng trả lời.', medium: 'Tin nhắn này có vẻ đáng ngờ. Hãy cẩn thận.', low: 'Chưa thấy điều gì bất thường, nhưng hãy luôn cảnh giác.' },
};

// Optional Claude second opinion (set ANTHROPIC_API_KEY)
async function aiExplain(text, scam, language) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 200,
        system: `You help older adults spot scams. Reply in ${language}. In 2 short, plain-language sentences (6th grade reading level), say whether this message looks like a scam and what to do. Never be alarming or condescending.`,
        messages: [{ role: 'user', content: `Pattern matched: ${scam ? scam.name : 'none'}.\n\nMessage:\n${text.slice(0, 4000)}` }],
      }),
    });
    return (await res.json()).content?.[0]?.text || null;
  } catch { return null; }
}

// ---- http ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS' }); res.end(JSON.stringify(obj)); };

async function route(req, res, url) {
  const p = url.pathname, m = req.method;

  if (p === '/api/options') return send(res, 200, { states: STATES, ageGroups: AGE_GROUPS, languages: LANGUAGES });
  if (p === '/api/catalog') return send(res, 200, {
    version: q("SELECT value FROM catalog.meta WHERE key='catalog_version'").get().value,
    categories: q('SELECT id, name, summary FROM catalog.categories ORDER BY id').all(),
    scams: q('SELECT id, name, summary, sources, category_id FROM catalog.scams ORDER BY category_id, position').all() });

  if (p === '/api/signup' && m === 'POST') {
    const b = await readBody(req);
    const { first, last } = splitName(String(b.fullName || ''));
    const email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
    if (!first) throw new HttpError(400, 'Please enter your full name.');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new HttpError(400, 'Use at least 8 characters, with a letter and a number.');
    const prof = cleanProfile(b);
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'That email already has an account.');
    const salt = crypto.randomBytes(16).toString('hex'), token = crypto.randomBytes(24).toString('hex');
    q('INSERT INTO users (user_name, email, salt, pw_hash, token, state, age_group, language) VALUES (?,?,?,?,?,?,?,?)')
      .run(last ? `${last}, ${first}` : first, email, salt, hash(b.password, salt), token, prof.state, prof.age_group, prof.language);
    return send(res, 201, publicUser(q('SELECT * FROM users WHERE email = ?').get(email)));
  }
  if (p === '/api/login' && m === 'POST') {
    const b = await readBody(req);
    const u = q('SELECT * FROM users WHERE email = ?').get(String(b.email || '').trim().toLowerCase());
    if (!u || !u.salt || hash(String(b.password || ''), u.salt) !== u.pw_hash) throw new HttpError(401, 'Wrong email or password.');
    return send(res, 200, publicUser(u));
  }
  if (p === '/api/me') {
    const u = userFrom(req);
    if (m === 'PUT') {
      const prof = cleanProfile(await readBody(req));
      q('UPDATE users SET state = ?, age_group = ?, language = ? WHERE id = ?').run(prof.state, prof.age_group, prof.language, u.id);
    }
    return send(res, 200, publicUser(q('SELECT * FROM users WHERE id = ?').get(u.id)));
  }

  if (p === '/api/reports' && m === 'POST') {
    const u = userFrom(req), b = await readBody(req);
    return send(res, 201, { ...submitReport(u, Number(b.scamId), b.source, b.outcome), recovery: b.outcome === 'fell_for' ? RECOVERY.default : null });
  }
  if (p === '/api/my-reports') {
    const u = userFrom(req);
    purge();
    return send(res, 200, { reports: q(`SELECT r.id, r.outcome, r.source, r.started_alert, r.created_at, s.name scam FROM reports r JOIN catalog.scams s ON s.id = r.scam_id WHERE r.user_id = ? ORDER BY r.id DESC`).all(u.id) });
  }
  if (p === '/api/notifications') {
    const u = userFrom(req);
    purge();
    return send(res, 200, { notifications: q(`SELECT n.id, n.message, n.created_at, n.scam_id, s.name scam FROM notifications n JOIN catalog.scams s ON s.id = n.scam_id WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 20`).all(u.id) });
  }
  if (p === '/api/stats') {
    purge();
    return send(res, 200, { reports: q('SELECT COUNT(*) n FROM reports').get().n, blocked: q("SELECT COUNT(*) n FROM reports WHERE outcome = 'blocked'").get().n, alerts: q('SELECT COUNT(*) n FROM alerts').get().n });
  }

  // The "during attack" endpoint: web app, Gmail add-on and SMS automation all call this with the user's key.
  if (p === '/api/analyze' && m === 'POST') {
    const u = userFrom(req), b = await readBody(req);
    const text = `${b.subject || ''}\n${b.body || ''}`;
    const r = analyze(text);
    const t = T[u.language] || T.English;
    const community = r.scam ? q(`SELECT COUNT(DISTINCT user_id) n FROM reports WHERE scam_id = ? AND (state = ? OR age_group = ? OR language = ?)`).get(r.scam.id, u.state, u.age_group, u.language).n : 0;
    return send(res, 200, {
      level: r.level, score: r.score, scam: r.scam, hits: r.hits, language: u.language, headline: t[r.level],
      community, ai: r.level === 'low' ? null : await aiExplain(text, r.scam, u.language), recovery: r.level === 'low' ? null : RECOVERY.default });
  }

  // static
  const root = path.join(__dirname, 'public');
  const f = path.join(root, p === '/' ? 'index.html' : p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try { await route(req, res, new URL(req.url, `http://${req.headers.host}`)); }
  catch (e) { if (e instanceof HttpError) return send(res, e.code, { error: e.message }); console.error(e); send(res, 500, { error: 'Server error.' }); }
}).listen(PORT, () => console.log(`Swivel running at http://localhost:${PORT}`));
