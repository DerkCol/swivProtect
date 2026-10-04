"""Builds catalog.db (STATIC scam catalog) from catalog.json.
Patch workflow: edit catalog.json (add a scam, bump "version", add a "patches" entry), then run this script.
catalog.db is read-only reference data; the app never writes to it."""
import json, os, sqlite3
HERE = os.path.dirname(os.path.abspath(__file__))
cat = json.load(open(os.path.join(HERE, 'catalog.json'), encoding='utf-8'))
L = cat['languages']

problems = []
for s in cat['scams']:
    for code in L:
        n = len(s['flags'].get(code, []))
        if not 3 <= n <= 5: problems.append(f"scam {s['id']} {s['slug']}: {n} flags for {code} (need 3-5)")
    if not 2 <= len(s.get('tips', [])) <= 4: problems.append(f"scam {s['id']}: needs 2-4 tips")
    if set(s['sources'].split(',')) - {'SMS', 'Email'}: problems.append(f"scam {s['id']}: bad sources")
if len({s['id'] for s in cat['scams']}) != len(cat['scams']): problems.append('duplicate scam ids')
cat_ids = {c['id'] for c in cat['categories']}
for s in cat['scams']:
    if s.get('category') not in cat_ids: problems.append(f"scam {s['id']}: unknown category")
if set(cat['notification_templates']) != set(L): problems.append('notification template languages mismatch')
if problems: raise SystemExit('catalog.json problems:\n  ' + '\n  '.join(problems))

path = os.path.join(HERE, 'catalog.db')
if os.path.exists(path): os.remove(path)
con = sqlite3.connect(path)
con.executescript('''
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE patches (version TEXT PRIMARY KEY, date TEXT NOT NULL, note TEXT NOT NULL);
CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, summary TEXT NOT NULL);
CREATE TABLE scams (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, summary TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id), position INTEGER NOT NULL,   -- report-flow grouping
  sources TEXT NOT NULL,               -- which channels it arrives by: SMS, Email or SMS,Email
  basis TEXT NOT NULL                  -- where the scam category comes from
);
CREATE TABLE red_flags (
  scam_id INTEGER NOT NULL REFERENCES scams(id), language TEXT NOT NULL, position INTEGER NOT NULL, flag TEXT NOT NULL,
  PRIMARY KEY (scam_id, language, position)
);
CREATE TABLE tips (scam_id INTEGER NOT NULL REFERENCES scams(id), position INTEGER NOT NULL, tip TEXT NOT NULL, PRIMARY KEY (scam_id, position));   -- 'what to do' shown in the warning popup
CREATE TABLE notification_templates (language TEXT PRIMARY KEY, template TEXT NOT NULL);   -- {flags} is replaced with 3-5 red-flag words
CREATE TABLE stats (source TEXT NOT NULL, metric TEXT NOT NULL, value TEXT NOT NULL, note TEXT);
''')
con.execute("INSERT INTO meta VALUES ('catalog_version', ?)", (cat['version'],))
con.executemany('INSERT INTO patches VALUES (?,?,?)', [(p['version'], p['date'], p['note']) for p in cat['patches']])
con.executemany('INSERT INTO categories VALUES (?,?,?)', [(c['id'], c['name'], c['summary']) for c in cat['categories']])
con.executemany('INSERT INTO scams (id, slug, name, summary, category_id, position, sources, basis) VALUES (?,?,?,?,?,?,?,?)',
  [(s['id'], s['slug'], s['name'], s['summary'], s['category'], s['position'], s['sources'], s['basis']) for s in cat['scams']])
con.executemany('INSERT INTO red_flags VALUES (?,?,?,?)',
  [(s['id'], L[c], i, f) for s in cat['scams'] for c in L for i, f in enumerate(s['flags'][c])])
con.executemany('INSERT INTO tips VALUES (?,?,?)', [(s['id'], i, t) for s in cat['scams'] for i, t in enumerate(s['tips'])])
con.executemany('INSERT INTO notification_templates VALUES (?,?)', [(L[c], t) for c, t in cat['notification_templates'].items()])
con.executemany('INSERT INTO stats VALUES (?,?,?,?)', [(s['source'], s['metric'], s['value'], s['note']) for s in cat['stats']])
con.commit(); con.close()
print(f"catalog.db v{cat['version']}: {len(cat['scams'])} scams, {len(cat['scams'])*len(L)} flag lists")
