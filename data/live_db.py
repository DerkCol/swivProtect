"""Live (revolving) scam-report database + alert trigger.

Rules (set at the top, change here):
  * ALERT_THRESHOLD distinct people report the same scam within WINDOW_DAYS and share a state, age group
    OR language  ->  push an alert to every OTHER user with that same state / age group / language.
  * PAIR_CAP: never keep more than this many reports of one scam that share any 2 of (state, age, language).
  * Anything older than WINDOW_DAYS is deleted (reports and fired alerts).
Reports never expose who sent them; the alert text contains only red-flag words from catalog.db."""
import os, sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
ALERT_THRESHOLD, PAIR_CAP, WINDOW_DAYS = 5, 15, 30
DIMS = ('state', 'age_group', 'language')
PAIRS = (('state', 'age_group'), ('state', 'language'), ('age_group', 'language'))
STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']
AGE_GROUPS = ['18-25', '26-40', '41-60', '60+']
LANGUAGES = ['English', 'Spanish', 'Chinese', 'Tagalog', 'Vietnamese']   # top 5 spoken in the U.S.


def connect(live_path=None, catalog_path=None):
    con = sqlite3.connect(live_path or os.path.join(HERE, 'live.db'))
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys = ON')
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='users'").fetchone():
        con.executescript(open(os.path.join(HERE, 'live_schema.sql')).read())
    con.execute('ATTACH DATABASE ? AS catalog', (catalog_path or os.path.join(HERE, 'catalog.db'),))
    return con


def purge(con):
    cutoff = f'-{WINDOW_DAYS} days'
    r = con.execute("DELETE FROM reports WHERE created_at < datetime('now', ?)", (cutoff,)).rowcount
    a = con.execute("DELETE FROM alerts  WHERE fired_at  < datetime('now', ?)", (cutoff,)).rowcount
    con.execute("DELETE FROM notifications WHERE created_at < datetime('now', ?)", (cutoff,))
    con.commit()
    return r, a


def add_user(con, user_name, email, state, age_group, language):
    cur = con.execute('INSERT INTO users (user_name, email, state, age_group, language) VALUES (?,?,?,?,?)',
                      (user_name, email.lower(), state, age_group, language))
    con.commit()
    return cur.lastrowid


def _flags_message(con, scam_id, language):
    flags = [r[0] for r in con.execute('SELECT flag FROM catalog.red_flags WHERE scam_id=? AND language=? ORDER BY position', (scam_id, language))]
    tpl = con.execute('SELECT template FROM catalog.notification_templates WHERE language=?', (language,)).fetchone()[0]
    return ', '.join(flags), tpl.replace('{flags}', ', '.join(flags))


def submit_report(con, user_id, scam_id, source, outcome='unsure'):
    """Store a report, then fire any alerts it triggers.
    Returns {'stored': bool, 'reason': str|None, 'alerts': [{dimension, value, flags, message(s) per language, user_ids}]}"""
    purge(con)
    u = con.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
    if not u: raise ValueError('unknown user')
    if not con.execute('SELECT 1 FROM catalog.scams WHERE id=?', (scam_id,)).fetchone(): raise ValueError('unknown scam id')

    # same person reporting the same scam again inside the window counts once
    if con.execute('SELECT 1 FROM reports WHERE user_id=? AND scam_id=?', (user_id, scam_id)).fetchone():
        return {'stored': False, 'reason': 'duplicate', 'alerts': []}
    # cap: don't keep PAIR_CAP reports of this scam that share the same 2 categories
    for a, b in PAIRS:
        n = con.execute(f'SELECT COUNT(*) FROM reports WHERE scam_id=? AND {a}=? AND {b}=?', (scam_id, u[a], u[b])).fetchone()[0]
        if n >= PAIR_CAP:
            return {'stored': False, 'reason': f'cap ({a}+{b})', 'alerts': []}

    con.execute('INSERT INTO reports (user_id, scam_id, source, outcome, state, age_group, language) VALUES (?,?,?,?,?,?,?)',
                (user_id, scam_id, source, outcome, u['state'], u['age_group'], u['language']))
    con.commit()

    fired = []
    for dim in DIMS:
        val = u[dim]
        n = con.execute(f'SELECT COUNT(DISTINCT user_id) FROM reports WHERE scam_id=? AND {dim}=?', (scam_id, val)).fetchone()[0]
        if n < ALERT_THRESHOLD: continue
        if con.execute('SELECT 1 FROM alerts WHERE scam_id=? AND dimension=? AND value=?', (scam_id, dim, val)).fetchone(): continue
        audience = con.execute(f'''SELECT id, language FROM users WHERE {dim}=?
                                   AND id NOT IN (SELECT user_id FROM reports WHERE scam_id=? AND {dim}=?)''', (val, scam_id, val)).fetchall()
        msgs = {}
        for lang in {r['language'] for r in audience}:
            msgs[lang] = _flags_message(con, scam_id, lang)[1]
        alert_id = con.execute('INSERT INTO alerts (scam_id, dimension, value, flags) VALUES (?,?,?,?)',
                               (scam_id, dim, val, _flags_message(con, scam_id, 'English')[0])).lastrowid
        con.executemany('INSERT INTO notifications (user_id, alert_id, scam_id, message) VALUES (?,?,?,?)',
                        [(r['id'], alert_id, scam_id, msgs[r['language']]) for r in audience
                         if not con.execute('SELECT 1 FROM notifications WHERE user_id=? AND scam_id=?', (r['id'], scam_id)).fetchone()])
        fired.append({'dimension': dim, 'value': val, 'reporters': n,
                      'recipients': [{'user_id': r['id'], 'message': msgs[r['language']]} for r in audience]})
    if fired:
        con.execute('UPDATE reports SET started_alert = 1 WHERE user_id=? AND scam_id=?', (user_id, scam_id))
    con.commit()
    return {'stored': True, 'reason': None, 'alerts': fired}


if __name__ == '__main__':
    c = connect()
    print('live.db ready. purged (reports, alerts):', purge(c))
