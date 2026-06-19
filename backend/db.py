"""SQLite storage for the personal finance app. Single local file, zero cost, fully private."""
import sqlite3
import os
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DATA_DIR, "money.db")


def get_conn():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_conn()
    c = conn.cursor()

    # Accounts: assets (checking/savings/401k/roth/...) and liabilities (credit cards, loans).
    # Liability balances are stored as positive numbers and flagged with is_liability=1.
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS accounts (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            type          TEXT NOT NULL,         -- checking, savings, 401k, roth, brokerage, credit_card, student_loan, other
            balance       REAL NOT NULL DEFAULT 0,
            is_liability  INTEGER NOT NULL DEFAULT 0,
            apr           REAL DEFAULT 0,         -- for loans / cards
            institution   TEXT DEFAULT '',
            updated_at    TEXT NOT NULL
        )
        """
    )

    # Goals: what you're saving toward.
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS goals (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            name                TEXT NOT NULL,
            target_amount       REAL NOT NULL,
            current_amount      REAL NOT NULL DEFAULT 0,
            monthly_contribution REAL NOT NULL DEFAULT 0,
            target_date         TEXT DEFAULT '',
            priority            INTEGER NOT NULL DEFAULT 1,  -- 1 highest
            notes               TEXT DEFAULT '',
            created_at          TEXT NOT NULL
        )
        """
    )

    # Purchases: every spend, real-time. was_made=1 means it actually happened.
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS purchases (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            description     TEXT NOT NULL,
            amount          REAL NOT NULL,
            category        TEXT NOT NULL DEFAULT 'other',
            is_discretionary INTEGER NOT NULL DEFAULT 1,
            account_id      INTEGER,
            verdict         TEXT DEFAULT '',       -- yes / caution / veto
            was_made        INTEGER NOT NULL DEFAULT 0,
            occurred_at     TEXT NOT NULL,         -- date of the purchase
            created_at      TEXT NOT NULL,
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
        )
        """
    )

    # Conversations + messages (saved chats / decision logs).
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS conversations (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT NOT NULL DEFAULT 'New conversation',
            created_at  TEXT NOT NULL
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            role            TEXT NOT NULL,         -- user / assistant
            content         TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )
        """
    )

    # Profile: single-row settings (income, budgets, targets).
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS profile (
            id                       INTEGER PRIMARY KEY CHECK (id = 1),
            monthly_income           REAL NOT NULL DEFAULT 0,
            monthly_fixed            REAL NOT NULL DEFAULT 0,
            monthly_discretionary    REAL NOT NULL DEFAULT 0,
            emergency_fund_months    REAL NOT NULL DEFAULT 6,
            credit_score             INTEGER DEFAULT 0,
            updated_at               TEXT NOT NULL
        )
        """
    )

    # Ensure the single profile row exists.
    row = c.execute("SELECT id FROM profile WHERE id = 1").fetchone()
    if not row:
        c.execute(
            "INSERT INTO profile (id, monthly_income, monthly_fixed, monthly_discretionary, emergency_fund_months, credit_score, updated_at) "
            "VALUES (1, 0, 0, 0, 6, 0, ?)",
            (datetime.utcnow().isoformat(),),
        )

    conn.commit()
    conn.close()


def now_iso():
    return datetime.utcnow().isoformat()
