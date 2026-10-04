-- LIVE (revolving) database: accounts, user scam reports, and fired alerts.
CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_name  TEXT NOT NULL,                       -- "Last, First", imported from app sign-up / log-in
  email      TEXT NOT NULL UNIQUE,
  salt       TEXT,                                -- password hash + API key for the app / Gmail add-on / SMS automation
  pw_hash    TEXT,
  token      TEXT UNIQUE,
  google_email TEXT,                              -- Gmail address linked to the Gmail add-on, if any
  state      TEXT NOT NULL CHECK (state IN ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY')),
  age_group  TEXT NOT NULL CHECK (age_group IN ('18-25','26-40','41-60','60+')),
  language   TEXT NOT NULL CHECK (language IN ('English','Spanish','Chinese','Tagalog','Vietnamese')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_users_google_email ON users (google_email);
CREATE INDEX idx_users_state ON users (state);
CREATE INDEX idx_users_age   ON users (age_group);
CREATE INDEX idx_users_lang  ON users (language);

-- Reports hold no name or email. They copy the reporter's state/age/language at submit time.
CREATE TABLE reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- only used to count distinct people
  scam_id    INTEGER NOT NULL,                                          -- id in catalog.db
  source     TEXT NOT NULL CHECK (source IN ('Email','SMS')),
  outcome    TEXT NOT NULL DEFAULT 'unsure' CHECK (outcome IN ('blocked','fell_for','unsure')),
  state      TEXT NOT NULL,
  age_group  TEXT NOT NULL,
  language   TEXT NOT NULL,
  started_alert INTEGER NOT NULL DEFAULT 0,       -- 1 if this report tipped off an alert
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_reports_scam ON reports (scam_id, created_at);

-- One row per push alert fired; also stops the same alert from re-firing within the window.
CREATE TABLE alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scam_id    INTEGER NOT NULL,
  dimension  TEXT NOT NULL CHECK (dimension IN ('state','age_group','language')),
  value      TEXT NOT NULL,
  flags      TEXT NOT NULL,                       -- red-flag words sent, in the audience's language
  fired_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Outbox: one row per user per alert. The app polls this (swap for real push later). Purged after the window.
CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_id   INTEGER NOT NULL,
  scam_id    INTEGER NOT NULL,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notif_user ON notifications (user_id, id);
