// ============================================================================
//  Money — self-contained PWA. All data on-device (localStorage).
//  Model: calendar EVENTS (income/expense) + account balances. Everything is
//  computed daily from CURRENT LIQUID CASH and what's coming in/out — no months.
// ============================================================================

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
const escapeHtml = (s) => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// ---------- icons (no emojis) ----------
const ICONS = {
  logo:    `<svg class="logo" viewBox="0 0 24 24"><path d="M12 2.4 13.5 10.5 21.6 12 13.5 13.5 12 21.6 10.5 13.5 2.4 12 10.5 10.5Z"/><circle cx="12" cy="12" r="2.4"/></svg>`,
  home:    `<svg viewBox="0 0 24 24"><path d="M3 11.4 12 3.5l9 7.9"/><path d="M5.5 9.8V20.5h13V9.8"/></svg>`,
  calendar:`<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/></svg>`,
  decide:  `<svg viewBox="0 0 24 24"><path d="M12 3.5v17"/><path d="M8 20.5h8"/><path d="M4.5 7.3h15"/><path d="M7 5.8 12 4.8l5 1"/><path d="M4.5 7.3 2.3 12.2h4.4z"/><path d="M19.5 7.3 17.3 12.2h4.4z"/></svg>`,
  history: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.3 2"/></svg>`,
  manage:  `<svg viewBox="0 0 24 24"><path d="M4 7.5h9"/><path d="M17 7.5h3"/><circle cx="15" cy="7.5" r="2"/><path d="M4 16.5h3"/><path d="M11 16.5h9"/><circle cx="9" cy="16.5" r="2"/></svg>`,
  check:   `<svg viewBox="0 0 24 24"><path d="M4.5 12.5 9.5 17.5 19.5 6.5"/></svg>`,
  coach:   `<svg viewBox="0 0 24 24"><path d="M4 5.5h16v10H9.5L5 19.5V15.5H4z"/><path d="M8 9.5h8M8 12.5h5"/></svg>`,
};
const TAB_ICON = { dashboard: "home", schedule: "calendar", decide: "decide", coach: "coach", history: "history", manage: "manage" };
// account-type glyphs (minimalist, stroke)
const GLYPH = {
  cash:   `<svg viewBox="0 0 24 24"><rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.2"/></svg>`,
  save:   `<svg viewBox="0 0 24 24"><path d="M4 8.5h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8.5 8.5V6.2a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2.3"/></svg>`,
  invest: `<svg viewBox="0 0 24 24"><path d="M4 16.5 9.5 11l3 3 6.5-7"/><path d="M19.5 7h-4M19.5 7v4"/></svg>`,
  debt:   `<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/></svg>`,
};
const TYPE_GLYPH = { checking: "cash", savings: "save", "401k": "invest", roth: "invest", brokerage: "invest", other: "cash", credit_card: "debt", student_loan: "debt", loan: "debt" };
function injectChrome() {
  document.querySelectorAll(".tab").forEach(b => b.insertAdjacentHTML("afterbegin", ICONS[TAB_ICON[b.dataset.tab]] || ""));
  document.querySelector(".brand").insertAdjacentHTML("afterbegin", ICONS.logo);
}

// ---------- storage ----------
const DB_KEY = "money.db.v1";
const blank = () => ({
  seq: 1, accounts: [], events: [], goals: [], purchases: [], saves: [], conversations: [],
  savings: { roth_auto: false, roth_ytd: 0, roth_limit: 7500, roth_monthly: 0, k401_monthly: 0, emergency_monthly: 0, emergency_target: 0, emergency_date: "" },
  profile: { credit_score: 0, priorities: "", anthropic_key: "", finnhub_key: "", annual_salary_pretax: 0 },
  today_lock: { date: "", save_value: 0, spend_value: 0, save_frozen: false, spend_frozen: false },
  game: { streak: 0, longest_streak: 0, last_hit_date: "", achievements: [] },
});
function migrate(db) {
  if (db.events) {
    db.savings = db.savings || blank().savings;
    const bs = blank().savings; for (const k in bs) if (db.savings[k] == null) db.savings[k] = bs[k];
    db.profile = db.profile || blank().profile;
    db.goals = (db.goals || []).map(g => ({ target_date: "", ...g }));
    if (!db.saves) db.saves = [];
    if (!db.today_lock || "save_hit" in db.today_lock) db.today_lock = blank().today_lock;
    if (!db.game) db.game = blank().game;
    return db;
  }
  let seq = db.seq || 1; const p = db.profile || {}; const events = [];
  const _t = new Date(), todayIso = `${_t.getFullYear()}-${String(_t.getMonth() + 1).padStart(2, "0")}-${String(_t.getDate()).padStart(2, "0")}`;
  if (p.monthly_income > 0) {
    if (p.paycheck_type === "semimonthly") events.push({ id: seq++, name: "Paycheck", amount: +(p.monthly_income / 2).toFixed(2), kind: "income", recur: "semimonthly", day: p.paycheck_day1 || 1, day2: p.paycheck_day2 || 15, date: todayIso });
    else if (p.paycheck_type === "biweekly") events.push({ id: seq++, name: "Paycheck", amount: +(p.monthly_income * 12 / 26).toFixed(2), kind: "income", recur: "biweekly", date: p.paycheck_anchor || todayIso });
    else events.push({ id: seq++, name: "Paycheck", amount: p.monthly_income, kind: "income", recur: "monthly", day: 1, date: todayIso });
  }
  (db.fixed_items || []).forEach(fi => events.push({ id: seq++, name: fi.name, amount: fi.amount, kind: "expense", flex: false, recur: "monthly", day: fi.due_day || 1, date: todayIso, category: fi.category || "" }));
  (db.scheduled || []).forEach(s => events.push({ id: seq++, name: s.name, amount: s.amount, kind: s.kind, flex: false, recur: "once", date: s.date }));
  return {
    seq, accounts: db.accounts || [], events, goals: (db.goals || []).map(g => ({ target_date: "", ...g })), purchases: db.purchases || [], saves: db.saves || [], conversations: db.conversations || [],
    savings: { roth_auto: p.roth_auto || false, roth_ytd: p.roth_ytd || 0, roth_limit: p.roth_limit || 7500, roth_monthly: p.roth_monthly || 0, k401_monthly: p.k401_monthly || 0, emergency_monthly: 0, emergency_target: p.emergency_fund_target || 0, emergency_date: "" },
    profile: { credit_score: p.credit_score || 0, priorities: p.priorities || "", anthropic_key: p.anthropic_key || "", annual_salary_pretax: p.annual_salary_pretax || 0 },
    today_lock: blank().today_lock, game: blank().game,
  };
}
let DB = (() => { try { const raw = JSON.parse(localStorage.getItem(DB_KEY)); return raw ? migrate(raw) : blank(); } catch { return blank(); } })();
const save = () => localStorage.setItem(DB_KEY, JSON.stringify(DB));
const nextId = () => DB.seq++;

// ---------- formatting ----------
function money(x) { const n = Number(x || 0), isInt = Math.abs(n) % 1 < 0.005; return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: isInt ? 0 : 2, minimumFractionDigits: isInt ? 0 : 2 }); }
const money0 = x => (Number(x || 0) < 0 ? "-$" : "$") + Math.abs(Math.round(Number(x || 0))).toLocaleString("en-US");
const fmtMoney = money;
function fmtDate(s) { if (!s) return "—"; const [y, m, d] = s.slice(0, 10).split("-").map(Number); if (!y) return "—"; const o = { month: "short", day: "numeric" }; if (y !== new Date().getFullYear()) o.year = "numeric"; return new Date(y, m - 1, d).toLocaleDateString("en-US", o); }
function fmtNow() { return new Date().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }

// ---------- date math ----------
const _d = () => new Date();
const pad = n => String(n).padStart(2, "0");
const isoOf = dt => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
function isoToday() { return isoOf(_d()); }
function midnight() { const d = _d(); d.setHours(0, 0, 0, 0); return d; }
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function clampedDate(y, m0, day) { const ref = new Date(y, m0, 1); return new Date(ref.getFullYear(), ref.getMonth(), Math.min(day, daysInMonth(ref.getFullYear(), ref.getMonth() + 1))); }
function daysUntil(iso, refDate) { return daysBetween(refDate || midnight(), new Date(iso + "T00:00:00")); }
function isoMonthsFromNow(n) { const d = _d(); return isoOf(new Date(d.getFullYear(), d.getMonth() + Math.round(n), d.getDate())); }
function monthsUntil(iso) { return Math.max(0, Math.round(daysUntil(iso) / 30.44)); }
function monthsLeftInYear() { const d = _d(), m = d.getMonth(), dim = daysInMonth(d.getFullYear(), m + 1); return (11 - m) + (dim - d.getDate() + 1) / dim; }
const DPM = 30.4375;
function daysToTaxDay(refDate) { const d = refDate || midnight(); return Math.max(3, daysBetween(d, new Date(d.getFullYear() + 1, 3, 15))); }
function daysToMonthEnd(refDate) { return Math.max(1, daysBetween(refDate, new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0))); }

// ============================================================================
//  EVENTS — recurrence + occurrence expansion
// ============================================================================
const RECURS = [["once", "One-time"], ["weekly", "Weekly"], ["biweekly", "Every 2 weeks"], ["semimonthly", "Twice a month"], ["monthly", "Monthly"]];
const recurLabel = r => (RECURS.find(x => x[0] === r) || [r, r])[1];

function expand(ev, start, end) {
  const skip = ev.skip || [];
  const out = [], add = d => { if (d >= start && d < end && !skip.includes(isoOf(d))) out.push({ date: new Date(d), amount: ev.amount, ev }); };
  if (ev.recur === "once") { if (ev.date) add(new Date(ev.date + "T00:00:00")); return out; }
  if (ev.recur === "monthly") { let cur = new Date(start.getFullYear(), start.getMonth(), 1); while (cur < end) { add(clampedDate(cur.getFullYear(), cur.getMonth(), ev.day || 1)); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); } return out; }
  if (ev.recur === "semimonthly") { let cur = new Date(start.getFullYear(), start.getMonth(), 1); while (cur < end) { add(clampedDate(cur.getFullYear(), cur.getMonth(), ev.day || 1)); add(clampedDate(cur.getFullYear(), cur.getMonth(), ev.day2 || 15)); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); } return out; }
  if (ev.recur === "weekly" || ev.recur === "biweekly") { const step = ev.recur === "weekly" ? 7 : 14, anchor = new Date((ev.date || isoToday()) + "T00:00:00"); let k = Math.ceil(daysBetween(anchor, start) / step), d = addDays(anchor, k * step); while (d < end) { add(d); d = addDays(d, step); } return out; }
  return out;
}
function occurrences(start, end, filter) { let out = []; DB.events.filter(e => !filter || filter(e)).forEach(e => out = out.concat(expand(e, start, end))); return out.sort((a, b) => a.date - b.date); }
function sumOcc(start, end, filter) { return occurrences(start, end, filter).reduce((s, o) => s + o.amount, 0); }
function nextIncomeAfter(date) { const occ = occurrences(date, addDays(date, 200), e => e.kind === "income").filter(o => o.date > date); return occ.length ? occ[0] : null; }

// ============================================================================
//  ENGINE — liquid-anchored, daily
//
//  spendToday / saveToday come from CURRENT LIQUID:
//   freeOverRunway = liquid + incoming − bills due − reserve for next paycheck
//   freeDaily      = freeOverRunway / days-to-next-paycheck
//   saveToday      = daily amounts to hit each target by its deadline,
//                    capped at 75% of freeDaily so spend is never $0
//   spendToday     = freeDaily − saveToday
// ============================================================================
const LIQUID_TYPES = ["checking", "savings"];

// Daily save targets, in funding-priority order: card → emergency → Roth → 401k → goals.
// Emergency comes before Roth so a thin cash cushion gets rebuilt before retirement
// contributions resume — it's the fund you'd actually dip into first if cash got tight.
function dailyTargets(refDate, emergencySaved, ccBalance) {
  const t = [], sv = DB.savings;
  if (ccBalance > 0) t.push({ key: "cc", label: "Pay off card", glyph: "debt", daily: ccBalance / daysToMonthEnd(refDate) });
  const eRem = Math.max(0, (sv.emergency_target || 0) - emergencySaved);
  if (eRem > 0) { const days = (sv.emergency_date && daysUntil(sv.emergency_date, refDate) > 0) ? daysUntil(sv.emergency_date, refDate) : 365; t.push({ key: "emg", label: "Emergency fund", glyph: "save", daily: eRem / days }); }
  else if (sv.emergency_monthly > 0 && !(sv.emergency_target > 0)) t.push({ key: "emg", label: "Emergency fund", glyph: "save", daily: sv.emergency_monthly / DPM });
  if (sv.roth_auto) { const rem = Math.max(0, (sv.roth_limit || 7500) - (sv.roth_ytd || 0)); if (rem > 0) t.push({ key: "roth", label: "Roth IRA", glyph: "invest", daily: rem / daysToTaxDay(refDate) }); }
  else if (sv.roth_monthly > 0) t.push({ key: "roth", label: "Roth IRA", glyph: "invest", daily: sv.roth_monthly / DPM });
  if (sv.k401_monthly > 0) t.push({ key: "k401", label: "401(k)", glyph: "invest", daily: sv.k401_monthly / DPM });
  DB.goals.forEach(g => { const rem = Math.max(0, g.target_amount - g.current_amount); if (rem <= 0) return; let daily = 0; if (g.target_date && daysUntil(g.target_date, refDate) > 0) daily = rem / daysUntil(g.target_date, refDate); else if (g.monthly_contribution > 0) daily = g.monthly_contribution / DPM; if (daily > 0) t.push({ key: "goal" + g.id, label: g.name, glyph: "save", daily }); });
  return t;
}

// Core runway/targets math, anchored at any reference date — today for the live
// dashboard, or a future date so Decide can check "if I buy this on day X".
function projectFrom(refDate, liquidAtRef, emergencySaved, ccBalance) {
  // Card debt is cleared first, virtually, using checking then savings, before anything
  // else is computed — idle cash sitting next to card interest never pencils out. This
  // only adjusts today's math; real balances only move once you use Transfer (Manage).
  const cardVirtuallyPaid = ccBalance > 0 && liquidAtRef + emergencySaved >= ccBalance;
  const fromLiquid = cardVirtuallyPaid ? Math.min(liquidAtRef, ccBalance) : 0;
  const effLiquid = cardVirtuallyPaid ? liquidAtRef - fromLiquid : liquidAtRef;
  const effEmergency = cardVirtuallyPaid ? emergencySaved - (ccBalance - fromLiquid) : emergencySaved;
  const effCc = cardVirtuallyPaid ? 0 : ccBalance;

  const hasIncome = !!nextIncomeAfter(refDate);
  const nextInc = nextIncomeAfter(refDate);
  const nextPayDate = nextInc ? nextInc.date : addDays(refDate, 30);
  const runwayDays = Math.max(1, daysBetween(refDate, nextPayDate));
  const winExpenses = sumOcc(refDate, nextPayDate, e => e.kind === "expense");
  const winIncome = occurrences(refDate, nextPayDate, e => e.kind === "income").filter(o => o.date > refDate && o.date < nextPayDate).reduce((s, o) => s + o.amount, 0);

  // Reserve for the paycheck-after if it can't cover its own bills (e.g. rent on payday)
  const nextInc2 = hasIncome ? nextIncomeAfter(nextPayDate) : null;
  const win2end = nextInc2 ? nextInc2.date : addDays(nextPayDate, runwayDays);
  const win2exp = sumOcc(nextPayDate, win2end, e => e.kind === "expense");
  const win2incExtra = occurrences(nextPayDate, win2end, e => e.kind === "income").filter(o => o.date > nextPayDate).reduce((s, o) => s + o.amount, 0);
  const reserveForNext = Math.max(0, win2exp - ((hasIncome ? nextInc.amount : 0) + win2incExtra));

  const freeOverRunway = effLiquid + winIncome - winExpenses - reserveForNext;
  const freeDaily = freeOverRunway / runwayDays;
  const shortBeforePay = Math.max(0, -freeOverRunway);

  // Fund every target in full when they fit within your free cash. If your goals
  // genuinely need more per day than you free up (over-allocated), keep ~25% of the
  // free cash for spending so it's never $0, and fund the rest in priority order.
  const targets = dailyTargets(refDate, effEmergency, effCc);
  const idealDaily = targets.reduce((s, t) => s + t.daily, 0);
  const overAllocated = idealDaily > freeDaily + 0.01;
  let pool = overAllocated ? 0.75 * Math.max(0, freeDaily) : Math.max(0, Math.min(idealDaily, freeDaily));
  targets.forEach(t => { t.funded = Math.max(0, Math.min(t.daily, pool)); pool -= t.funded; });
  const saveDaily = targets.reduce((s, t) => s + t.funded, 0);
  const spendDaily = Math.max(0, freeDaily - saveDaily);
  const underfunded = targets.filter(t => t.funded < t.daily - 0.01).map(t => ({ label: t.label, short: t.daily - t.funded }));

  const nextPay = {
    date: isoOf(nextPayDate), amount: hasIncome ? nextInc.amount : 0,
    dated: occurrences(nextPayDate, win2end, e => e.kind === "expense").map(o => ({ name: o.ev.name, amount: o.amount, date: o.date })),
    leftover: (hasIncome ? nextInc.amount : 0) + win2incExtra - win2exp, underwater: reserveForNext > 0, shortfall: reserveForNext,
  };

  return {
    liquid: liquidAtRef, emergency_saved: emergencySaved, cc_balance: ccBalance,
    card_virtually_paid: cardVirtuallyPaid, card_payoff_used: cardVirtuallyPaid ? ccBalance : 0,
    has_income: hasIncome, next_payday: isoOf(nextPayDate), runway_days: runwayDays, win_expenses: winExpenses,
    free_over_runway: freeOverRunway, free_daily: freeDaily, short_before_pay: shortBeforePay, reserve_for_next: reserveForNext,
    targets, ideal_daily: idealDaily, save_today: saveDaily, spend_today: spendDaily, underfunded, over_allocated: overAllocated,
    period_remaining: Math.max(0, spendDaily * runwayDays), next_pay: nextPay,
  };
}

// Save and spend targets track live balances (so editing an account flows straight
// through) until you log your first save or spend of the day — at that point THAT
// target freezes at its pre-action value, so it doesn't shrink just because the
// action itself moved liquid, and a checkmark can mean something stable. The two
// targets freeze independently: logging a save only freezes Save, not Spend, and
// vice versa. Tomorrow both unfreeze and start tracking live again.
function applyTodayLock(proj, spentToday, savedToday) {
  const t = DB.today_lock, today = isoToday();
  if (t.date !== today) { t.date = today; t.save_value = proj.save_today; t.spend_value = proj.spend_today; t.save_frozen = false; t.spend_frozen = false; save(); }
  let dirty = false;
  if (!t.save_frozen) { if (savedToday > 0) { t.save_frozen = true; dirty = true; } else if (t.save_value !== proj.save_today) { t.save_value = proj.save_today; dirty = true; } }
  if (!t.spend_frozen) { if (spentToday > 0) { t.spend_frozen = true; dirty = true; } else if (t.spend_value !== proj.spend_today) { t.spend_value = proj.spend_today; dirty = true; } }
  if (dirty) save();
  return { save_today: t.save_value, spend_today: t.spend_value };
}

// ---------- game: every dollar saved or skipped earns XP; hitting the save target keeps a streak alive ----------
const ACHIEVEMENTS = [
  { id: "first_save", name: "First save", desc: "Log a save for the first time", check: () => DB.saves.length > 0 },
  { id: "first_skip", name: "First skip", desc: "Skip a purchase and bank the difference", check: () => DB.purchases.some(p => !p.was_made) },
  { id: "streak_3", name: "3-day streak", desc: "Hit your save target 3 days running", check: () => DB.game.longest_streak >= 3 },
  { id: "streak_7", name: "Week streak", desc: "Hit your save target 7 days running", check: () => DB.game.longest_streak >= 7 },
  { id: "streak_30", name: "Month streak", desc: "Hit your save target 30 days running", check: () => DB.game.longest_streak >= 30 },
  { id: "saved_100", name: "$100 banked", desc: "$100 saved or skipped, lifetime", check: () => lifetimeSaved() >= 100 },
  { id: "saved_1000", name: "$1,000 banked", desc: "$1,000 saved or skipped, lifetime", check: () => lifetimeSaved() >= 1000 },
  { id: "saved_10000", name: "$10,000 banked", desc: "$10,000 saved or skipped, lifetime", check: () => lifetimeSaved() >= 10000 },
  { id: "goal_done", name: "Goal crushed", desc: "Fully fund a goal", check: () => DB.goals.some(g => g.target_amount > 0 && g.current_amount >= g.target_amount) },
];
function lifetimeSaved() { return DB.saves.reduce((s, x) => s + x.amount, 0) + DB.purchases.filter(p => !p.was_made).reduce((s, p) => s + p.amount, 0); }
function levelInfo(xp) { let level = 1, need = 100, floor = 0; while (xp >= floor + need) { floor += need; level++; need = Math.round(need * 1.35); } return { level, xp_in_level: xp - floor, xp_for_next: need, pct: (xp - floor) / need }; }
// Streak grows the day after the previous hit; missing a full day off (no hit yesterday or today) zeroes it, but longest_streak is permanent.
function syncStreak(today, hitToday) {
  const g = DB.game, gapFrom = iso => daysBetween(new Date(iso + "T00:00:00"), new Date(today + "T00:00:00"));
  if (hitToday && g.last_hit_date !== today) { g.streak = (g.last_hit_date && gapFrom(g.last_hit_date) === 1) ? g.streak + 1 : 1; g.last_hit_date = today; g.longest_streak = Math.max(g.longest_streak, g.streak); return true; }
  if (!hitToday && g.streak > 0 && g.last_hit_date && gapFrom(g.last_hit_date) > 1) { g.streak = 0; return true; }
  return false;
}
function syncAchievements() { const g = DB.game; let dirty = false; ACHIEVEMENTS.forEach(a => { if (!g.achievements.includes(a.id) && a.check()) { g.achievements.push(a.id); dirty = true; } }); if (dirty) save(); return dirty; }

function snapshot() {
  const a = DB.accounts;
  const assets = a.filter(x => !x.is_liability).reduce((s, x) => s + x.balance, 0);
  const liabilities = a.filter(x => x.is_liability).reduce((s, x) => s + x.balance, 0);
  // Spendable cash = checking only. Savings is treated as protected (emergency) money,
  // so moving cash into it actually lowers what you can spend.
  const liquid = a.filter(x => x.type === "checking" && !x.is_liability).reduce((s, x) => s + x.balance, 0);
  const emergencySaved = a.filter(x => x.type === "savings" && !x.is_liability).reduce((s, x) => s + x.balance, 0);
  const totalLiquid = liquid + emergencySaved;
  const todayI = isoToday();
  const spentToday = DB.purchases.filter(p => p.was_made && p.occurred_at === todayI).reduce((s, p) => s + p.amount, 0);
  const savedToday = (DB.saves || []).filter(x => x.date === todayI).reduce((s, x) => s + x.amount, 0);
  const ccBalance = a.filter(x => x.type === "credit_card").reduce((s, x) => s + x.balance, 0);
  const proj = projectFrom(midnight(), liquid, emergencySaved, ccBalance);
  const lock = applyTodayLock(proj, spentToday, savedToday);
  const saveLocked = lock.save_today > 0 && savedToday >= lock.save_today - 0.005;
  const spendLocked = lock.spend_today > 0 && spentToday >= lock.spend_today - 0.005;
  if (syncStreak(todayI, saveLocked)) save();
  syncAchievements();
  const lvl = levelInfo(Math.round(lifetimeSaved()));

  return {
    accounts: a, assets, liabilities, net_worth: assets - liabilities, total_liquid: totalLiquid,
    spent_today: spentToday, saved_today: savedToday,
    ...proj, save_today: lock.save_today, save_locked: saveLocked, spend_today: lock.spend_today, spend_locked: spendLocked,
    emergency_target: DB.savings.emergency_target || 0, emergency_pct: (DB.savings.emergency_target > 0) ? Math.min(1, emergencySaved / DB.savings.emergency_target) : (emergencySaved > 0 ? 1 : 0),
    has_setup: DB.events.some(e => e.kind === "income") || a.length > 0,
    level: lvl.level, xp_in_level: lvl.xp_in_level, xp_for_next: lvl.xp_for_next, level_pct: lvl.pct,
    streak: DB.game.streak, longest_streak: DB.game.longest_streak,
    achievements: ACHIEVEMENTS.map(ac => ({ name: ac.name, desc: ac.desc, unlocked: DB.game.achievements.includes(ac.id) })),
  };
}

// Same engine, anchored at a future date — what your budget looks like if you buy on that day.
function snapshotAt(date) {
  if (!date || date <= midnight()) return snapshot();
  const a = DB.accounts;
  const emergencySaved = a.filter(x => x.type === "savings" && !x.is_liability).reduce((s, x) => s + x.balance, 0);
  const ccBalance = a.filter(x => x.type === "credit_card").reduce((s, x) => s + x.balance, 0);
  return projectFrom(date, projectedLiquidAt(date), emergencySaved, ccBalance);
}

// Forward balance projection from current liquid — shows where money goes & when.
function projectedAgenda(days) {
  const start = midnight(), end = addDays(start, days), s = snapshot();
  let bal = s.liquid; const rows = [];
  occurrences(start, end).filter(o => o.date >= start).forEach(o => { const inc = o.ev.kind === "income"; bal += inc ? o.amount : -o.amount; rows.push({ date: o.date, name: o.ev.name, kind: o.ev.kind, amount: o.amount, bal }); });
  return rows;
}
// Projected cash at a date (today's liquid + scheduled income − scheduled bills to then).
function projectedLiquidAt(date) {
  const start = midnight(); if (date <= start) return snapshot().liquid;
  return snapshot().liquid + occurrences(start, date).reduce((a, o) => a + (o.ev.kind === "income" ? o.amount : -o.amount), 0);
}
// Month-end projected cash for the next N months (for the year outlook chart).
function projectedLiquidSeries(months) {
  const start = midnight(), s0 = snapshot().liquid, series = [s0];
  for (let m = 1; m <= months; m++) series.push(s0 + occurrences(start, new Date(start.getFullYear(), start.getMonth() + m, 1)).reduce((a, o) => a + (o.ev.kind === "income" ? o.amount : -o.amount), 0));
  return series;
}

function goalEta(remaining, monthly) { if (monthly <= 0 || remaining <= 0) return [null, null]; const months = Math.ceil(remaining / monthly), d = _d(); return [months, isoOf(new Date(d.getFullYear(), d.getMonth() + months, Math.min(d.getDate(), 28)))]; }

function decide(amount, category = "other", isDisc = true, date = null) {
  const refDate = date ? new Date(date + "T00:00:00") : midnight();
  const snap = date ? snapshotAt(refDate) : snapshot(); amount = Number(amount);
  const remaining = snap.period_remaining, reasons = []; let verdict = "yes", toCredit = 0;
  const afterPay = (snap.has_income ? snap.next_pay.amount : 0);

  // real recompute of "after this purchase" — same engine, lower liquid (and any credit overflow),
  // so the 75/25 throttle and save targets land where they'd actually land once it's logged.
  const newLiquid = Math.max(0, snap.liquid - amount), newCc = snap.cc_balance + Math.max(0, amount - snap.liquid);
  const after = projectFrom(refDate, newLiquid, snap.emergency_saved, newCc);
  const target_impacts = snap.targets.map(t => { const at = after.targets.find(x => x.key === t.key); const slowed = Math.max(0, t.funded - (at ? at.funded : 0)); return { label: t.label, before: t.funded, after: at ? at.funded : 0, total_slowed: slowed * after.runway_days }; }).filter(x => x.total_slowed > 0.005);
  const pctOfRoom = remaining > 0 ? Math.min(1, amount / remaining) : (amount > 0 ? 1 : 0);

  if (amount <= remaining) { verdict = "yes"; reasons.push(`Fits — leaves ${money(after.period_remaining)} to spend before ${fmtDate(snap.next_payday)}.`); }
  else if (amount <= snap.free_over_runway) { verdict = "caution"; reasons.push(`Over your ${money(remaining)} spending room — the extra eats into what you're setting aside for goals.`); }
  else if (amount <= snap.liquid) { verdict = "caution"; reasons.push(`Uses cash you'd need for bills before ${fmtDate(snap.next_payday)}. Doable, but tight.`); }
  else { // beyond cash → credit
    toCredit = amount - snap.liquid;
    if (amount > snap.liquid + afterPay) { verdict = "veto"; reasons.push(`${money(amount)} is more than your ${money(snap.liquid)} cash plus your next paycheck — you couldn't clear it next month.`); }
    else { verdict = "caution"; reasons.push(`You're ${money(toCredit)} short on cash — this goes on your card. Fine if you clear it after ${fmtDate(snap.next_payday)}.`); }
  }
  if (verdict !== "veto" && snap.cc_balance > 0) reasons.push(`You're carrying ${money(snap.cc_balance)} on your card — paying that off comes first.`);

  // goal impact
  const goals = [...DB.goals].sort((a, b) => a.priority - b.priority || a.id - b.id);
  const overflow = isDisc ? Math.max(0, amount - remaining) : amount;
  const impacts = goals.map(g => { const rmn = g.target_amount - g.current_amount, mo = g.monthly_contribution; const [, etaNow] = goalEta(rmn, mo); let etaAfter = etaNow, dd = 0; if (overflow > 0 && mo > 0 && rmn > 0) { dd = Math.round((overflow / mo) * 30.4); [, etaAfter] = goalEta(rmn + overflow, mo); } return { name: g.name, eta_now: etaNow, eta_after: etaAfter, delay_days: dd }; });

  const wa = [];
  if (amount > remaining && snap.has_income) wa.push(`Wait for ${fmtDate(snap.next_payday)} — your spending room refills then.`);
  wa.push("30-day rule: list it, revisit in a month.");
  if (amount >= 100) wa.push("Used / refurbished / on sale moves it 20-40%.");
  return { verdict, amount, reasons, goal_impacts: impacts, workarounds: wa, snap, after, target_impacts, pct_of_room: pctOfRoom, to_credit: toCredit, is_disc: isDisc, has_budget: remaining > 0 };
}

function logPurchase(description, amount, category, disc, verdict, was_made, date, accountId) {
  let account_id = null, toCredit = 0;
  if (was_made) {
    const sel = accountId ? DB.accounts.find(a => a.id === accountId) : null;
    if (sel) {
      // Explicit account: charge straight to a card, or pull straight from checking/savings.
      if (sel.is_liability) { sel.balance += amount; toCredit = amount; } else { sel.balance -= amount; }
      account_id = sel.id;
    } else {
      let remaining = amount;
      // Spend from checking; overflow goes on the card (savings stays protected).
      const checkingAccts = DB.accounts.filter(a => a.type === "checking");
      for (const acct of checkingAccts) { if (remaining <= 0.005) break; const take = Math.min(acct.balance, remaining); acct.balance -= take; remaining -= take; if (!account_id) account_id = acct.id; }
      if (remaining > 0.005) { const card = DB.accounts.find(a => a.type === "credit_card"); if (card) { card.balance += remaining; toCredit = remaining; } else if (checkingAccts[0]) { checkingAccts[0].balance -= remaining; account_id = checkingAccts[0].id; } }
    }
  }
  DB.purchases.push({ id: nextId(), description, amount, category, is_discretionary: disc, verdict, was_made, account_id, to_credit: toCredit, occurred_at: date || isoToday() });
  save(); switchTab("dashboard");
}

// Record money actually moved out of checking into a destination account today.
// This lowers spendable cash and advances the matching target, so tomorrow recalibrates.
function logSave(amount, acctId) {
  amount = Number(amount); if (!(amount > 0)) return;
  const checking = DB.accounts.find(a => a.type === "checking");
  const dest = DB.accounts.find(a => a.id === acctId); if (!dest) return;
  if (checking) checking.balance -= amount;
  dest.balance += amount;
  if (dest.type === "roth") DB.savings.roth_ytd = (DB.savings.roth_ytd || 0) + amount;
  DB.saves.push({ id: nextId(), amount, account_id: acctId, dest: dest.name, date: isoToday() });
  save(); render();
}

// Move cash between any two accounts, e.g. paying a credit card down from checking.
// Liability balances mean "owed", so entering one pays it down and leaving one borrows more.
function transferFunds(fromId, toId, amount) {
  amount = Number(amount); if (!(amount > 0) || fromId === toId) return false;
  const from = DB.accounts.find(a => a.id === fromId), to = DB.accounts.find(a => a.id === toId);
  if (!from || !to) return false;
  from.balance += from.is_liability ? amount : -amount;
  to.balance += to.is_liability ? -amount : amount;
  if (to.type === "roth") DB.savings.roth_ytd = (DB.savings.roth_ytd || 0) + amount;
  save(); return true;
}

// ============================================================================
//  ROUTER + STATE
// ============================================================================
const state = {
  tab: "dashboard", convId: null, editAccount: null, editGoal: null,
  calYear: null, calMonth: null, schedSel: null, editEvent: null, whatIfMonthly: 200,
  outlookMetric: "net", outlookDays: 30, collapse: {},
  decide: { desc: "", amount: "", category: "shopping", disc: 1, date: "" },
};
function captureTabState() { if (state.tab === "decide" && $("#d-amt")) state.decide = { desc: $("#d-desc").value, amount: $("#d-amt").value, category: $("#d-cat").value, date: $("#d-date").value, disc: state.decideDisc ?? state.decide.disc }; }
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
const TAB_ORDER = ["dashboard", "schedule", "decide", "coach", "history", "manage"];
const RENDERERS = { dashboard: renderDashboard, schedule: renderCalendar, decide: renderDecide, coach: renderCoach, history: renderHistory, manage: renderManage };
let _navDir = 0;
function switchTab(tab) { captureTabState(); _navDir = TAB_ORDER.indexOf(tab) - TAB_ORDER.indexOf(state.tab); state.tab = tab; document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab)); render(); }
function refreshNetWorth() { $("#networth-pill").textContent = money0(snapshot().net_worth); }
function render() {
  const v = $("#view"); v.innerHTML = ""; refreshNetWorth();
  RENDERERS[state.tab](v);
  v.classList.remove("slide-l", "slide-r", "fade-up"); void v.offsetWidth;
  v.classList.add(_navDir > 0 ? "slide-l" : _navDir < 0 ? "slide-r" : "fade-up"); _navDir = 0;
}
// Swipe between tabs, iOS-style: content tracks the finger 1:1 and previews the
// neighboring tab as it's dragged in. Past ~1/3 of the screen width it commits on
// release; short of that it snaps back. Edges (no neighbor) just rubber-band.
(() => {
  const view = $("#view"); view.style.position = "relative";
  let sx = 0, sy = 0, tracking = false, dragging = false, dir = 0, incoming = null, outgoing = null;
  const blocked = t => t.closest && t.closest('input[type="range"], .ol-chips, .ol-plot, .cal, select, textarea');
  const settle = () => {
    if (outgoing) { while (outgoing.firstChild) view.insertBefore(outgoing.firstChild, outgoing); outgoing.remove(); outgoing = null; }
    if (incoming) { incoming.remove(); incoming = null; }
    dragging = false; dir = 0;
  };
  view.addEventListener("touchstart", e => { if (blocked(e.target)) { tracking = false; return; } const t = e.touches[0]; sx = t.clientX; sy = t.clientY; tracking = true; dragging = false; }, { passive: true });
  view.addEventListener("touchmove", e => {
    if (!tracking) return;
    const t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (!dragging) {
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      dragging = true; dir = dx < 0 ? 1 : -1;
      // Outgoing content gets its own pane so it can be transformed independently of
      // #view (and of incoming) — transforming #view itself would also shift incoming
      // since it's a child of #view, doubling its movement and overlapping the text.
      outgoing = el(`<div></div>`);
      while (view.firstChild) outgoing.appendChild(view.firstChild);
      view.append(outgoing);
      const ni = TAB_ORDER.indexOf(state.tab) + dir;
      if (ni >= 0 && ni < TAB_ORDER.length) {
        // width:100% on an absolutely-positioned child resolves against #view's padding
        // box, ignoring its padding — copy that padding so the preview content lines up
        // with where it lands after the swipe instead of jumping in from the screen edge.
        const pad = getComputedStyle(view);
        incoming = el(`<div style="position:absolute;top:0;left:0;width:100%;box-sizing:border-box;padding:${pad.padding}"></div>`);
        const prevTab = state.tab; state.tab = TAB_ORDER[ni]; RENDERERS[state.tab](incoming); state.tab = prevTab;
        view.append(incoming);
      }
    }
    e.preventDefault();
    const w = view.clientWidth || window.innerWidth;
    outgoing.style.transform = `translateX(${incoming ? dx : dx * 0.3}px)`;
    if (incoming) incoming.style.transform = `translateX(${dir > 0 ? w + dx : -w + dx}px)`;
  }, { passive: false });
  view.addEventListener("touchend", e => {
    if (!tracking) return; tracking = false;
    if (!dragging) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, w = view.clientWidth || window.innerWidth;
    const commit = incoming && Math.abs(dx) > w * 0.33;
    const transition = "transform .25s cubic-bezier(.22,.61,.36,1)";
    outgoing.style.transition = transition;
    if (incoming) incoming.style.transition = transition;
    if (commit) { outgoing.style.transform = `translateX(${dir > 0 ? -w : w}px)`; incoming.style.transform = "translateX(0px)"; }
    else { outgoing.style.transform = "translateX(0px)"; if (incoming) incoming.style.transform = `translateX(${dir > 0 ? w : -w}px)`; }
    setTimeout(() => {
      if (!commit) { settle(); return; }
      const tab = TAB_ORDER[TAB_ORDER.indexOf(state.tab) + dir], pane = incoming;
      captureTabState(); state.tab = tab; incoming = null; outgoing.remove(); outgoing = null; dragging = false; dir = 0;
      document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
      refreshNetWorth();
      pane.style.position = pane.style.top = pane.style.left = pane.style.width = pane.style.transform = pane.style.transition = "";
      view.innerHTML = ""; while (pane.firstChild) view.appendChild(pane.firstChild);
    }, 250);
  }, { passive: true });
})();

// ---------- visuals ----------
function ringChart(pct, color = "#f5f5f7", size = 76) { const r = size * 0.38, c = size / 2, sw = size * 0.1, circ = 2 * Math.PI * r, fill = Math.max(0, Math.min(1, pct)) * circ; return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="flex-shrink:0"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(245,245,247,0.09)" stroke-width="${sw}"/><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${fill.toFixed(2)} ${circ.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 ${c} ${c})"/></svg>`; }
// Minimalist multi-segment donut — one arc per category, by share of total.
function wheelChart(amts, size = 116) {
  const total = amts.reduce((s, x) => s + x.amt, 0);
  const r = size * 0.4, c = size / 2, sw = size * 0.17, circ = 2 * Math.PI * r;
  if (total <= 0) return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="flex-shrink:0"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${sw}"/></svg>`;
  let off = 0;
  const arcs = amts.map(({ amt, color }) => { const len = (amt / total) * circ, rot = -90 + (off / circ) * 360; off += len; return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" transform="rotate(${rot.toFixed(2)} ${c} ${c})"/>`; }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="flex-shrink:0">${arcs}</svg>`;
}
function areaChart(values) { let vals = values.slice(); if (vals.length < 2) vals = [vals[0] || 0, vals[0] || 0]; const W = 600, H = 160, pad = 6, max = Math.max(...vals), min = Math.min(...vals, 0), range = (max - min) || 1, n = vals.length; const X = i => pad + (i / (n - 1)) * (W - 2 * pad), Y = v => H - pad - ((v - min) / range) * (H - 2 * pad); const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`), line = "M" + pts.join(" L"); const area = `${line} L${X(n - 1).toFixed(1)},${H - pad} L${X(0).toFixed(1)},${H - pad} Z`, id = "g" + Math.random().toString(36).slice(2, 7); return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#${id})"/><path d="${line}" fill="none" stroke="#f5f5f7" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`; }

function miniCalendar(jumpToCal) {
  const today = _d(), y = today.getFullYear(), m0 = today.getMonth(), dim = daysInMonth(y, m0 + 1), mStart = new Date(y, m0, 1), mEnd = new Date(y, m0 + 1, 1);
  const occ = occurrences(mStart, mEnd), byDay = {};
  occ.forEach(o => { (byDay[o.date.getDate()] = byDay[o.date.getDate()] || []).push(o); });
  DB.purchases.filter(p => p.was_made && String(p.occurred_at).slice(0, 7) === `${y}-${pad(m0 + 1)}`).forEach(p => { const dd = +p.occurred_at.slice(8, 10); (byDay[dd] = byDay[dd] || []).push({ ev: { kind: "expense" } }); });
  const wrap = el(`<div class="section"></div>`);
  wrap.append(el(`<div class="cal-hd">${["S", "M", "T", "W", "T", "F", "S"].map(x => `<span>${x}</span>`).join("")}</div>`));
  const grid = el(`<div class="cal mini"></div>`);
  for (let i = 0; i < mStart.getDay(); i++) grid.append(el(`<div class="cal-d out"></div>`));
  for (let day = 1; day <= dim; day++) {
    const dl = byDay[day] || [], dots = [];
    if (dl.some(o => o.ev.kind === "income")) dots.push(`<i class="cal-dot pay"></i>`);
    if (dl.some(o => o.ev.kind === "expense")) dots.push(`<i class="cal-dot due"></i>`);
    const cell = el(`<div class="cal-d ${day === today.getDate() ? "today" : ""}">${day}<div class="cal-dots">${dots.join("")}</div></div>`);
    cell.addEventListener("click", () => { state.calYear = y; state.calMonth = m0; state.schedSel = day; switchTab("schedule"); });
    grid.append(cell);
  }
  wrap.append(grid);
  return wrap;
}

// ---------- forward simulation for outlooks ----------
// Projects every account forward day-by-day from today, applying scheduled
// income/expenses, your current daily save plan, discretionary spend, debt
// interest (APR) and savings/checking APY. Returns net-worth, liquid, and
// per-account series of {i (day offset), v (balance)}.
// No live price-target feed (would need a paid tier) — assume the same 7%/yr the "Grow it" slider uses elsewhere.
const INVEST_DEFAULT_PCT = 7, INVEST_DEFAULT_TYPES = ["roth", "401k", "brokerage"];
function projectSim(days) {
  const start = midnight();
  const bal = {};
  DB.accounts.forEach(a => bal[a.id] = a.balance);
  const occ = occurrences(start, addDays(start, days + 1));
  const buckets = {};
  occ.forEach(o => {
    const i = daysBetween(start, o.date);
    (buckets[i] = buckets[i] || []).push(o);
  });
  const idOf = t => {
    const a = DB.accounts.find(x => x.type === t);
    return a ? a.id : null;
  };
  const chkId = idOf("checking"), savId = idOf("savings"), rothId = idOf("roth"), k401Id = idOf("401k"), ccId = idOf("credit_card");
  const out = { net: [], liquid: [], acct: {}, goal: {} };
  DB.accounts.forEach(a => out.acct[a.id] = []);
  const goalProg = {};
  DB.goals.forEach(g => { out.goal[g.id] = []; goalProg[g.id] = g.current_amount; });
  const rec = i => {
    let assets = 0, liab = 0, lq = 0;
    DB.accounts.forEach(a => {
      const b = bal[a.id];
      if (a.is_liability) liab += b;
      else assets += b;
      if (!a.is_liability && (a.type === "checking" || a.type === "savings")) {
        lq += b;
      }
      out.acct[a.id].push({ i, v: a.is_liability ? -b : b });
    });
    out.net.push({ i, v: assets - liab });
    out.liquid.push({ i, v: lq });
    DB.goals.forEach(g => out.goal[g.id].push({ i, v: goalProg[g.id] }));
  };
  rec(0);
  for (let i = 1; i <= days; i++) {
    DB.accounts.forEach(a => {
      if (a.is_liability && a.apr) {
        bal[a.id] *= 1 + a.apr / 100 / 365;
      } else if (!a.is_liability) {
        const rate = a.apy || (INVEST_DEFAULT_TYPES.includes(a.type) ? INVEST_DEFAULT_PCT : 0);
        if (rate) bal[a.id] *= 1 + rate / 100 / 365;
      }
    });
    // Only apply real scheduled income/expenses.
    (buckets[i] || []).forEach(o => {
      if (chkId != null) {
        bal[chkId] += o.ev.kind === "income" ? o.amount : -o.amount;
      }
    });
    // Sweep that day's prescribed save plan into the matching account, same priority
    // order (card→emergency→Roth→401k→goals) as the live "Save today" targets — this is
    // what makes the outlook reflect your safe elections instead of just sitting in checking.
    // Goals aren't backed by a real account (current_amount is a manual figure), so their
    // funded amount accumulates into a synthetic progress series instead of a balance.
    if (chkId != null) {
      const simDate = addDays(start, i);
      const liquidNow = DB.accounts.filter(a => a.type === "checking" && !a.is_liability).reduce((s, a) => s + bal[a.id], 0);
      const emgNow = DB.accounts.filter(a => a.type === "savings" && !a.is_liability).reduce((s, a) => s + bal[a.id], 0);
      const ccNow = DB.accounts.filter(a => a.type === "credit_card").reduce((s, a) => s + bal[a.id], 0);
      projectFrom(simDate, liquidNow, emgNow, ccNow).targets.forEach(t => {
        if (t.funded <= 0) return;
        if (t.key === "cc") { if (ccId == null) return; bal[chkId] -= t.funded; bal[ccId] -= t.funded; }
        else if (t.key === "emg") { if (savId == null) return; bal[chkId] -= t.funded; bal[savId] += t.funded; }
        else if (t.key === "roth") { if (rothId == null) return; bal[chkId] -= t.funded; bal[rothId] += t.funded; }
        else if (t.key === "k401") { if (k401Id == null) return; bal[chkId] -= t.funded; bal[k401Id] += t.funded; }
        else if (t.key.startsWith("goal")) {
          const gid = +t.key.slice(4);
          if (goalProg[gid] == null) return;
          const g = DB.goals.find(x => x.id === gid);
          bal[chkId] -= t.funded;
          goalProg[gid] = Math.min(g ? g.target_amount : Infinity, goalProg[gid] + t.funded);
        }
      });
    }
    rec(i);
  }
  return out;
}

// Interactive line chart you can drag a finger across to read value + date.
function scrubChart(series, color) {
  const vals = series.map(p => p.v), n = series.length, W = 600, H = 170, pad = 8;
  const max = Math.max(...vals), min = Math.min(...vals), range = (max - min) || 1;
  const X = i => pad + (i / (n - 1)) * (W - 2 * pad), Y = v => H - pad - ((v - min) / range) * (H - 2 * pad);
  const pts = series.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`), line = "M" + pts.join(" L");
  const area = `${line} L${X(n - 1).toFixed(1)},${H - pad} L${X(0).toFixed(1)},${H - pad} Z`, gid = "g" + Math.random().toString(36).slice(2, 7);
  const dateAt = i => fmtDate(isoOf(addDays(midnight(), i)));
  const wrap = el(`<div class="outlook-chart">
    <div class="ol-read"><span class="ol-val">${money0(series[n - 1].v)}</span><span class="ol-date">${dateAt(series[n - 1].i)}</span></div>
    <div class="ol-plot">
      <svg class="ol-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${min < 0 && max > 0 ? `<line class="ol-zero" x1="0" y1="${Y(0).toFixed(1)}" x2="${W}" y2="${Y(0).toFixed(1)}"/>` : ""}<path d="${area}" fill="url(#${gid})"/><path class="ol-line" d="${line}" style="stroke:${color}"/></svg>
      <div class="ol-guide"></div><div class="ol-dot" style="background:${color}"></div>
    </div>
  </div>`);
  const plot = $(".ol-plot", wrap), guide = $(".ol-guide", wrap), dot = $(".ol-dot", wrap), valEl = $(".ol-val", wrap), dateEl = $(".ol-date", wrap);
  const reset = () => { guide.style.opacity = 0; dot.style.opacity = 0; valEl.textContent = money0(series[n - 1].v); dateEl.textContent = dateAt(series[n - 1].i); };
  const scrub = cx => {
    const r = plot.getBoundingClientRect(); let f = (cx - r.left) / r.width; f = Math.max(0, Math.min(1, f));
    const idx = Math.round(f * (n - 1)), p = series[idx], lx = X(idx) / W * 100, ly = Y(p.v) / H * 100;
    guide.style.left = lx + "%"; guide.style.opacity = 1; dot.style.left = lx + "%"; dot.style.top = ly + "%"; dot.style.opacity = 1;
    valEl.textContent = money0(p.v); dateEl.textContent = dateAt(p.i);
  };
  plot.addEventListener("pointerdown", e => { plot.setPointerCapture(e.pointerId); scrub(e.clientX); });
  plot.addEventListener("pointermove", e => { if (e.buttons || e.pointerType === "touch") scrub(e.clientX); });
  plot.addEventListener("pointerup", reset); plot.addEventListener("pointercancel", reset); plot.addEventListener("pointerleave", e => { if (!(e.buttons)) reset(); });
  return wrap;
}

function renderOutlook(v) {
  if (!DB.accounts.length) return;
  const days = state.outlookDays || 30, metric = state.outlookMetric || "net";
  const sim = projectSim(365);
  const full = metric === "net" ? sim.net : metric === "liquid" ? sim.liquid
    : (typeof metric === "string" && metric.startsWith("goal") && sim.goal[+metric.slice(4)]) ? sim.goal[+metric.slice(4)]
    : (sim.acct[+metric] || sim.net);
  const series = full.slice(0, days + 1);
  const chips = el(`<div class="ol-chips"></div>`);
  const addChip = (key, label) => { const c = el(`<button class="ol-chip ${String(metric) === String(key) ? "on" : ""}">${escapeHtml(label)}</button>`); c.addEventListener("click", () => { state.outlookMetric = key; render(); }); chips.append(c); };
  addChip("net", "Net worth"); addChip("liquid", "Liquid");
  DB.accounts.forEach(a => addChip(String(a.id), a.name));
  DB.goals.forEach(g => addChip("goal" + g.id, g.name));
  v.append(chips);
  const chg = series[series.length - 1].v - series[0].v;
  v.append(scrubChart(series, chg >= 0 ? "#2ecc71" : "#ff4d4d"));
  const seg = el(`<div class="seg ol-horizon"></div>`);
  [["7", "1W"], ["30", "1M"], ["90", "3M"], ["180", "6M"], ["365", "1Y"]].forEach(([d, l]) => { const b = el(`<button class="${String(days) === d ? "on" : ""}">${l}</button>`); b.addEventListener("click", () => { state.outlookDays = +d; render(); }); seg.append(b); });
  v.append(seg);
  const lo = series.reduce((m, p) => p.v < m.v ? p : m, series[0]);
  const label = { 7: "1 week", 30: "1 month", 90: "3 months", 180: "6 months", 365: "1 year" }[days];
  v.append(el(`<div class="fs-cap">${chg >= 0 ? "+" : ""}${money0(chg)} projected over ${label}. Low point ${money0(lo.v)} around ${fmtDate(isoOf(addDays(midnight(), lo.i)))}. Drag across the line to read any date.</div>`));
}

// ============================================================================
//  DASHBOARD (Home) — net worth, today, outlook, flow, goals
// ============================================================================
function renderDashboard(v) {
  const d = snapshot();
  if (!d.has_setup) { v.append(el(`<div class="empty">Welcome.<br><br>Add your balances in <b>Manage</b>, then your paychecks & bills on the <b>Calendar</b>.</div>`)); return; }
  v.append(el(`<div class="note" style="text-align:right;margin:4px 0 0">${fmtNow()}</div>`));
  v.append(el(`<div class="hero"><div class="label">Net worth</div><div class="num metal">${money0(d.net_worth)}</div><div class="legs"><div><div class="k">Liquid</div><div class="v">${money0(d.total_liquid)}</div></div><div><div class="k">Assets</div><div class="v up">${money0(d.assets)}</div></div><div><div class="k">Debts</div><div class="v down">${money0(d.liabilities)}</div></div></div></div>`));

  // Today — the two target numbers
  v.append(el(`<div class="group-label">Today${d.has_income ? " · until " + fmtDate(d.next_payday) : ""}</div>`));
  v.append(el(`<div class="stats"><div class="s"><div class="k">Spend${d.spend_locked ? `<span class="chk">${ICONS.check}</span>` : ""}</div><div class="v ${d.spend_today <= 0 ? "down" : ""}">${money0(d.spend_today)}</div></div><div class="s"><div class="k">Save${d.save_locked ? `<span class="chk">${ICONS.check}</span>` : ""}</div><div class="v up">${money0(d.save_today)}</div></div><div class="s"><div class="k">Cash now</div><div class="v">${money0(d.liquid)}</div></div></div>`));
  if (d.card_virtually_paid)
    v.append(el(`<div class="warn-box"><div class="wb-title">Card payoff assumed</div>Your checking + savings can fully cover your ${money0(d.card_payoff_used)} card balance, so today's numbers assume it's cleared first. Use <b>Transfer</b> in Manage to actually pay it down.</div>`));
  if (d.short_before_pay > 0)
    v.append(el(`<div class="warn-box"><div class="wb-title">Short before payday</div>Your ${money0(d.liquid)} cash won't cover ${money0(d.win_expenses)} of bills due before ${fmtDate(d.next_payday)} — about ${money0(d.short_before_pay)} short. Anything you spend now goes on your card; clear it after payday.</div>`));
  else {
    v.append(el(`<div class="fs-cap">${money0(d.liquid)} spendable cash − ${money0(d.win_expenses)} bills due${d.reserve_for_next > 0 ? " − " + money0(d.reserve_for_next) + " set aside for the bills your next paycheck can't cover" : ""}, over ${d.runway_days}d = ${money0(d.free_daily)}/day to split between saving and spending.${d.emergency_saved > 0 ? `<br>(Your ${money0(d.total_liquid)} liquid includes ${money0(d.emergency_saved)} in savings — earmarked, not counted here so you're not told to save money you already saved.)` : ""}</div>`));
    const funded = d.targets.filter(t => t.funded > 0.005);
    if (funded.length) {
      v.append(el(`<div class="group-label">Save today — where it goes</div>`));
      const list = el(`<div class="section"></div>`);
      funded.forEach(t => list.append(el(`<div class="row"><div class="left" style="flex-direction:row;align-items:center;gap:12px"><span class="glyph">${GLYPH[t.glyph] || GLYPH.save}</span><span class="name">${escapeHtml(t.label)}</span></div><span class="v up">${money0(t.funded)}/day</span></div>`)));
      v.append(list);
    }
    if (d.over_allocated && d.underfunded.length)
      v.append(el(`<div class="note">To hit every goal on time you'd save ${money0(d.ideal_daily)}/day — more than the ${money0(d.free_daily)}/day you free up. Card and retirement are funded first; <b>${d.underfunded.map(u => escapeHtml(u.label) + " (−" + money0(u.short) + "/day)").join(", ")}</b> are short. Push their target dates out, or trim a flexible expense, to fully align.</div>`));
  }

  // Today's progress — what you've actually spent & saved (drives tomorrow's recalibration)
  v.append(el(`<div class="group-label">Logged today</div>`));
  v.append(el(`<div class="stats"><div class="s"><div class="k">Spent</div><div class="v ${d.spent_today > 0 ? "down" : ""}">${money0(d.spent_today)}</div></div><div class="s"><div class="k">Saved</div><div class="v ${d.saved_today > 0 ? "up" : ""}">${money0(d.saved_today)}</div></div></div>`));
  const payAccts = DB.accounts.filter(a => ["checking", "savings", "credit_card"].includes(a.type));
  const defPay = DB.accounts.find(a => a.type === "credit_card") || DB.accounts.find(a => a.type === "checking");
  const eform = el(`<div class="section"><div class="two"><label class="field"><span>I spent</span><input id="le-amt" type="number" inputmode="decimal" placeholder="0" /></label><label class="field"><span>on</span><select id="le-cat">${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("")}</select></label></div>${payAccts.length > 1 ? `<label class="field"><span>paid with</span><select id="le-acct">${payAccts.map(a => `<option value="${a.id}"${defPay && a.id === defPay.id ? " selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}</select></label>` : ""}<button class="btn secondary" id="le-go">Log it</button></div>`);
  v.append(eform);
  $("#le-go", eform).addEventListener("click", () => { const amt = +$("#le-amt", eform).value || 0, cat = $("#le-cat", eform).value, acctSel = $("#le-acct", eform); if (amt > 0) logPurchase(cat, amt, cat, true, null, true, isoToday(), acctSel ? +acctSel.value : null); });
  const destAccts = DB.accounts.filter(a => ["savings", "roth", "401k", "brokerage"].includes(a.type));
  if (destAccts.length) {
    const sform = el(`<div class="section"><div class="two"><label class="field"><span>I saved</span><input id="ls-amt" type="number" inputmode="decimal" placeholder="0" /></label><label class="field"><span>into</span><select id="ls-dest">${destAccts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")}</select></label></div><button class="btn secondary" id="ls-go">Log it</button></div>`);
    v.append(sform);
    $("#ls-go", sform).addEventListener("click", () => { const amt = +$("#ls-amt", sform).value || 0; if (amt > 0) logSave(amt, +$("#ls-dest", sform).value); });
  }
  v.append(el(`<div class="note">Logging a spend (Decide) or a save moves real money out of checking, so tomorrow's numbers recalibrate on their own. The app re-checks the date whenever you open it — no manual refresh.</div>`));

  // By category — minimalist wheel + $ and % per category
  const byCat = {}; DB.purchases.filter(p => p.was_made).forEach(p => byCat[p.category] = (byCat[p.category] || 0) + p.amount);
  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (catEntries.length) {
    const totalSpent = catEntries.reduce((s, [, amt]) => s + amt, 0);
    const wrap = el(`<div class="wheel-row"></div>`);
    wrap.insertAdjacentHTML("beforeend", wheelChart(catEntries.map(([cat, amt]) => ({ amt, color: catColor(cat) }))));
    const legend = el(`<div class="wheel-legend"></div>`);
    catEntries.forEach(([cat, amt]) => legend.append(el(`<div class="wl-row"><i style="background:${catColor(cat)}"></i><span class="wl-name">${escapeHtml(cat)}</span><span class="wl-amt">${money0(amt)}</span><span class="wl-pct">${Math.round(amt / totalSpent * 100)}%</span></div>`)));
    wrap.append(legend);
    v.append(collapsible("By category", wrap));
  }

  // Where the money goes — forward projection from cash (calendar + balances combined)
  const agenda = projectedAgenda(45).slice(0, 7);
  if (agenda.length) {
    const list = el(`<div class="section"></div>`);
    agenda.forEach(r => { const inc = r.kind === "income"; list.append(el(`<div class="row"><div class="left"><span class="name">${escapeHtml(r.name)}</span><span class="meta">${fmtDate(isoOf(r.date))}</span></div><div style="display:flex;align-items:center;gap:14px"><span class="v ${inc ? "up" : "down"}">${inc ? "+" : "−"}${money0(r.amount)}</span><span class="v ${r.bal < 0 ? "down" : "subtle"}" style="min-width:62px;text-align:right">${money0(r.bal)}</span></div></div>`)); });
    v.append(collapsible("What's coming — balance after each", list));
  }

  // Outlook — swipeable projections (replaces the duplicated calendar)
  const olWrap = el(`<div></div>`); renderOutlook(olWrap);
  v.append(collapsible("Outlook", olWrap));

  // Goals
  if (DB.goals.length || d.emergency_target > 0) {
    const list = el(`<div></div>`);
    if (d.emergency_target > 0) { const ec = d.emergency_pct >= 1 ? "#2ecc71" : d.emergency_pct >= 0.5 ? "#f5a623" : "#ff4d4d"; list.append(el(`<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--line)">${ringChart(d.emergency_pct, ec, 52)}<div style="flex:1"><div style="display:flex;justify-content:space-between;gap:8px"><span class="name">Emergency fund</span><span class="subtle" style="font-size:12px">${money0(d.emergency_saved)} / ${money0(d.emergency_target)}</span></div></div></div>`)); }
    DB.goals.forEach(g => { const pct = g.target_amount > 0 ? Math.min(1, g.current_amount / g.target_amount) : 0; list.append(el(`<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--line)">${ringChart(pct, pct >= 1 ? "#2ecc71" : "#f5f5f7", 52)}<div style="flex:1"><div style="display:flex;justify-content:space-between;gap:8px"><span class="name">${escapeHtml(g.name)}</span><span class="subtle" style="font-size:12px">${money0(g.current_amount)} / ${money0(g.target_amount)}</span></div></div></div>`)); });
    v.append(collapsible("Goals", list));
  }

  // Achievements — trophy case for streaks and lifetime saved/skipped milestones
  const unlocked = d.achievements.filter(a => a.unlocked).length;
  const achList = el(`<div class="section"></div>`);
  d.achievements.forEach(a => achList.append(el(`<div class="row ach${a.unlocked ? "" : " locked"}"><div class="left"><span class="name">${escapeHtml(a.name)}</span><span class="meta">${escapeHtml(a.desc)}</span></div>${a.unlocked ? `<span class="chk">${ICONS.check}</span>` : ""}</div>`)));
  v.append(collapsible(`Achievements (${unlocked}/${d.achievements.length})`, achList, false, "achievements"));
}

const ACCOUNT_TYPES = [["checking", "Checking"], ["savings", "Savings"], ["401k", "401(k)"], ["roth", "Roth IRA"], ["brokerage", "Brokerage"], ["other", "Other asset"], ["credit_card", "Credit card"], ["student_loan", "Student loan"], ["loan", "Other loan"]];
const LIABILITY_TYPES = ["credit_card", "student_loan", "loan"];
const HOLDINGS_TYPES = ["roth", "brokerage"];
const typeLabel = t => (ACCOUNT_TYPES.find(x => x[0] === t) || [t, t])[1];
const acctGlyph = t => GLYPH[TYPE_GLYPH[t] || "cash"];

// Expense categories — shared by Decide, the home quick-log, and the category wheel.
const CATEGORIES = ["shopping", "dining", "entertainment", "travel", "subscriptions", "gadgets", "health", "sport", "fitness", "essentials", "other"];
const CAT_COLOR = { shopping: "#e6e6e6", dining: "#bdbdbd", entertainment: "#949494", travel: "#6b6b6b", subscriptions: "#e6e6e6", gadgets: "#bdbdbd", health: "#949494", sport: "#6b6b6b", fitness: "#e6e6e6", essentials: "#bdbdbd", other: "#949494" };
const catColor = c => CAT_COLOR[c] || CAT_COLOR.other;

// ---------- collapsible sections + sortable lists (shared across tabs) ----------
// Open/closed state persists per tab (keyed separately from the label, since some labels
// like the achievements count change at render time) so it survives a tab swipe and back.
function collapsible(label, contentEl, defaultOpen = true, key = label) {
  const k = `${state.tab}:${key}`;
  const open = k in state.collapse ? state.collapse[k] : defaultOpen;
  const det = el(`<details class="coll" ${open ? "open" : ""}><summary class="group-label">${label}</summary><div class="coll-body"></div></details>`);
  det.querySelector(".coll-body").append(contentEl);
  det.addEventListener("toggle", () => { state.collapse[k] = det.open; });
  return det;
}
function sortControl(current, options, onChange) {
  const seg = el(`<div class="seg sortseg">${options.map(([k, l]) => `<button class="${k === current ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}</div>`);
  seg.querySelectorAll("button").forEach(b => b.addEventListener("click", () => onChange(b.dataset.k)));
  return seg;
}
// Slide a freshly-inserted dropdown body open, or slide a live one closed before the
// state change + render() that would otherwise yank it out of the DOM instantly.
function slideOpen(elm) {
  elm.style.overflow = "hidden"; elm.style.height = "0px";
  const h = elm.scrollHeight;
  requestAnimationFrame(() => { elm.style.transition = "height .28s cubic-bezier(.22,.61,.36,1)"; elm.style.height = h + "px"; });
  elm.addEventListener("transitionend", () => { elm.style.cssText = ""; }, { once: true });
}
function slideClose(elm, done) {
  elm.style.overflow = "hidden"; elm.style.height = elm.scrollHeight + "px";
  requestAnimationFrame(() => { elm.style.transition = "height .22s ease"; elm.style.height = "0px"; });
  elm.addEventListener("transitionend", done, { once: true });
}

// ---------- shared undo (History + Calendar day view both revert the same way) ----------
function revertPurchase(p) {
  if (p.to_credit > 0) {
    // account_id is the card itself for a direct charge; falls back to "any card" for the legacy cascade-overflow case.
    const c = DB.accounts.find(x => x.id === p.account_id && x.is_liability) || DB.accounts.find(x => x.type === "credit_card");
    if (c) c.balance -= p.to_credit;
    const liquidPortion = p.amount - p.to_credit;
    if (liquidPortion > 0.005) { const a = DB.accounts.find(x => x.type === "checking") || DB.accounts.find(x => LIQUID_TYPES.includes(x.type)); if (a) a.balance += liquidPortion; }
  } else {
    const a = DB.accounts.find(x => x.id === p.account_id) || DB.accounts.find(x => x.type === "checking") || DB.accounts.find(x => LIQUID_TYPES.includes(x.type));
    if (a) a.balance += p.amount;
  }
  DB.purchases = DB.purchases.filter(x => x.id !== p.id);
}
function revertSave(x) {
  const dest = DB.accounts.find(a => a.id === x.account_id), chk = DB.accounts.find(a => a.type === "checking");
  if (dest) dest.balance -= x.amount;
  if (chk) chk.balance += x.amount;
  if (dest && dest.type === "roth") DB.savings.roth_ytd = Math.max(0, (DB.savings.roth_ytd || 0) - x.amount);
  DB.saves = DB.saves.filter(z => z.id !== x.id);
}

// ============================================================================
//  CALENDAR — input surface; events vs running liquidity
// ============================================================================
function renderCalendar(v) {
  const s = snapshot(), today = _d();
  if (state.calYear == null) state.calYear = today.getFullYear();
  if (state.calMonth == null) state.calMonth = today.getMonth();
  const y = state.calYear, m0 = state.calMonth, dim = daysInMonth(y, m0 + 1), mStart = new Date(y, m0, 1), mEnd = new Date(y, m0 + 1, 1);
  const mLong = mStart.toLocaleString("en-US", { month: "long" }), mShort = mStart.toLocaleString("en-US", { month: "short" }), isCur = y === today.getFullYear() && m0 === today.getMonth();

  const nav = el(`<div class="calnav"><button class="navbtn" id="cal-prev">‹</button><div class="callabel">${mLong} ${y}</div><button class="navbtn" id="cal-next">›</button></div>`);
  v.append(nav);
  $("#cal-prev", nav).addEventListener("click", () => { state.schedSel = null; state.editEvent = null; if (--state.calMonth < 0) { state.calMonth = 11; state.calYear--; } render(); });
  $("#cal-next", nav).addEventListener("click", () => { state.schedSel = null; state.editEvent = null; if (++state.calMonth > 11) { state.calMonth = 0; state.calYear++; } render(); });
  if (!isCur) { const t = el(`<button class="btn text" style="margin:-6px 0 8px">Today</button>`); t.addEventListener("click", () => { state.calYear = today.getFullYear(); state.calMonth = today.getMonth(); state.schedSel = null; state.editEvent = null; render(); }); v.append(t); }

  const occ = occurrences(mStart, mEnd), byDay = {};
  occ.forEach(o => { (byDay[o.date.getDate()] = byDay[o.date.getDate()] || []).push(o); });
  DB.purchases.filter(p => p.was_made && String(p.occurred_at).slice(0, 7) === `${y}-${pad(m0 + 1)}`).forEach(p => { const dd = +p.occurred_at.slice(8, 10); (byDay[dd] = byDay[dd] || []).push({ ev: { kind: "expense" } }); });

  v.append(el(`<div class="cal-hd">${["S", "M", "T", "W", "T", "F", "S"].map(x => `<span>${x}</span>`).join("")}</div>`));
  const grid = el(`<div class="cal"></div>`);
  for (let i = 0; i < mStart.getDay(); i++) grid.append(el(`<div class="cal-d out"></div>`));
  for (let day = 1; day <= dim; day++) {
    const dl = byDay[day] || [], dots = [];
    if (dl.some(o => o.ev.kind === "income")) dots.push(`<i class="cal-dot pay"></i>`);
    if (dl.some(o => o.ev.kind === "expense")) dots.push(`<i class="cal-dot due"></i>`);
    const cell = el(`<div class="cal-d ${isCur && day === today.getDate() ? "today" : ""} ${state.schedSel === day ? "sel" : ""}">${day}<div class="cal-dots">${dots.join("")}</div></div>`);
    cell.addEventListener("click", () => { state.schedSel = state.schedSel === day ? null : day; state.editEvent = null; render(); });
    grid.append(cell);
  }
  v.append(grid);
  v.append(el(`<div class="legend" style="margin-top:12px"><span><i style="background:var(--up)"></i>Income</span><span><i style="background:var(--down)"></i>Expense</span></div>`));
  if (!isCur) v.append(el(`<div class="note">Projected cash entering ${mLong}: <b>${money0(projectedLiquidAt(mStart))}</b> — from scheduled income & bills only.</div>`));
  else v.append(el(`<div class="note">Tap a day to add or edit. Your balances + these events drive your spend & save numbers.</div>`));

  if (state.schedSel) {
    const day = state.schedSel, dayIso = `${y}-${pad(m0 + 1)}-${pad(day)}`;
    v.append(el(`<div class="group-label">${mShort} ${day}, ${y}</div>`));
    (byDay[day] || []).forEach(o => {
      const inc = o.ev.kind === "income", recurring = o.ev.recur !== "once";
      const row = el(`<div class="row"><div class="left edit" style="cursor:pointer"><span class="name">${escapeHtml(o.ev.name)}</span><span class="meta">${recurLabel(o.ev.recur)}${o.ev.kind === "expense" ? (o.ev.flex ? " · flexible" : " · fixed") : ""}</span></div><div style="display:flex;align-items:center;gap:14px"><span class="v ${inc ? "up" : "down"}">${inc ? "+" : "−"}${money0(o.amount)}</span><button class="del">×</button></div></div>`);
      $(".edit", row).addEventListener("click", () => { state.editEvent = o.ev.id; render(); });
      $(".del", row).addEventListener("click", () => {
        if (recurring) { o.ev.skip = (o.ev.skip || []).concat(dayIso); }   // remove just this occurrence
        else { DB.events = DB.events.filter(e => e.id !== o.ev.id); if (state.editEvent === o.ev.id) state.editEvent = null; }
        save(); render();
      });
      v.append(row);
    });
    DB.purchases.filter(p => p.was_made && p.occurred_at === dayIso).forEach(p => { const row = el(`<div class="row"><div class="left"><span class="name">${escapeHtml(p.description)}</span><span class="meta">${p.category} · spent${p.to_credit > 0 ? " · " + money0(p.to_credit) + " on card" : ""}</span></div><div style="display:flex;align-items:center;gap:14px"><span class="v down">−${money0(p.amount)}</span><button class="del">×</button></div></div>`); $(".del", row).addEventListener("click", () => { if (!confirm(`Refund ${money(p.amount)} and remove?`)) return; revertPurchase(p); save(); render(); }); v.append(row); });
    (DB.saves || []).filter(x => x.date === dayIso).forEach(x => { const row = el(`<div class="row"><div class="left"><span class="name">Saved to ${escapeHtml(x.dest || "savings")}</span><span class="meta">moved from checking</span></div><div style="display:flex;align-items:center;gap:14px"><span class="v up">+${money0(x.amount)}</span><button class="del">×</button></div></div>`); $(".del", row).addEventListener("click", () => { if (!confirm("Undo this save?")) return; revertSave(x); save(); render(); }); v.append(row); });
    v.append(eventForm(dayIso, state.editEvent));
  }

}

function eventForm(prefillDate, editId) {
  const ev = editId ? DB.events.find(e => e.id === editId) : null;
  const e = ev || { name: "", amount: "", kind: "expense", flex: false, recur: "monthly", date: prefillDate, day: +prefillDate.slice(8, 10), day2: Math.min(+prefillDate.slice(8, 10) + 15, 28) };
  const form = el(`<div class="section" style="margin-top:10px">
    <div class="group-label" style="margin-top:0">${ev ? "Edit" : "Add to " + fmtDate(prefillDate)}</div>
    <div class="seg" id="ev-kind"><button class="${e.kind === "expense" ? "on" : ""}" data-k="expense">Expense</button><button class="${e.kind === "income" ? "on" : ""}" data-k="income">Income</button></div>
    <label class="field"><span>Name</span><input id="ev-name" placeholder="Rent / Paycheck / Bonus" value="${escapeHtml(e.name)}" /></label>
    <div class="two"><label class="field"><span>Amount</span><input id="ev-amt" type="number" placeholder="0" value="${e.amount || ""}" /></label><label class="field"><span>Repeats</span><select id="ev-recur">${RECURS.map(r => `<option value="${r[0]}" ${r[0] === e.recur ? "selected" : ""}>${r[1]}</option>`).join("")}</select></label></div>
    <label class="field" data-f="date"><span>Date</span><input id="ev-date" type="date" value="${e.date || prefillDate}" /></label>
    <label class="field" data-f="day"><span>Day of month</span><input id="ev-day" type="number" min="1" max="31" value="${e.day || +prefillDate.slice(8, 10)}" /></label>
    <label class="field" data-f="day2"><span>Second day</span><input id="ev-day2" type="number" min="1" max="31" value="${e.day2 || 15}" /></label>
    <div class="row" data-f="flex" style="border:none;padding:6px 0;cursor:pointer" id="ev-flex-row"><span class="name">Flexible (can adjust to save)</span><input type="checkbox" id="ev-flex" ${e.flex ? "checked" : ""} style="width:auto" /></div>
    <div class="btn-row"><button class="btn ${ev ? "" : "secondary"}" id="ev-save">${ev ? "Save" : "Add"}</button>${ev ? `<button class="btn text" id="ev-cancel">Cancel</button>${ev.recur !== "once" ? `<button class="btn text" id="ev-delall" style="color:var(--down)">Delete whole series</button>` : ""}` : ""}</div>
  </div>`);
  let kind = e.kind;
  const applyFields = () => { const r = $("#ev-recur", form).value; form.querySelector('[data-f="date"]').style.display = ["once", "weekly", "biweekly"].includes(r) ? "block" : "none"; form.querySelector('[data-f="day"]').style.display = (r === "monthly" || r === "semimonthly") ? "block" : "none"; form.querySelector('[data-f="day2"]').style.display = r === "semimonthly" ? "block" : "none"; form.querySelector('[data-f="flex"]').style.display = kind === "expense" ? "flex" : "none"; };
  form.querySelectorAll("#ev-kind button").forEach(b => b.addEventListener("click", () => { kind = b.dataset.k; form.querySelectorAll("#ev-kind button").forEach(x => x.classList.toggle("on", x === b)); applyFields(); }));
  $("#ev-recur", form).addEventListener("change", applyFields);
  $("#ev-flex-row", form).addEventListener("click", e2 => { if (e2.target.id !== "ev-flex") $("#ev-flex", form).checked = !$("#ev-flex", form).checked; });
  applyFields();
  $("#ev-save", form).addEventListener("click", () => { const name = $("#ev-name", form).value.trim(), amount = +$("#ev-amt", form).value || 0, recur = $("#ev-recur", form).value; if (!name || !amount) return; const data = { name, amount, kind, recur, flex: kind === "expense" ? $("#ev-flex", form).checked : false, date: $("#ev-date", form).value || prefillDate, day: +$("#ev-day", form).value || 1, day2: +$("#ev-day2", form).value || 15, category: ev?.category || "" }; if (ev) Object.assign(ev, data); else DB.events.push({ id: nextId(), ...data }); state.editEvent = null; save(); render(); });
  const cancel = $("#ev-cancel", form); if (cancel) cancel.addEventListener("click", () => { state.editEvent = null; render(); });
  const delall = $("#ev-delall", form); if (delall) delall.addEventListener("click", () => { if (confirm("Delete the entire repeating series?")) { DB.events = DB.events.filter(e => e.id !== ev.id); state.editEvent = null; save(); render(); } });
  return form;
}

// ============================================================================
//  DECIDE (+ coach)
// ============================================================================
function renderDecide(v) {
  v.append(el(`<div class="view-title">Decide</div>`));
  renderCheckInto(v);
}
function renderCheckInto(v) {
  const c = state.decide;
  const form = el(`<div class="section">
    <label class="field"><span>What is it?</span><input id="d-desc" placeholder="New swim fins" value="${escapeHtml(c.desc || "")}" /></label>
    <label class="field"><span>Amount</span><input id="d-amt" type="number" inputmode="decimal" placeholder="0" value="${c.amount || ""}" /></label>
    <div class="two"><label class="field"><span>Category</span><select id="d-cat">${CATEGORIES.map(x => `<option ${x === (c.category || "shopping") ? "selected" : ""}>${x}</option>`).join("")}</select></label><label class="field"><span>Date</span><input id="d-date" type="date" min="${isoToday()}" value="${c.date || isoToday()}" /></label></div>
    <div class="seg" id="d-type"><button class="${(c.disc ?? 1) ? 'on' : ''}" data-disc="1">Want</button><button class="${(c.disc ?? 1) ? '' : 'on'}" data-disc="0">Need</button></div>
    <button class="btn" id="d-go">Check it</button>
  </div>`);
  v.append(form); const result = el(`<div id="d-result"></div>`); v.append(result);
  state.decideDisc = c.disc ?? 1;
  form.querySelectorAll("#d-type button").forEach(b => b.addEventListener("click", () => { state.decideDisc = Number(b.dataset.disc); form.querySelectorAll("#d-type button").forEach(x => x.classList.toggle("on", x === b)); }));
  $("#d-go", form).addEventListener("click", () => { const amount = parseFloat($("#d-amt", form).value); if (!amount || amount <= 0) { result.innerHTML = `<div class="empty">Enter an amount.</div>`; return; } if (!DB.accounts.length) { result.innerHTML = `<div class="empty">Add your accounts in Manage first.</div>`; return; } const date = $("#d-date", form).value || isoToday(); renderVerdict(result, amount, $("#d-desc", form).value.trim() || $("#d-cat", form).value, $("#d-cat", form).value, !!state.decideDisc, date); });
}
async function renderVerdict(c, amount, desc, category, disc, date) {
  const r = decide(amount, category, disc, date), s = r.snap, future = date && date !== isoToday();
  const sub = { yes: "Aligns with your plan.", caution: "You can — but it costs you.", veto: "Beyond your means right now." };
  c.innerHTML = "";
  const verdictEl = el(`<div class="verdict"><div class="word ${r.verdict}">${r.verdict.toUpperCase()}</div><div class="sub">${sub[r.verdict]} · ${money(amount)}${future ? " · " + fmtDate(date) : ""}</div></div>`); c.append(verdictEl);
  c.append(el(`<div class="stats"><div class="s"><div class="k">This buy</div><div class="v down">${money0(amount)}</div></div><div class="s"><div class="k">Spend room</div><div class="v">${money0(s.period_remaining)}</div></div><div class="s"><div class="k">${r.to_credit > 0 ? "On card" : (future ? "Liquid then" : "Liquid")}</div><div class="v ${r.to_credit > 0 ? "down" : ""}">${money0(r.to_credit > 0 ? r.to_credit : s.liquid)}</div></div></div>`));
  if (s.period_remaining > 0) c.append(el(`<div class="bar${r.pct_of_room >= 0.8 ? " warn" : ""}"><i style="width:${Math.min(100, Math.round(r.pct_of_room * 100))}%"></i></div>`));
  const why = el(`<div class="section"><div class="group-label">Why</div><ul class="reasons" id="why-list"></ul></div>`); r.reasons.slice(0, 3).forEach(x => $("#why-list", why).append(el(`<li>${x}</li>`))); c.append(why);
  if (r.after.period_remaining !== s.period_remaining || r.target_impacts.length) {
    const ib = el(`<div class="section"><div class="group-label">If you buy this</div></div>`);
    ib.append(el(`<div class="impact"><div class="left"><span class="name">Spend room till ${fmtDate(s.next_payday)}</span><span class="meta">${money0(s.period_remaining)} → ${money0(r.after.period_remaining)}</span></div><span class="delay ${r.after.period_remaining < s.period_remaining ? "down" : ""}">${Math.round(r.pct_of_room * 100)}% used</span></div>`));
    r.target_impacts.forEach(t => ib.append(el(`<div class="impact"><div class="left"><span class="name">${escapeHtml(t.label)}</span><span class="meta">${money0(t.before)}/day → ${money0(t.after)}/day</span></div><span class="delay down">-${money0(t.total_slowed)}</span></div>`)));
    c.append(ib);
  }
  const slips = r.goal_impacts.filter(g => g.delay_days > 0);
  if (slips.length) { const gi = el(`<div class="section"><div class="group-label">Slows your goals</div></div>`); slips.forEach(g => gi.append(el(`<div class="impact"><div class="left"><span class="name">${escapeHtml(g.name)}</span></div><span class="delay down">+${g.delay_days}d → ${fmtDate(g.eta_after)}</span></div>`))); c.append(gi); }
  const actions = el(`<div class="section"><div class="group-label">Log it</div><div class="btn-row"></div></div>`);
  const payAccts = DB.accounts.filter(a => ["checking", "savings", "credit_card"].includes(a.type));
  const defPay = r.to_credit > 0 ? DB.accounts.find(a => a.type === "credit_card") : DB.accounts.find(a => a.type === "checking");
  if (payAccts.length > 1) actions.insertBefore(el(`<label class="field"><span>Pay with</span><select id="d-pay">${payAccts.map(a => `<option value="${a.id}"${defPay && a.id === defPay.id ? " selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}</select></label>`), $(".btn-row", actions));
  const made = el(`<button class="btn">${r.to_credit > 0 ? "Bought it (on card)" : "Bought it"}</button>`), skipped = el(`<button class="btn secondary">Skipped — saved ${money0(amount)}</button>`);
  made.addEventListener("click", () => { const pay = $("#d-pay", actions); logPurchase(desc, amount, category, disc, r.verdict, true, date, pay ? +pay.value : null); });
  skipped.addEventListener("click", () => logPurchase(desc, amount, category, disc, r.verdict, false, date));
  $(".btn-row", actions).append(made, skipped); c.append(actions);
  if (DB.profile.anthropic_key) { const ai = el(`<div class="section"><div class="group-label">Coach's take</div><div class="bubble assistant" id="ai-take">Thinking…</div></div>`); c.insertBefore(ai, actions); const res = await aiDecide(desc, amount, category, disc, r); if (res) { if (["yes", "caution", "veto"].includes(res.verdict)) { verdictEl.querySelector(".word").className = `word ${res.verdict}`; verdictEl.querySelector(".word").textContent = res.verdict.toUpperCase(); verdictEl.querySelector(".sub").textContent = `${sub[res.verdict]} · ${money(amount)}`; } $("#ai-take", ai).textContent = res.text; } else ai.remove(); }
}

// ---------- coach ----------
function coachReplyRules(text) { const snap = snapshot(), m = text.match(/\$?\s*([\d][\d,]*(?:\.\d+)?)/); if (m) { const amt = parseFloat(m[1].replace(/,/g, "")); if (amt > 0) { const r = decide(amt, "other", true); return `${r.verdict.toUpperCase()} on ${money(amt)}.\n${r.reasons[0]}`; } } return `Liquid ${money0(snap.liquid)} · spend ${money0(snap.spend_today)}/day, save ${money0(snap.save_today)}/day until ${fmtDate(snap.next_payday)}.\n\nGive me a price and I'll weigh it.`; }
function buildSystemPrompt() {
  const s = snapshot(), p = DB.profile, sv = DB.savings;
  const inc = DB.events.filter(e => e.kind === "income").map(e => `${e.name} ${money(e.amount)} ${recurLabel(e.recur)}`).join("; ") || "none";
  const exp = DB.events.filter(e => e.kind === "expense").map(e => `${e.name} ${money(e.amount)} ${recurLabel(e.recur)}${e.flex ? "(flex)" : ""}`).join("; ") || "none";
  const tg = s.targets.map(t => `${t.label} ${money(t.funded)}/${money(t.daily)}`).join("; ") || "none";
  const accts = DB.accounts.map(a => { let d = `${a.name} (${typeLabel(a.type)}) ${a.is_liability ? "-" : ""}${money(a.balance)}`; if (a.is_liability && a.apr) d += ` @ ${a.apr}% APR`; if (a.holdings?.length) d += ` [${a.holdings.map(h => `${h.shares} ${h.symbol}`).join(", ")}]`; return d; }).join("; ") || "none";
  const goals = (DB.goals || []).map(g => `${g.name} ${money(g.current_amount)}/${money(g.target_amount)} by ${g.target_date} (+${money(g.monthly_contribution)}/mo)`).join("; ") || "none";
  return `Direct, numbers-first finance coach who can answer ANY question about this person's finances — not just judge one purchase. Concise.

ACCOUNTS: ${accts}
NOW: net ${money(s.net_worth)} | liquid ${money(s.liquid)} | total liquid (checking+savings) ${money(s.total_liquid)} | card ${money(s.cc_balance)} | spend/day ${money(s.spend_today)} | save/day ${money(s.save_today)} | payday ${s.next_payday} (${s.runway_days}d)${s.short_before_pay > 0 ? ` | SHORT ${money(s.short_before_pay)} (credit)` : ""}
SAVE TARGETS (funded/needed): ${tg}
GOALS: ${goals}
RETIREMENT/EMERGENCY: Roth YTD ${money(sv.roth_ytd)}/${money(sv.roth_limit)} (auto ${sv.roth_auto ? money(sv.roth_monthly) + "/mo" : "off"}) | 401k ${money(sv.k401_monthly)}/mo | Emergency target ${money(sv.emergency_target)} by ${sv.emergency_date || "no date"} (${money(sv.emergency_monthly)}/mo)
INCOME: ${inc}
EXPENSES: ${exp}
PRIORITIES: ${p.priorities || "none"}${p.annual_salary_pretax ? ` | Salary (pretax) ${money(p.annual_salary_pretax)}` : ""}${p.credit_score ? ` | Credit score ${p.credit_score}` : ""}

Flex expenses trim first; fixed are committed. Spend never forced to $0 — savings throttle instead.`;
}
// system is cached server-side (Anthropic prompt caching) so repeat turns in one
// conversation re-bill only the new message, not the whole financial picture again.
async function callClaude(messages, system, maxTokens = 500) { const key = DB.profile.anthropic_key; if (!key) return null; const resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages }) }); if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${resp.status}`); } const data = await resp.json(); return data.content?.[0]?.text || null; }
async function aiDecide(desc, amount, category, disc, r) { const s = r.snap; const sys = buildSystemPrompt() + `\n\nJudge ONE purchase. Line 1: YES, CAUTION, or VETO. Then ≤2 short sentences, numbers, no preamble.`; const ctx = `Buy: ${desc} — ${money(amount)} (${category}, ${disc ? "want" : "need"}). Spend room ${money(s.period_remaining)} until ${s.next_payday}. ${r.to_credit > 0 ? money(r.to_credit) + " would go on card." : ""} Math says ${r.verdict.toUpperCase()}.`; try { const txt = await callClaude([{ role: "user", content: ctx }], sys, 200); if (!txt) return null; const first = txt.trim().split(/\s|\n/)[0].toLowerCase().replace(/[^a-z]/g, ""); return { verdict: ["yes", "caution", "veto"].includes(first) ? first : r.verdict, text: txt.trim().replace(/^(yes|caution|veto)[\s:.\-—]*/i, "").trim() || txt.trim() }; } catch (e) { return { verdict: r.verdict, text: `(AI unavailable: ${e.message})` }; } }
function renderCoachInto(v) {
  const hasAI = !!DB.profile.anthropic_key;
  v.append(el(`<div class="note ${hasAI ? "ok" : ""}" style="margin:2px 0 12px">${hasAI ? "AI coach — knows your full picture" : "Free coach · add a key in Manage for AI"}</div>`));
  const log = el(`<div class="chat-log" id="chat-log"></div>`); v.append(log);
  const loadConv = id => { state.convId = id; log.innerHTML = ""; if (!id) { log.append(el(`<div class="bubble assistant">Ask me anything — "can I afford a $1,200 trip?"</div>`)); return; } (DB.conversations.find(c => c.id === id)?.messages || []).forEach(mm => log.append(el(`<div class="bubble ${mm.role}">${escapeHtml(mm.content)}</div>`))); log.lastChild?.scrollIntoView({ block: "end" }); };
  const input = el(`<div class="chat-input"><input id="chat-text" placeholder="Ask your coach…" /><button class="btn" id="chat-send">Send</button></div>`); v.append(input);
  async function send() { const text = $("#chat-text", input).value.trim(); if (!text) return; $("#chat-text", input).value = ""; $("#chat-send", input).disabled = true; $("#chat-send", input).textContent = "…"; let conv = DB.conversations.find(c => c.id === state.convId); if (!conv) { conv = { id: nextId(), title: text.slice(0, 40), created_at: isoToday(), messages: [] }; DB.conversations.push(conv); state.convId = conv.id; } conv.messages.push({ role: "user", content: text }); log.append(el(`<div class="bubble user">${escapeHtml(text)}</div>`)); log.lastChild.scrollIntoView({ block: "end" }); let answer = null; if (hasAI) { try { answer = await callClaude(conv.messages.slice(-8), buildSystemPrompt()); } catch (e) { answer = `(AI unavailable: ${e.message})`; } } if (!answer) answer = coachReplyRules(text); conv.messages.push({ role: "assistant", content: answer }); save(); log.append(el(`<div class="bubble assistant">${escapeHtml(answer)}</div>`)); log.lastChild.scrollIntoView({ block: "end" }); $("#chat-send", input).disabled = false; $("#chat-send", input).textContent = "Send"; }
  $("#chat-send", input).addEventListener("click", send); $("#chat-text", input).addEventListener("keydown", e => { if (e.key === "Enter") send(); });
  if (DB.conversations.length) { v.append(el(`<div class="group-label">Saved</div>`)); [...DB.conversations].reverse().forEach(c => { const row = el(`<div class="row"><div class="left"><span class="name">${escapeHtml(c.title || "Conversation")}</span><span class="meta">${fmtDate(c.created_at)}</span></div><button class="del">×</button></div>`); $(".left", row).addEventListener("click", () => loadConv(c.id)); $(".del", row).addEventListener("click", () => { if (confirm("Delete?")) { DB.conversations = DB.conversations.filter(x => x.id !== c.id); save(); render(); } }); v.append(row); }); }
  loadConv(state.convId);
}
function renderCoach(v) {
  v.append(el(`<div class="view-title">Coach</div>`));
  renderCoachInto(v);
}

// ============================================================================
//  HISTORY — logged decisions
// ============================================================================
function renderHistory(v) {
  v.append(el(`<div class="view-title">History</div>`));
  const ps = DB.purchases, sv = DB.saves || [];
  const all = [...ps.map(p => ({ ...p, _k: "purchase" })), ...sv.map(x => ({ ...x, _k: "save" }))]
    .sort((a, b) => { const da = a._k === "purchase" ? a.occurred_at : a.date, db = b._k === "purchase" ? b.occurred_at : b.date; return (db > da ? 1 : db < da ? -1 : 0) || b.id - a.id; });
  if (!all.length) { v.append(el(`<div class="empty">No activity yet.<br>Log a spend or a save from Home or Decide.</div>`)); return; }
  const made = ps.filter(p => p.was_made), skippedSaved = ps.filter(p => !p.was_made).reduce((s, p) => s + p.amount, 0);
  const byCat = {}; made.forEach(p => byCat[p.category] = (byCat[p.category] || 0) + p.amount);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    const max = cats[0][1];
    const wrap = el(`<div class="section"></div>`);
    cats.forEach(([cat, amt]) => wrap.append(el(`<div class="catrow"><span class="cl">${escapeHtml(cat)}</span><span class="ct"><i style="width:${(amt / max * 100).toFixed(0)}%;background:${catColor(cat)}"></i></span><span class="cv">${money0(amt)}</span></div>`)));
    v.append(collapsible("Spending by category", wrap));
  }
  if (skippedSaved > 0) v.append(el(`<div class="hero" style="padding:18px 0"><div class="label">Saved by skipping</div><div class="num up">${money0(skippedSaved)}</div></div>`));
  const actList = el(`<div></div>`);
  all.forEach(item => {
    if (item._k === "purchase") {
      const p = item, tag = p.verdict ? `<span class="tag ${p.verdict}">${p.verdict}</span>` : "";
      const row = el(`<div class="row"><div class="left"><span class="name">${escapeHtml(p.description)}${tag}</span><span class="meta">${p.category} · ${fmtDate(p.occurred_at)} · ${p.was_made ? "spent" : "skipped"}${p.to_credit > 0 ? " · " + money0(p.to_credit) + " on card" : ""}</span></div><div style="display:flex;align-items:center;gap:12px"><span class="v ${p.was_made ? "down" : "up"}">${p.was_made ? "-" : "+"}${money0(p.amount)}</span><button class="del">×</button></div></div>`);
      $(".del", row).addEventListener("click", () => {
        if (!confirm(p.was_made ? `Refund ${money(p.amount)} and remove this?` : "Remove this entry?")) return;
        if (p.was_made) revertPurchase(p); else DB.purchases = DB.purchases.filter(x => x.id !== p.id);
        save(); render();
      });
      actList.append(row);
    } else {
      const x = item;
      const row = el(`<div class="row"><div class="left"><span class="name">Saved to ${escapeHtml(x.dest || "savings")}</span><span class="meta">${fmtDate(x.date)} · moved from checking</span></div><div style="display:flex;align-items:center;gap:12px"><span class="v up">+${money0(x.amount)}</span><button class="del">×</button></div></div>`);
      $(".del", row).addEventListener("click", () => { if (!confirm("Undo this save?")) return; revertSave(x); save(); render(); });
      actList.append(row);
    }
  });
  v.append(collapsible("All activity", actList));
  v.append(el(`<div class="note">× undoes an entry and restores balances.</div>`));
}

// ============================================================================
//  MANAGE — balances, retirement, emergency, goals, details
// ============================================================================
function renderManage(v) {
  v.append(el(`<div class="view-title">Manage</div>`));
  const sv = DB.savings, p = DB.profile;

  // Accounts with type glyphs — sortable by name, amount, or category (type)
  const acctWrap = el(`<div></div>`);
  acctWrap.append(sortControl(state.acctSort || "manual", [["manual", "Default"], ["name", "Name"], ["amount", "Amount"], ["type", "Category"]], k => { state.acctSort = k; render(); }));
  let accts = [...DB.accounts];
  const signedBal = a => a.is_liability ? -a.balance : a.balance;
  if (state.acctSort === "name") accts.sort((a, b) => a.name.localeCompare(b.name));
  else if (state.acctSort === "amount") accts.sort((a, b) => signedBal(b) - signedBal(a));
  else if (state.acctSort === "type") accts.sort((a, b) => typeLabel(a.type).localeCompare(typeLabel(b.type)));
  accts.forEach(a => {
    const open = state.editAccount === a.id;
    let meta = typeLabel(a.type); if (a.is_liability && a.apr) meta += ` · ${a.apr}%`; if (a.holdings?.length) meta += ` · ${a.holdings.length} holding${a.holdings.length > 1 ? "s" : ""}`;
    const row = el(`<div class="row" data-acct="${a.id}"><div class="left edit" style="cursor:pointer;flex-direction:row;align-items:center;gap:12px"><span class="glyph">${acctGlyph(a.type)}</span><span style="display:flex;flex-direction:column"><span class="name">${escapeHtml(a.name)}</span><span class="meta">${meta}</span></span></div><div style="display:flex;align-items:center;gap:14px"><span class="v ${a.is_liability ? "down" : ""}">${a.is_liability ? "-" : ""}${money0(a.balance)}</span><button class="del">×</button></div></div>`);
    $(".edit", row).addEventListener("click", () => {
      if (open && row.nextElementSibling) { slideClose(row.nextElementSibling, () => { state.editAccount = null; render(); }); return; }
      state.editAccount = open ? null : a.id; render();
      const fresh = $(`[data-acct="${a.id}"]`, v); if (fresh?.nextElementSibling) slideOpen(fresh.nextElementSibling);
    });
    $(".del", row).addEventListener("click", () => { DB.accounts = DB.accounts.filter(x => x.id !== a.id); if (state.editAccount === a.id) state.editAccount = null; save(); render(); });
    acctWrap.append(row);
    if (open) { const wrap = el(`<div class="drop-body"></div>`); wrap.append(accountForm()); acctWrap.append(wrap); }
  });
  const addOpen = state.editAccount === "new";
  const addRow = el(`<div class="row" data-acct="new"><div class="left edit" style="cursor:pointer;flex-direction:row;align-items:center;gap:12px"><span class="glyph" style="font-size:18px">+</span><span class="name">Add account</span></div></div>`);
  $(".edit", addRow).addEventListener("click", () => {
    if (addOpen && addRow.nextElementSibling) { slideClose(addRow.nextElementSibling, () => { state.editAccount = null; render(); }); return; }
    state.editAccount = addOpen ? null : "new"; render();
    const fresh = $(`[data-acct="new"]`, v); if (fresh?.nextElementSibling) slideOpen(fresh.nextElementSibling);
  });
  acctWrap.append(addRow);
  if (addOpen) { const wrap = el(`<div class="drop-body"></div>`); wrap.append(accountForm()); acctWrap.append(wrap); }
  v.append(collapsible("Accounts", acctWrap));

  // Transfer — move cash between accounts (e.g. pay a credit card down from checking)
  if (DB.accounts.length > 1) {
    const trWrap = el(`<div class="section">
      <div class="two"><label class="field"><span>From</span><select id="tr-from">${DB.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")}</select></label><label class="field"><span>To</span><select id="tr-to">${DB.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")}</select></label></div>
      <label class="field"><span>Amount</span><input id="tr-amt" type="number" inputmode="decimal" placeholder="0" /></label>
      <button class="btn secondary" id="tr-go">Transfer</button>
    </div>`);
    v.append(collapsible("Transfer", trWrap, false));
    $("#tr-to", trWrap).selectedIndex = Math.min(1, DB.accounts.length - 1);
    $("#tr-go", trWrap).addEventListener("click", () => {
      const fromId = +$("#tr-from", trWrap).value, toId = +$("#tr-to", trWrap).value, amt = +$("#tr-amt", trWrap).value || 0;
      if (fromId === toId) { flash(trWrap, "Pick two different accounts"); return; }
      if (transferFunds(fromId, toId, amt)) render();
    });
  }

  // Retirement (Roth auto-max + 401k)
  const retWrap = el(`<div></div>`);
  const autoOn = sv.roth_auto, limit = sv.roth_limit || 7500;
  const sec = el(`<div class="section">
    <div class="row" style="border:none;padding:6px 0;cursor:pointer" id="roth-auto-row"><div class="left" style="flex-direction:row;align-items:center;gap:12px"><span class="glyph">${GLYPH.invest}</span><span class="name">Max ${new Date().getFullYear()} Roth · $${limit.toLocaleString()}</span></div><input type="checkbox" id="roth-auto" ${autoOn ? "checked" : ""} style="width:auto" /></div>
    <div class="slide-box ${autoOn ? "open" : ""}" id="roth-auto-box"><div><label class="field"><span>Roth contributed so far this year</span><input id="roth-ytd" type="number" value="${sv.roth_ytd || ""}" placeholder="0" /></label><div class="note" id="roth-calc"></div></div></div>
    <div class="slide-box ${autoOn ? "" : "open"}" id="roth-manual-box"><label class="field"><span>Roth / mo (manual)</span><input id="roth-m" type="number" value="${sv.roth_monthly || ""}" placeholder="0" /></label></div>
    <label class="field"><span>401(k) / mo</span><input id="k401-m" type="number" value="${sv.k401_monthly || ""}" placeholder="0" /></label>
    <button class="btn secondary" id="ret-save">Save</button>
  </div>`);
  retWrap.append(sec);
  v.append(collapsible("Retirement", retWrap));
  const rothCalc = () => { const ytd = +($("#roth-ytd", sec)?.value) || 0, rem = Math.max(0, limit - ytd); return `Save <b>${money0(rem / daysToTaxDay())}/day</b> to put in ${money0(rem)} more by Apr 15.`; };
  const calcEl = $("#roth-calc", sec); if (calcEl) calcEl.innerHTML = rothCalc();
  const toggleRoth = () => { const on = $("#roth-auto", sec).checked; $("#roth-auto-box", sec).classList.toggle("open", on); $("#roth-manual-box", sec).classList.toggle("open", !on); };
  $("#roth-auto-row", sec).addEventListener("click", e => { if (e.target.id !== "roth-auto") $("#roth-auto", sec).checked = !$("#roth-auto", sec).checked; toggleRoth(); });
  $("#roth-auto", sec).addEventListener("change", toggleRoth);
  $("#roth-ytd", sec)?.addEventListener("input", () => { if (calcEl) calcEl.innerHTML = rothCalc(); });
  $("#ret-save", sec).addEventListener("click", () => { const on = $("#roth-auto", sec).checked; DB.savings = { ...DB.savings, roth_auto: on, roth_ytd: on ? (+$("#roth-ytd", sec).value || 0) : sv.roth_ytd, roth_monthly: on ? sv.roth_monthly : (+$("#roth-m", sec).value || 0), k401_monthly: +$("#k401-m", sec).value || 0 }; save(); refreshNetWorth(); render(); });

  // Emergency fund — funded after retirement; target + a date to reach it
  const emgWrap = el(`<div></div>`);
  const eRemNow = Math.max(0, (sv.emergency_target || 0) - snapshot().emergency_saved);
  const emgMonths = (sv.emergency_date && daysUntil(sv.emergency_date) > 0) ? monthsUntil(sv.emergency_date) : "";
  const esec = el(`<div class="section">
    <div class="two"><label class="field"><span>Target ($)</span><input id="emg-t" type="number" inputmode="decimal" value="${sv.emergency_target || ""}" placeholder="0" /></label><label class="field"><span>Reach it in (months)</span><input id="emg-mo" type="number" inputmode="numeric" value="${emgMonths}" placeholder="12" /></label></div>
    <button class="btn secondary" id="emg-save">Save</button>
    <div class="note" id="emg-calc"></div>
  </div>`);
  emgWrap.append(esec);
  v.append(collapsible("Emergency fund", emgWrap));
  const emgCalc = () => { const t = +($("#emg-t", esec)?.value) || 0, mo = +($("#emg-mo", esec)?.value) || 0, rem = Math.max(0, t - snapshot().emergency_saved); if (t <= 0) return "Set a target and how many months to reach it."; if (rem <= 0) return "Already funded — your savings cover the target."; const days = mo > 0 ? mo * 30.44 : 365; return `Save <b>${money0(rem / days)}/day</b> toward this${mo > 0 ? " — done around " + fmtDate(isoMonthsFromNow(mo)) : " (default: 1 year)"}. Funded after your retirement each day.`; };
  const ecEl = $("#emg-calc", esec); if (ecEl) ecEl.innerHTML = emgCalc();
  $("#emg-t", esec).addEventListener("input", () => ecEl.innerHTML = emgCalc());
  $("#emg-mo", esec).addEventListener("input", () => ecEl.innerHTML = emgCalc());
  $("#emg-save", esec).addEventListener("click", () => { const mo = +$("#emg-mo", esec).value || 0; DB.savings = { ...DB.savings, emergency_target: +$("#emg-t", esec).value || 0, emergency_date: mo > 0 ? isoMonthsFromNow(mo) : "" }; save(); render(); });

  // Goals — sortable by name, amount, or priority
  const goalWrap = el(`<div></div>`);
  goalWrap.append(sortControl(state.goalSort || "manual", [["manual", "Default"], ["name", "Name"], ["amount", "Amount"], ["priority", "Priority"]], k => { state.goalSort = k; render(); }));
  let goals = [...DB.goals];
  if (state.goalSort === "name") goals.sort((a, b) => a.name.localeCompare(b.name));
  else if (state.goalSort === "amount") goals.sort((a, b) => b.target_amount - a.target_amount);
  else if (state.goalSort === "priority") goals.sort((a, b) => (a.priority || 0) - (b.priority || 0));
  goals.forEach(g => {
    const open = state.editGoal === g.id;
    const rem = Math.max(0, g.target_amount - g.current_amount), daily = g.target_date && daysUntil(g.target_date) > 0 ? rem / daysUntil(g.target_date) : (g.monthly_contribution > 0 ? g.monthly_contribution / DPM : 0);
    const row = el(`<div class="row" data-goal="${g.id}"><div class="left edit" style="cursor:pointer"><span class="name">${escapeHtml(g.name)}</span><span class="meta">${money0(g.current_amount)}/${money0(g.target_amount)}${daily > 0 ? " · " + money0(daily) + "/day" : ""}</span></div><button class="del">×</button></div>`);
    $(".edit", row).addEventListener("click", () => {
      if (open && row.nextElementSibling) { slideClose(row.nextElementSibling, () => { state.editGoal = null; render(); }); return; }
      state.editGoal = open ? null : g.id; render();
      const fresh = $(`[data-goal="${g.id}"]`, v); if (fresh?.nextElementSibling) slideOpen(fresh.nextElementSibling);
    });
    $(".del", row).addEventListener("click", () => { DB.goals = DB.goals.filter(x => x.id !== g.id); if (state.editGoal === g.id) state.editGoal = null; save(); render(); });
    goalWrap.append(row);
    if (open) {
      const gMonths = (g.target_date && daysUntil(g.target_date) > 0) ? monthsUntil(g.target_date) : "";
      const eg = el(`<div class="section" style="padding-top:10px"><label class="field"><span>Name</span><input id="eg-name" value="${escapeHtml(g.name)}" /></label><div class="two"><label class="field"><span>Target</span><input id="eg-target" type="number" value="${g.target_amount}" /></label><label class="field"><span>Saved</span><input id="eg-current" type="number" value="${g.current_amount}" /></label></div><div class="two"><label class="field"><span>Reach in (months)</span><input id="eg-mo" type="number" inputmode="numeric" placeholder="12" value="${gMonths}" /></label><label class="field"><span>or /mo</span><input id="eg-monthly" type="number" value="${g.monthly_contribution || ""}" /></label></div><div style="display:flex;gap:10px"><button class="btn small" id="eg-save" style="flex:1">Save</button><button class="btn secondary small" id="eg-cancel">Cancel</button></div></div>`);
      $("#eg-save", eg).addEventListener("click", () => { const mo = +$("#eg-mo", eg).value || 0; Object.assign(g, { name: $("#eg-name", eg).value.trim() || g.name, target_amount: +$("#eg-target", eg).value || 0, current_amount: +$("#eg-current", eg).value || 0, target_date: mo > 0 ? isoMonthsFromNow(mo) : "", monthly_contribution: +$("#eg-monthly", eg).value || 0 }); state.editGoal = null; save(); render(); });
      $("#eg-cancel", eg).addEventListener("click", () => { state.editGoal = null; render(); });
      const wrap = el(`<div class="drop-body"></div>`); wrap.append(eg); goalWrap.append(wrap);
    }
  });
  const ga = el(`<div class="section" style="margin-top:10px"><label class="field"><span>New goal</span><input id="g-name" placeholder="House down payment" /></label><div class="two"><label class="field"><span>Target</span><input id="g-target" type="number" placeholder="0" /></label><label class="field"><span>Saved</span><input id="g-current" type="number" placeholder="0" /></label></div><button class="btn secondary" id="g-add">Add goal</button></div>`);
  goalWrap.append(ga);
  $("#g-add", ga).addEventListener("click", () => { const name = $("#g-name", ga).value.trim(); if (!name) return; DB.goals.push({ id: nextId(), name, target_amount: +$("#g-target", ga).value || 0, current_amount: +$("#g-current", ga).value || 0, monthly_contribution: 0, target_date: "", priority: DB.goals.length + 1 }); save(); render(); });
  v.append(collapsible("Goals", goalWrap));

  // Details
  const det = el(`<div class="section">
    <div class="two"><label class="field"><span>Credit score</span><input id="p-credit" type="number" value="${p.credit_score || ""}" placeholder="750" /></label><label class="field"><span>Pre-tax salary</span><input id="p-pretax" type="number" value="${p.annual_salary_pretax || ""}" placeholder="0" /></label></div>
    <label class="field"><span>Priorities (coach uses these)</span><textarea id="p-pri" rows="2" placeholder="swimming, safety net, debt-free by 30">${escapeHtml(p.priorities || "")}</textarea></label>
    <label class="field"><span>Anthropic API key (optional)</span><input id="p-key" type="password" placeholder="sk-ant-…" value="${escapeHtml(p.anthropic_key || "")}" autocomplete="off" /></label>
    <label class="field"><span>Finnhub API key (optional, for live stock prices)</span><input id="p-fhkey" type="password" placeholder="free key from finnhub.io" value="${escapeHtml(p.finnhub_key || "")}" autocomplete="off" /></label>
    <button class="btn secondary" id="p-save">Save</button>
  </div>`);
  v.append(collapsible("Details", det));
  $("#p-save", det).addEventListener("click", () => { DB.profile = { ...p, credit_score: +$("#p-credit", det).value || 0, annual_salary_pretax: +$("#p-pretax", det).value || 0, priorities: $("#p-pri", det).value.trim(), anthropic_key: $("#p-key", det).value.trim(), finnhub_key: $("#p-fhkey", det).value.trim() }; save(); flash(det, "Saved"); });

  // Data
  const data = el(`<div class="section"><div class="btn-row"></div><div class="note">On this device only. Back up regularly.</div></div>`);
  const exp = el(`<button class="btn secondary">Back up</button>`), imp = el(`<button class="btn secondary">Restore</button>`), reset = el(`<button class="btn text" style="color:var(--down)">Erase all</button>`), file = el(`<input type="file" accept="application/json" style="display:none" />`);
  exp.addEventListener("click", () => download(`money-backup-${isoToday()}.json`, JSON.stringify(DB, null, 2)));
  imp.addEventListener("click", () => file.click());
  file.addEventListener("change", e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { const o = JSON.parse(rd.result); if (!o.accounts && !o.profile) throw 0; DB = migrate(o); save(); switchTab("dashboard"); } catch { alert("Not a Money backup file."); } }; rd.readAsText(f); });
  reset.addEventListener("click", () => { if (confirm("Erase ALL data? Back up first.")) { DB = blank(); save(); switchTab("dashboard"); } });
  $(".btn-row", data).append(exp, imp, reset, file);
  v.append(collapsible("Data", data));
}
function download(name, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function flash(card, msg) { const n = el(`<div class="note ok">${msg}</div>`); card.append(n); setTimeout(() => n.remove(), 1600); }

// ---------- holdings (live stock prices via Finnhub, on-demand) ----------
function holdingsValue(holdings) { return (holdings || []).reduce((s, h) => s + h.shares * (h.price || 0), 0); }
async function refreshHoldingPrices(account) {
  const key = DB.profile.finnhub_key; if (!key || !account.holdings?.length) return;
  for (const h of account.holdings) {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(h.symbol)}&token=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (res.ok && typeof data.c === "number" && data.c > 0) { h.price = data.c; h.price_at = new Date().toISOString(); }
    } catch {}
  }
  account.balance = holdingsValue(account.holdings);
  save();
}

function accountForm() {
  const editing = (state.editAccount && state.editAccount !== "new") ? DB.accounts.find(a => a.id === state.editAccount) : null;
  const e = editing || { name: "", type: "checking", balance: 0, apr: 0, principal: 0, interest_balance: 0 };
  const form = el(`<div class="section" style="margin-top:14px">
    <div class="group-label" style="margin-top:0">${editing ? "Edit account" : "Add account"}</div>
    <label class="field"><span>Name</span><input id="a-name" placeholder="Chase checking" value="${escapeHtml(e.name)}" /></label>
    <div class="two"><label class="field"><span>Type</span><select id="a-type">${ACCOUNT_TYPES.map(t => `<option value="${t[0]}" ${t[0] === e.type ? "selected" : ""}>${t[1]}</option>`).join("")}</select></label><label class="field" data-f="balance"><span>Balance</span><input id="a-bal" type="number" placeholder="0" value="${e.balance || ""}" /></label></div>
    <div class="two"><label class="field" data-f="principal"><span>Principal</span><input id="a-prin" type="number" placeholder="0" value="${e.principal || ""}" /></label><label class="field" data-f="interest"><span>Interest bal</span><input id="a-int" type="number" placeholder="0" value="${e.interest_balance || ""}" /></label></div>
    <div class="two"><label class="field" data-f="apr"><span>APR %</span><input id="a-apr" type="number" placeholder="0" value="${e.apr || ""}" /></label><label class="field" data-f="apy"><span>APY % (interest earned)</span><input id="a-apy" type="number" placeholder="0" value="${e.apy || ""}" /></label></div>
    <div class="btn-row"><button class="btn ${editing ? "" : "secondary"}" id="a-save">${editing ? "Update" : "Add account"}</button>${editing ? `<button class="btn text" id="a-cancel">Cancel</button>` : ""}</div>
  </div>`);
  const typeSel = $("#a-type", form);
  const APY_TYPES = ["checking", "savings", "brokerage"];
  const hasHoldings = editing && HOLDINGS_TYPES.includes(editing.type) && editing.holdings?.length > 0;
  const applyFields = () => { const t = typeSel.value, isLiab = LIABILITY_TYPES.includes(t), isLoan = t === "student_loan" || t === "loan"; form.querySelector('[data-f="balance"]').style.display = (isLoan || hasHoldings) ? "none" : "block"; form.querySelector('[data-f="principal"]').style.display = isLoan ? "block" : "none"; form.querySelector('[data-f="interest"]').style.display = isLoan ? "block" : "none"; form.querySelector('[data-f="apr"]').style.display = isLiab ? "block" : "none"; form.querySelector('[data-f="apy"]').style.display = APY_TYPES.includes(t) ? "block" : "none"; };
  typeSel.addEventListener("change", applyFields); applyFields();
  $("#a-save", form).addEventListener("click", () => { const name = $("#a-name", form).value.trim(); if (!name) return; const t = typeSel.value, isLiab = LIABILITY_TYPES.includes(t), isLoan = t === "student_loan" || t === "loan", apr = +$("#a-apr", form).value || 0, apy = +$("#a-apy", form).value || 0; let principal = 0, interest = 0, balance; if (isLoan) { principal = +$("#a-prin", form).value || 0; interest = +$("#a-int", form).value || 0; balance = principal + interest; } else balance = hasHoldings ? editing.balance : (+$("#a-bal", form).value || 0); const data = { name, type: t, balance, is_liability: isLiab, apr: isLiab ? apr : 0, apy: APY_TYPES.includes(t) ? apy : 0, principal: isLoan ? principal : 0, interest_balance: isLoan ? interest : 0 }; if (editing) Object.assign(editing, data); else DB.accounts.push({ id: nextId(), ...data }); state.editAccount = null; save(); render(); });
  const cancel = $("#a-cancel", form); if (cancel) cancel.addEventListener("click", () => { state.editAccount = null; render(); });

  // Holdings — track a Roth/brokerage account by ticker + shares instead of a flat balance;
  // balance becomes shares × last-fetched price (refreshed on demand via Finnhub).
  if (editing && HOLDINGS_TYPES.includes(editing.type)) {
    editing.holdings = editing.holdings || [];
    const hWrap = el(`<div class="section" style="margin-top:2px">
      <div class="group-label" style="margin-top:0">Holdings</div>
      <div id="h-list"></div>
      <div class="two"><label class="field"><span>Symbol</span><input id="h-sym" placeholder="AAPL" /></label><label class="field"><span>Shares</span><input id="h-shares" type="number" placeholder="0" /></label></div>
      <div class="btn-row"><button class="btn secondary" id="h-add">Add holding</button><button class="btn secondary" id="h-refresh">Refresh prices</button></div>
      <div class="note" id="h-note"></div>
    </div>`);
    const renderHoldings = () => {
      const list = $("#h-list", hWrap); list.innerHTML = "";
      editing.holdings.forEach((h, i) => {
        const row = el(`<div class="row"><div class="left"><span class="name">${escapeHtml(h.symbol)}</span><span class="meta">${h.shares} sh${h.price ? ` · ${money(h.price)}/sh` : " · no price yet"}</span></div><div style="display:flex;align-items:center;gap:14px"><span class="v">${money0(h.shares * (h.price || 0))}</span><button class="del">×</button></div></div>`);
        $(".del", row).addEventListener("click", () => { editing.holdings.splice(i, 1); editing.balance = holdingsValue(editing.holdings); save(); render(); });
        list.append(row);
      });
      const latest = editing.holdings.reduce((d, h) => (h.price_at && h.price_at > d) ? h.price_at : d, "");
      $("#h-note", hWrap).textContent = editing.holdings.length
        ? `Total ${money(holdingsValue(editing.holdings))}${latest ? " · priced as of " + fmtDate(latest) : " · add a Finnhub key in Details below, then refresh"}`
        : "No holdings yet — balance is entered manually above.";
    };
    $("#h-add", hWrap).addEventListener("click", () => {
      const sym = $("#h-sym", hWrap).value.trim().toUpperCase(), shares = +$("#h-shares", hWrap).value || 0;
      if (!sym || shares <= 0) return;
      editing.holdings.push({ symbol: sym, shares, price: 0, price_at: "" });
      editing.balance = holdingsValue(editing.holdings);
      save(); render();
    });
    $("#h-refresh", hWrap).addEventListener("click", async () => {
      if (!DB.profile.finnhub_key) { $("#h-note", hWrap).textContent = "Add a Finnhub API key in Details below first."; return; }
      const btn = $("#h-refresh", hWrap); btn.disabled = true; btn.textContent = "Refreshing…";
      await refreshHoldingPrices(editing);
      render();
    });
    renderHoldings();
    form.append(hWrap);
  }

  // Per-account projection: pay-off (debts) or growth (investments)
  const isInvest = ["roth", "401k", "brokerage", "savings"].includes(e.type);
  if (editing && (editing.is_liability || isInvest)) {
    const wrap = el(`<div class="section" style="margin-top:2px">
      <div class="group-label" style="margin-top:0">${editing.is_liability ? "Pay it off" : "Grow it"}</div>
      <label class="field"><span>${editing.is_liability ? "Monthly payment" : "Add per month"}: <b id="wi-val">${money0(state.whatIfMonthly)}</b></span><input id="wi-slider" type="range" min="0" max="2000" step="25" value="${state.whatIfMonthly}" /></label>
      <div id="wi-out"></div>
    </div>`);
    const recompute = () => {
      const m = +$("#wi-slider", wrap).value; state.whatIfMonthly = m; $("#wi-val", wrap).textContent = money0(m);
      const out = $("#wi-out", wrap); out.innerHTML = "";
      if (editing.is_liability) { const r = projectPayoff(editing.balance, editing.apr || 0, m); if (r.neverPays) out.append(el(`<div class="note">${money0(m)}/mo won't cover the ${money0(r.monthlyInterest)}/mo interest — pay more.</div>`)); else { const yr = Math.floor(r.months / 12), mo = r.months % 12; out.append(el(`<div class="freespend"><div class="proj-num metal">${yr ? yr + "y " : ""}${mo}mo</div><div class="proj-cap">to clear at ${money0(m)}/mo · ${money0(r.interestPaid)} interest</div></div>`)); out.append(el(`<div class="chart">${areaChart(r.series)}</div>`)); } }
      else { const r = projectGrowth(editing.balance, m, 7, 20); out.append(el(`<div class="freespend"><div class="proj-num metal">${money0(r.fv)}</div><div class="proj-cap">in 20y at 7% adding ${money0(m)}/mo · +${money0(r.growth)} growth</div></div>`)); out.append(el(`<div class="chart">${areaChart(r.yearly)}</div>`)); }
    };
    $("#wi-slider", wrap).addEventListener("input", recompute); recompute();
    form.append(wrap);
  }
  return form;
}

// ---------- projections (used by What-if slider) ----------
function projectGrowth(P, PMT, annualPct, years) { const r = annualPct / 100 / 12, n = Math.round(years * 12); let bal = P; const yearly = [P]; for (let m = 1; m <= n; m++) { bal = bal * (1 + r) + PMT; if (m % 12 === 0) yearly.push(bal); } return { fv: bal, contributed: P + PMT * n, growth: bal - (P + PMT * n), yearly }; }
function projectPayoff(principal, annualPct, payment) { const r = annualPct / 100 / 12; if (r > 0 && payment <= principal * r) return { neverPays: true, monthlyInterest: principal * r }; let bal = principal, months = 0, interestPaid = 0; const series = [principal]; while (bal > 0.005 && months < 1200) { const i = bal * r; interestPaid += i; bal = bal + i - payment; if (bal < 0) bal = 0; months++; if (months % 6 === 0 || bal === 0) series.push(bal); } return { months, interestPaid, totalPaid: principal + interestPaid, series }; }

// ---------- boot + automatic daily rollover ----------
// Recompute when the day changes — on reopen/focus, and (if left open) within a minute
// of midnight. No manual refresh needed; "today" always reflects the real date.
let _renderDay = isoToday();
function maybeRollDay() { if (isoToday() !== _renderDay) { _renderDay = isoToday(); render(); } }
document.addEventListener("visibilitychange", () => { if (!document.hidden) maybeRollDay(); });
window.addEventListener("focus", maybeRollDay);
setInterval(maybeRollDay, 60000);
injectChrome();
render();
