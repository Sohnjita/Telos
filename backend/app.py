"""
FastAPI server: serves the web UI and the JSON API.
Run with:  python backend/app.py    then open http://localhost:8000
"""
import os
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List

import db
import engine
import chat

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")

app = FastAPI(title="Money - personal finance brain")
db.init_db()


# ---------- Models ----------
class Account(BaseModel):
    name: str
    type: str
    balance: float = 0
    is_liability: bool = False
    apr: float = 0
    institution: str = ""


class Goal(BaseModel):
    name: str
    target_amount: float
    current_amount: float = 0
    monthly_contribution: float = 0
    target_date: str = ""
    priority: int = 1
    notes: str = ""


class Purchase(BaseModel):
    description: str
    amount: float
    category: str = "other"
    is_discretionary: bool = True
    account_id: Optional[int] = None
    verdict: str = ""
    was_made: bool = True
    occurred_at: Optional[str] = None


class ProfileIn(BaseModel):
    monthly_income: float = 0
    monthly_fixed: float = 0
    monthly_discretionary: float = 0
    emergency_fund_months: float = 6
    credit_score: int = 0


class DecideIn(BaseModel):
    amount: float
    category: str = "other"
    is_discretionary: bool = True


class ChatIn(BaseModel):
    conversation_id: Optional[int] = None
    message: str


# ---------- Accounts ----------
@app.get("/api/accounts")
def list_accounts():
    conn = db.get_conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM accounts ORDER BY is_liability, type, name").fetchall()]
    conn.close()
    return rows


@app.post("/api/accounts")
def create_account(a: Account):
    conn = db.get_conn()
    cur = conn.execute(
        "INSERT INTO accounts (name, type, balance, is_liability, apr, institution, updated_at) VALUES (?,?,?,?,?,?,?)",
        (a.name, a.type, a.balance, int(a.is_liability), a.apr, a.institution, db.now_iso()),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return {"id": new_id}


@app.put("/api/accounts/{account_id}")
def update_account(account_id: int, a: Account):
    conn = db.get_conn()
    conn.execute(
        "UPDATE accounts SET name=?, type=?, balance=?, is_liability=?, apr=?, institution=?, updated_at=? WHERE id=?",
        (a.name, a.type, a.balance, int(a.is_liability), a.apr, a.institution, db.now_iso(), account_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: int):
    conn = db.get_conn()
    conn.execute("DELETE FROM accounts WHERE id=?", (account_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------- Goals ----------
@app.get("/api/goals")
def list_goals():
    conn = db.get_conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM goals ORDER BY priority ASC, id ASC").fetchall()]
    conn.close()
    return rows


@app.post("/api/goals")
def create_goal(g: Goal):
    conn = db.get_conn()
    cur = conn.execute(
        "INSERT INTO goals (name, target_amount, current_amount, monthly_contribution, target_date, priority, notes, created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (g.name, g.target_amount, g.current_amount, g.monthly_contribution, g.target_date, g.priority, g.notes, db.now_iso()),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return {"id": new_id}


@app.put("/api/goals/{goal_id}")
def update_goal(goal_id: int, g: Goal):
    conn = db.get_conn()
    conn.execute(
        "UPDATE goals SET name=?, target_amount=?, current_amount=?, monthly_contribution=?, target_date=?, priority=?, notes=? WHERE id=?",
        (g.name, g.target_amount, g.current_amount, g.monthly_contribution, g.target_date, g.priority, g.notes, goal_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/goals/{goal_id}")
def delete_goal(goal_id: int):
    conn = db.get_conn()
    conn.execute("DELETE FROM goals WHERE id=?", (goal_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------- Purchases ----------
@app.get("/api/purchases")
def list_purchases():
    conn = db.get_conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM purchases ORDER BY occurred_at DESC, id DESC LIMIT 500").fetchall()]
    conn.close()
    return rows


@app.post("/api/purchases")
def create_purchase(p: Purchase):
    conn = db.get_conn()
    occurred = p.occurred_at or db.now_iso()[:10]
    cur = conn.execute(
        "INSERT INTO purchases (description, amount, category, is_discretionary, account_id, verdict, was_made, occurred_at, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (p.description, p.amount, p.category, int(p.is_discretionary), p.account_id, p.verdict, int(p.was_made), occurred, db.now_iso()),
    )
    # If the purchase was made and tied to an account, decrement that account's balance.
    if p.was_made and p.account_id:
        conn.execute("UPDATE accounts SET balance = balance - ?, updated_at=? WHERE id=? AND is_liability=0",
                     (p.amount, db.now_iso(), p.account_id))
        conn.execute("UPDATE accounts SET balance = balance + ?, updated_at=? WHERE id=? AND is_liability=1",
                     (p.amount, db.now_iso(), p.account_id))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return {"id": new_id}


@app.delete("/api/purchases/{purchase_id}")
def delete_purchase(purchase_id: int):
    conn = db.get_conn()
    conn.execute("DELETE FROM purchases WHERE id=?", (purchase_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------- Profile ----------
@app.get("/api/profile")
def get_profile():
    conn = db.get_conn()
    row = dict(conn.execute("SELECT * FROM profile WHERE id=1").fetchone())
    conn.close()
    return row


@app.put("/api/profile")
def update_profile(p: ProfileIn):
    conn = db.get_conn()
    conn.execute(
        "UPDATE profile SET monthly_income=?, monthly_fixed=?, monthly_discretionary=?, emergency_fund_months=?, credit_score=?, updated_at=? WHERE id=1",
        (p.monthly_income, p.monthly_fixed, p.monthly_discretionary, p.emergency_fund_months, p.credit_score, db.now_iso()),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------- Dashboard + Decide ----------
@app.get("/api/dashboard")
def dashboard():
    conn = db.get_conn()
    snap = engine.snapshot(conn)
    conn.close()
    # Drop nested heavy fields the UI doesn't need raw.
    snap.pop("accounts", None)
    return snap


@app.post("/api/decide")
def decide(d: DecideIn):
    conn = db.get_conn()
    result = engine.decide(conn, d.amount, d.category, d.is_discretionary)
    conn.close()
    return result


# ---------- Conversations / Chat ----------
@app.get("/api/conversations")
def list_conversations():
    conn = db.get_conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM conversations ORDER BY id DESC").fetchall()]
    conn.close()
    return rows


@app.get("/api/conversations/{conv_id}")
def get_conversation(conv_id: int):
    conn = db.get_conn()
    conv = conn.execute("SELECT * FROM conversations WHERE id=?", (conv_id,)).fetchone()
    if not conv:
        conn.close()
        raise HTTPException(404, "Not found")
    msgs = [dict(r) for r in conn.execute("SELECT * FROM messages WHERE conversation_id=? ORDER BY id ASC", (conv_id,)).fetchall()]
    conn.close()
    return {"conversation": dict(conv), "messages": msgs}


@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: int):
    conn = db.get_conn()
    conn.execute("DELETE FROM conversations WHERE id=?", (conv_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/chat/status")
def chat_status():
    return {"ai_enabled": chat.ai_enabled()}


@app.post("/api/chat")
def post_chat(c: ChatIn):
    conn = db.get_conn()
    conv_id = c.conversation_id
    if not conv_id:
        title = (c.message[:40] + "...") if len(c.message) > 40 else c.message
        cur = conn.execute("INSERT INTO conversations (title, created_at) VALUES (?,?)", (title or "New conversation", db.now_iso()))
        conv_id = cur.lastrowid

    history = [dict(r) for r in conn.execute("SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id ASC", (conv_id,)).fetchall()]
    conn.execute("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?,?,?,?)",
                 (conv_id, "user", c.message, db.now_iso()))

    answer = chat.reply(conn, c.message, history)
    conn.execute("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?,?,?,?)",
                 (conv_id, "assistant", answer, db.now_iso()))
    conn.commit()
    conn.close()
    return {"conversation_id": conv_id, "reply": answer}


# ---------- Static frontend (mounted last so /api wins) ----------
@app.get("/")
def root():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    print("\n  Money is running at:  http://localhost:8000\n")
    uvicorn.run(app, host="127.0.0.1", port=8000)
