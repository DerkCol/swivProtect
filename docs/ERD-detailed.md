# SwivProtect: detailed entity relationship diagram

Every column carries a plain-English description.

Two SQLite files, joined by the server on one connection:

- `data/live.db` changes constantly: `USERS`, `REPORTS`, `ALERTS`, `NOTIFICATIONS`.
- `data/catalog.db` is static reference data built from `data/catalog.json`: everything else.

Solid lines are enforced foreign keys. Dashed lines are logical links that SQLite does not enforce.

```mermaid
erDiagram
  USERS ||--o{ REPORTS : files
  USERS ||--o{ NOTIFICATIONS : receives
  ALERTS ||..o{ NOTIFICATIONS : "sent as"
  CATEGORIES ||--o{ SCAMS : groups
  SCAMS ||--o{ RED_FLAGS : "has warning words"
  SCAMS ||--o{ TIPS : "has tips"
  SCAMS ||..o{ REPORTS : "reported as"
  SCAMS ||..o{ ALERTS : "alert is about"
  NOTIFICATION_TEMPLATES ||..o{ USERS : "message language"

  USERS {
    int id PK "Row number, assigned automatically"
    text user_name "Full name stored as Last, First"
    text email UK "Login email, lowercase, one per person"
    text salt "Random value mixed into the password hash"
    text pw_hash "Scrypt hash of the password, never the password"
    text token UK "Private key the apps send to identify the user"
    text google_email UK "Gmail address linked to the Gmail add-on, if any"
    text state "US state they live in, 2-letter code"
    text age_group "18-25, 26-40, 41-60 or 60+"
    text language "English, Spanish, Chinese, Tagalog or Vietnamese"
    text created_at "When the account was made"
  }
  REPORTS {
    int id PK "Report number, shown to the user as #SR-0001"
    int user_id FK "Who filed it, never shown to others"
    int scam_id "Which scam type, from the catalog"
    text source "How it arrived: Email or SMS"
    text outcome "blocked, fell_for or unsure"
    text state "Reporter's state, copied when filed"
    text age_group "Reporter's age range, copied when filed"
    text language "Reporter's language, copied when filed"
    int started_alert "1 if this report triggered an alert"
    text created_at "When filed, deleted after 30 days"
  }
  ALERTS {
    int id PK "Alert number"
    int scam_id "Which scam type the alert is about"
    text dimension "What it targets: state, age_group or language"
    text value "The matching value, such as FL or 60+"
    text flags "Warning words sent, in English"
    text fired_at "When it fired, deleted after 30 days"
  }
  NOTIFICATIONS {
    int id PK "Notification number"
    int user_id FK "Who receives it"
    int alert_id "Which alert caused it"
    int scam_id "Which scam type it warns about"
    text message "Text shown, in the user's language"
    text created_at "When created, deleted after 30 days"
  }
  CATEGORIES {
    int id PK "Category number, 1 to 5"
    text name "Group name shown when reporting"
    text summary "One-line description of the group"
  }
  SCAMS {
    int id PK "Scam number, 1 to 20"
    text slug UK "Short code name used in the catalog file"
    text name "Scam name shown to users"
    text summary "Plain-language explanation of the scam"
    int category_id FK "Which of the 5 groups it belongs to"
    int position "Order within its group, 1 to 4"
    text sources "Channels it arrives by: SMS, Email"
    text basis "Where the scam type was sourced from"
  }
  RED_FLAGS {
    int scam_id PK, FK "Which scam the word belongs to"
    text language PK "Language the word is written in"
    int position PK "Order within that scam and language"
    text flag "Warning word or phrase to look for"
  }
  TIPS {
    int scam_id PK, FK "Which scam the tip is for"
    int position PK "Order of the tip, first to third"
    text tip "Short what-to-do advice"
  }
  NOTIFICATION_TEMPLATES {
    text language PK "Language of the message"
    text template "Alert sentence, {flags} becomes the words"
  }
  PATCHES {
    text version PK "Catalog version number"
    text date "Date the version was released"
    text note "What changed in that version"
  }
  META {
    text key PK "Setting name, such as catalog_version"
    text value "The setting's value"
  }
  STATS {
    text source "Where the figure was published"
    text metric "What was measured"
    text value "The reported number"
    text note "Extra context for the number"
  }
```
