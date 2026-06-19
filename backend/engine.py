"""
The decision engine. 100% deterministic arithmetic — no API calls, no cost.

Given your full financial picture and a proposed purchase, it returns:
  - a verdict (yes / caution / veto)
  - the reasons behind it
  - the impact on every savings goal (how much each goal slips)
  - concrete workarounds to avoid the spend
"""
from datetime import datetime, date
import calendar
import math

LIQUID_TYPES = ("checking", "savings")


def _today():
    return date.today()


def _days_until_month_reset():
    t = _today()
    last_day = calendar.monthrange(t.year, t.month)[1]
    return (last_day - t.day) + 1


def _month_bounds():
    t = _today()
    start = date(t.year, t.month, 1).isoformat()
    last_day = calendar.monthrange(t.year, t.month)[1]
    end = date(t.year, t.month, last_day).isoformat()
    return start, end


def _add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


def _fmt_money(x):
    return f"${x:,.0f}" if abs(x - round(x)) < 0.005 else f"${x:,.2f}"


def snapshot(conn):
    """Compute the current financial picture from the database."""
    accounts = [dict(r) for r in conn.execute("SELECT * FROM accounts").fetchall()]
    profile = dict(conn.execute("SELECT * FROM profile WHERE id = 1").fetchone())

    assets = sum(a["balance"] for a in accounts if not a["is_liability"])
    liabilities = sum(a["balance"] for a in accounts if a["is_liability"])
    net_worth = assets - liabilities
    liquid = sum(a["balance"] for a in accounts if a["type"] in LIQUID_TYPES and not a["is_liability"])

    start, end = _month_bounds()
    spent_rows = conn.execute(
        "SELECT amount, is_discretionary FROM purchases WHERE was_made = 1 AND occurred_at >= ? AND occurred_at <= ?",
        (start, end),
    ).fetchall()
    spent_total = sum(r["amount"] for r in spent_rows)
    spent_discretionary = sum(r["amount"] for r in spent_rows if r["is_discretionary"])

    discretionary_budget = profile["monthly_discretionary"]
    remaining_budget = discretionary_budget - spent_discretionary

    monthly_fixed = profile["monthly_fixed"]
    emergency_target = monthly_fixed * profile["emergency_fund_months"]
    emergency_coverage_months = (liquid / monthly_fixed) if monthly_fixed > 0 else None

    savings_capacity = profile["monthly_income"] - monthly_fixed - discretionary_budget

    return {
        "accounts": accounts,
        "profile": profile,
        "assets": assets,
        "liabilities": liabilities,
        "net_worth": net_worth,
        "liquid": liquid,
        "spent_this_month": spent_total,
        "discretionary_spent_this_month": spent_discretionary,
        "discretionary_budget": discretionary_budget,
        "remaining_budget": remaining_budget,
        "emergency_target": emergency_target,
        "emergency_coverage_months": emergency_coverage_months,
        "savings_capacity": savings_capacity,
    }


def _goal_eta(remaining, monthly):
    if monthly <= 0 or remaining <= 0:
        return None, None
    months = math.ceil(remaining / monthly)
    return months, _add_months(_today(), months)


def goal_impacts(conn, snap, amount, is_discretionary):
    """
    How does spending `amount` change each goal's timeline?

    Logic: money you spend beyond your discretionary budget eats into your
    savings capacity, which is what funds your goals. The 'overflow' (the part
    of the purchase that exceeds what's left in this month's budget) is what
    actually delays goals.
    """
    goals = [dict(r) for r in conn.execute("SELECT * FROM goals ORDER BY priority ASC, id ASC").fetchall()]

    if is_discretionary:
        overflow = max(0.0, amount - max(0.0, snap["remaining_budget"]))
    else:
        overflow = amount  # essential spend pulled from savings hits goals directly

    impacts = []
    for g in goals:
        remaining = g["target_amount"] - g["current_amount"]
        monthly = g["monthly_contribution"]
        months_now, eta_now = _goal_eta(remaining, monthly)

        # If the overflow comes out of this goal's funding, it adds time.
        months_after, eta_after = months_now, eta_now
        delay_days = 0
        if overflow > 0 and monthly > 0 and remaining > 0:
            extra_months = overflow / monthly
            delay_days = round(extra_months * 30.4)
            months_after, eta_after = _goal_eta(remaining + overflow, monthly)

        # "Goal-time cost": even within budget, frame the money as goal progress.
        progress_days = round((amount / monthly) * 30.4) if monthly > 0 else None

        impacts.append({
            "id": g["id"],
            "name": g["name"],
            "priority": g["priority"],
            "remaining": remaining,
            "monthly_contribution": monthly,
            "eta_now": eta_now.isoformat() if eta_now else None,
            "eta_after": eta_after.isoformat() if eta_after else None,
            "delay_days": delay_days,
            "progress_days": progress_days,
        })
    return impacts, overflow


def decide(conn, amount, category="other", is_discretionary=True):
    """Return a full verdict for a proposed purchase."""
    snap = snapshot(conn)
    amount = float(amount)

    liquid = snap["liquid"]
    remaining_budget = snap["remaining_budget"]
    emergency_target = snap["emergency_target"]

    liquid_after = liquid - amount
    budget_after = remaining_budget - amount if is_discretionary else remaining_budget

    reasons = []
    verdict = "yes"

    # --- Hard stops -> VETO ---
    if amount > liquid:
        verdict = "veto"
        reasons.append(f"You don't have the cash. This is {_fmt_money(amount)} but you only hold {_fmt_money(liquid)} in liquid accounts.")
    elif liquid_after < emergency_target and emergency_target > 0:
        verdict = "veto"
        shortfall = emergency_target - liquid_after
        reasons.append(
            f"This would dip into your emergency fund. After buying, you'd have {_fmt_money(liquid_after)} liquid, "
            f"{_fmt_money(shortfall)} below your {_fmt_money(emergency_target)} safety target."
        )
    elif is_discretionary and snap["discretionary_budget"] > 0 and budget_after < -0.5 * snap["discretionary_budget"]:
        verdict = "veto"
        over = -budget_after
        reasons.append(
            f"This blows past your monthly fun-money budget by {_fmt_money(over)} "
            f"(budget {_fmt_money(snap['discretionary_budget'])}, {_fmt_money(max(0, remaining_budget))} left)."
        )

    # --- Soft warnings -> CAUTION (only if not already vetoed) ---
    if verdict == "yes" and is_discretionary:
        if budget_after < 0:
            verdict = "caution"
            reasons.append(
                f"This pushes you {_fmt_money(-budget_after)} over this month's {_fmt_money(snap['discretionary_budget'])} discretionary budget."
            )
        elif snap["discretionary_budget"] > 0 and amount > 0.5 * snap["discretionary_budget"]:
            verdict = "caution"
            reasons.append(
                f"This single purchase eats {amount / snap['discretionary_budget'] * 100:.0f}% of your entire monthly fun-money budget."
            )

    if verdict == "yes":
        reasons.append(
            f"This fits. You'd still have {_fmt_money(budget_after)} left in this month's budget "
            f"and {_fmt_money(liquid_after)} liquid, above your safety net."
        )

    impacts, overflow = goal_impacts(conn, snap, amount, is_discretionary)
    workarounds = _workarounds(snap, amount, category, is_discretionary, impacts, overflow)

    return {
        "verdict": verdict,
        "amount": amount,
        "category": category,
        "is_discretionary": bool(is_discretionary),
        "reasons": reasons,
        "snapshot": {
            "liquid": liquid,
            "liquid_after": liquid_after,
            "remaining_budget": remaining_budget,
            "budget_after": budget_after,
            "emergency_target": emergency_target,
            "net_worth": snap["net_worth"],
        },
        "goal_impacts": impacts,
        "overflow": overflow,
        "workarounds": workarounds,
    }


def _workarounds(snap, amount, category, is_discretionary, impacts, overflow):
    out = []
    days_to_reset = _days_until_month_reset()

    if is_discretionary and snap["remaining_budget"] < amount:
        out.append(
            f"Wait {days_to_reset} day(s) for your budget to reset on the 1st - you'll have "
            f"{_fmt_money(snap['discretionary_budget'])} of fresh fun money then."
        )

    out.append("Use the 30-day rule: write it on a list and revisit in a month. Most impulse wants fade.")

    # Goal trade-off framing for the top-priority goal.
    top = next((i for i in impacts if i["monthly_contribution"] > 0), None)
    if top and top["progress_days"]:
        out.append(
            f"Skipping this keeps '{top['name']}' on track - the {_fmt_money(amount)} is about "
            f"{top['progress_days']} day(s) of progress toward it."
        )

    if amount >= 100:
        out.append("Look for it used, refurbished, or on sale - a 20-40% lower price changes the math.")

    out.append(f"Ask whether {_fmt_money(amount)} of permanent net-worth loss is worth the temporary want.")
    return out
