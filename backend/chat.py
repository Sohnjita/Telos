"""
Optional AI chat. OFF by default = $0.

If you set the environment variable ANTHROPIC_API_KEY, this uses Claude Haiku
(the cheapest model) with your live financial context for natural conversation.
If no key is set, it falls back to a helpful rule-based reply at no cost.

Enable later with:  setx ANTHROPIC_API_KEY "sk-ant-..."   (then restart)
"""
import os
import json
from engine import snapshot, _fmt_money

MODEL = "claude-haiku-4-5-20251001"  # cheapest current model


def ai_enabled():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _context_blurb(conn):
    snap = snapshot(conn)
    p = snap["profile"]
    return (
        f"Net worth: {_fmt_money(snap['net_worth'])}. "
        f"Liquid (checking+savings): {_fmt_money(snap['liquid'])}. "
        f"Liabilities: {_fmt_money(snap['liabilities'])}. "
        f"Monthly income: {_fmt_money(p['monthly_income'])}, fixed costs: {_fmt_money(p['monthly_fixed'])}, "
        f"discretionary budget: {_fmt_money(snap['discretionary_budget'])} "
        f"({_fmt_money(snap['remaining_budget'])} left this month). "
        f"Emergency fund target: {_fmt_money(snap['emergency_target'])}."
    )


def reply(conn, user_message, history=None):
    """Return an assistant reply string."""
    context = _context_blurb(conn)

    if not ai_enabled():
        return (
            "AI chat is off (no API key set), so here's the rule-based view:\n\n"
            f"{context}\n\n"
            "Use the **Decide** tab to test any specific purchase - it gives a yes/caution/veto "
            "with the exact goal impact, free of charge. To turn on natural-language chat later, "
            "set an ANTHROPIC_API_KEY and restart."
        )

    try:
        from anthropic import Anthropic

        client = Anthropic()
        system = (
            "You are a strict but supportive personal-finance coach embedded in the user's budgeting app. "
            "You have their real numbers below. Be concise, specific, and push back on spending that hurts "
            "their long-term goals. Always tie advice to their actual figures.\n\n"
            f"USER FINANCIAL CONTEXT:\n{context}"
        )
        msgs = []
        for h in (history or [])[-8:]:
            msgs.append({"role": h["role"], "content": h["content"]})
        msgs.append({"role": "user", "content": user_message})

        resp = client.messages.create(
            model=MODEL,
            max_tokens=600,
            system=system,
            messages=msgs,
        )
        return "".join(block.text for block in resp.content if block.type == "text")
    except Exception as e:
        return f"(AI chat error: {e}). The free Decide tab still works for purchase checks."
