"""Checks the live DB rules against a throwaway database (live.db is untouched). Run: python3 test_live.py"""
import os, tempfile, live_db as L

tmp = os.path.join(tempfile.mkdtemp(), 'test.db')
con = L.connect(live_path=tmp)
n = [0]
def user(state, age, lang):
    n[0] += 1
    return L.add_user(con, f'Test, User{n[0]}', f'u{n[0]}@example.com', state, age, lang)

# --- 1. trigger fires at 5 reporters, per dimension, to the right audience, in the right language
reporters = [user('FL', '60+', 'Spanish') for _ in range(5)]
o_state = user('FL', '26-40', 'English')       # shares state only
o_age   = user('TX', '60+', 'English')         # shares age only
o_lang  = user('TX', '18-25', 'Spanish')       # shares language only
o_none  = user('NY', '18-25', 'English')       # shares nothing
res = [L.submit_report(con, u, 1, 'SMS', 'blocked') for u in reporters]
assert all(r['alerts'] == [] for r in res[:4]), 'fired before 5 reports'
fired = {a['dimension']: a for a in res[4]['alerts']}
assert set(fired) == {'state', 'age_group', 'language'}, fired.keys()
ids = {d: {r['user_id'] for r in a['recipients']} for d, a in fired.items()}
assert ids == {'state': {o_state}, 'age_group': {o_age}, 'language': {o_lang}}, ids
assert not (set(reporters) & set().union(*ids.values())), 'a reporter was alerted'
assert o_none not in set().union(*ids.values())
assert fired['language']['recipients'][0]['message'].startswith('Hola'), 'not localized'
print('1. trigger + audience + language: ok')
print('   sample ->', fired['state']['recipients'][0]['message'])
print('   sample ->', fired['language']['recipients'][0]['message'])

# --- 2. no re-fire, and a person reporting twice counts once
extra = user('FL', '60+', 'Spanish')
r = L.submit_report(con, extra, 1, 'Email')
assert r['stored'] and r['alerts'] == [], 'alert re-fired inside the window'
assert L.submit_report(con, extra, 1, 'Email') == {'stored': False, 'reason': 'duplicate', 'alerts': []}
print('2. no re-fire + duplicate ignored: ok')

# --- 3. cap: at most 15 reports of one scam sharing 2 categories
many = [user('CA', '26-40', 'English') for _ in range(18)]
out = [L.submit_report(con, u, 2, 'SMS') for u in many]
stored = sum(o['stored'] for o in out)
assert stored == 15 and out[15]['reason'].startswith('cap'), (stored, out[15])
print('3. cap of 15: ok')

# --- 4. purge drops anything older than a month
con.execute("UPDATE reports SET created_at = datetime('now','-31 days') WHERE scam_id = 2")
con.execute("UPDATE alerts  SET fired_at  = datetime('now','-31 days')")
con.commit()
dr, da = L.purge(con)
left = con.execute('SELECT COUNT(*) FROM reports WHERE scam_id=2').fetchone()[0]
assert left == 0 and dr == 15 and da >= 3, (dr, da, left)
# fresh start: the same group can alert again after the window
assert con.execute('SELECT COUNT(*) FROM alerts').fetchone()[0] == 0
print('4. 30-day purge: ok')
print('ALL PASSED')
