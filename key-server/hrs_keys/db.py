"""SQLite storage of the key server.

Only what is needed to sell and check access: no names, emails, phones, IP addresses or resumes.
A key is stored as an HMAC hash; an installation as a hash of its random id.
"""
import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS tariffs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    price_rub_from INTEGER NOT NULL,
    price_rub_to INTEGER NOT NULL,
    months INTEGER NOT NULL,
    device_limit INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    key_hint TEXT NOT NULL,
    tariff_id TEXT NOT NULL REFERENCES tariffs(id),
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    device_limit INTEGER NOT NULL,
    order_ref TEXT,
    revoked_at TEXT,
    revoke_reason TEXT CHECK (revoke_reason IN ('refund', 'violation', 'reissue', 'other'))
);
CREATE TABLE IF NOT EXISTS activations (
    key_id TEXT NOT NULL REFERENCES keys(id),
    install_hash TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (key_id, install_hash)
);
CREATE TABLE IF NOT EXISTS bundles (
    version TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    size INTEGER NOT NULL,
    signature TEXT NOT NULL,
    published_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('activate', 'check', 'download', 'denied', 'admin')),
    detail TEXT,
    at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_key ON events(key_id, at);
-- The methodology draft: every save is a revision, the file tree of a revision is {path: blob sha}.
CREATE TABLE IF NOT EXISTS revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    by_role TEXT NOT NULL,
    message TEXT NOT NULL,
    tree TEXT NOT NULL
);
-- Agencies buy keys in batches (owner decision 2026-11-15); an agency may get its own read-only login.
CREATE TABLE IF NOT EXISTS agencies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_name TEXT,
    phone TEXT,
    email TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    archived_at TEXT
);
CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    agency_id TEXT NOT NULL REFERENCES agencies(id),
    count INTEGER NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    device_limit INTEGER NOT NULL,
    recipient TEXT
);
-- Logins of agencies: only a hash of the token is kept, the token itself is shown once.
CREATE TABLE IF NOT EXISTS agency_tokens (
    id TEXT PRIMARY KEY,
    agency_id TEXT NOT NULL REFERENCES agencies(id),
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
);
-- Which published version each channel gets: test keys first, then everyone (stable).
CREATE TABLE IF NOT EXISTS current_bundle (
    channel TEXT PRIMARY KEY CHECK (channel IN ('stable', 'test')),
    version TEXT NOT NULL REFERENCES bundles(version)
);
"""

# Columns added after the first release: (table, column, definition).
MIGRATIONS = [
    ("keys", "channel", "TEXT NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable', 'test'))"),
    ("bundles", "format", "INTEGER NOT NULL DEFAULT 1"),
    ("bundles", "min_hrs", "TEXT"),
    ("bundles", "revision", "INTEGER"),
    ("bundles", "note", "TEXT"),
    # Each key stays on the version it has until its person agrees to a newer one (hrs 0.4.0+).
    ("keys", "pinned_version", "TEXT"),
    ("keys", "pin_auto", "TEXT"),  # JSON: an important version installed without asking, to tell the person
    ("bundles", "important", "INTEGER NOT NULL DEFAULT 0"),
    # Whose key it is: an agency's (agency_id, batch_id), a private buyer's or a tester's.
    ("keys", "segment", "TEXT NOT NULL DEFAULT 'private'"),
    ("keys", "agency_id", "TEXT REFERENCES agencies(id)"),
    ("keys", "batch_id", "TEXT REFERENCES batches(id)"),
    ("keys", "note", "TEXT"),  # for whom the key was issued
    # The archive instead of deleting: the key stops working and leaves every list and count; it can come back.
    ("keys", "archived_at", "TEXT"),
    # Why it went to the archive and what state it was in at that moment: active, expiring, expired, revoked.
    ("keys", "archive_reason", "TEXT"),
    ("keys", "archive_note", "TEXT"),
    ("keys", "archived_state", "TEXT"),
]

# One tariff (owner decision 2026-11-15): the admin changes only its price.
# The title, term and device limit are set here. Rows of the retired tariffs stay
# switched off, because already issued keys refer to them.
TARIFF_ID = "self"
TARIFF_TITLE = "JobShturman"
DEFAULT_PRICE_RUB = 19990
DEFAULT_TARIFFS = [(TARIFF_ID, TARIFF_TITLE, DEFAULT_PRICE_RUB, DEFAULT_PRICE_RUB, 12, 2)]


class DB:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def init(self):
        conn = sqlite3.connect(self.path)
        conn.executescript(SCHEMA)
        for table, column, definition in MIGRATIONS:
            if column not in [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        conn.execute("CREATE INDEX IF NOT EXISTS keys_agency ON keys(agency_id)")
        conn.commit()
        conn.close()
        with self.tx() as c:
            c.executemany("INSERT OR IGNORE INTO tariffs (id, title, price_rub_from, price_rub_to, months, device_limit)"
                          " VALUES (?, ?, ?, ?, ?, ?)", DEFAULT_TARIFFS)
            c.execute("UPDATE tariffs SET title = ?, active = 1 WHERE id = ?", (TARIFF_TITLE, TARIFF_ID))
            c.execute("UPDATE tariffs SET active = 0 WHERE id != ?", (TARIFF_ID,))
        return self

    @contextmanager
    def tx(self, keep_on=()):
        """One transaction. Exceptions of the keep_on types still commit what was written (refusal logs)."""
        conn = sqlite3.connect(self.path, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.execute("COMMIT")
        except keep_on:
            conn.execute("COMMIT")
            raise
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()

    def columns(self) -> dict[str, list[str]]:
        with self.tx() as c:
            tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
            return {t: [r[1] for r in c.execute(f"PRAGMA table_info({t})")] for t in tables if t != "sqlite_sequence"}
