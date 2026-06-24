# Telos — architecture map (read this before grepping the whole app)

Personal finance PWA. 100% static, on-device, $0 to run. Vanilla JS, no framework, no backend.
Edit only what a task needs; this map exists so you don't re-read all of `frontend/app.js` each turn.

## Files
- `frontend/index.html` — shell: topbar (brand wordmark + net-worth pill), `#view`, bottom `.tabbar` (data-tab buttons), SW registration. Asset links carry `?v=N` (bump on every change).
- `frontend/styles.css` — full design system. CSS vars `--bg/--text/--muted/--line/--up(#2ecc71)/--down(#ff4d4d)`. Minimalist: pure black, thin lines, green/red only on +/- numbers. Components: `.hero .stats .row .field .btn .seg .cal/.cal-d/.cal-dot .glyph .catrow .chart` etc.
- `frontend/app.js` — the whole app (~700 dense lines). Sections below.
- `frontend/sw.js` — service worker, `CACHE="money-vN"` (bump with `?v=N`). stale-while-revalidate.
- `frontend/manifest.webmanifest` — PWA manifest.
- `backups/` — user's REAL financial JSON. **gitignored. never commit.**

## app.js sections (in order)
1. helpers: `$ el escapeHtml money money0 fmtDate` ; date math `isoOf clampedDate daysUntil isoMonthsFromNow monthsUntil daysBetween addDays` ; `rothMonthly daysToTaxDay`.
2. **storage**: `DB_KEY="money.db.v1"`, `blank()`, `migrate(db)` (converts old monthly-schema → events; MUST stay self-contained — can't call the `const` date helpers defined below it). `DB`, `save()`, `nextId()`.
3. **events**: `expand(ev,start,end)` (honors `ev.skip[]`), `occurrences/sumOcc/nextIncomeAfter`. recur: once|weekly|biweekly|semimonthly|monthly.
4. **engine `snapshot()`**: the core. Returns spend/save/liquid/targets/next_pay/etc. See model below.
5. `decide()` / `logPurchase()` / `logSave()`.
6. router: `state`, `switchTab`, `render()` → one render fn per tab.
7. renders: `renderDashboard renderCalendar renderDecide renderHistory renderManage` + `eventForm accountForm miniCalendar ringChart areaChart`.
8. coach: `buildSystemPrompt callClaude aiDecide renderCoachInto` (optional, needs `profile.anthropic_key`).
9. projections: `projectGrowth projectPayoff` (used by per-account what-if slider in accountForm).
10. boot + daily rollover (`maybeRollDay` on visibility/focus/60s).

## DB schema
`{ seq, accounts[], events[], goals[], purchases[], saves[], conversations[], savings{}, profile{} }`
- account: `{id,name,type,balance,is_liability,apr,principal,interest_balance,holdings[]}`. types: checking savings 401k roth brokerage other credit_card student_loan loan. `holdings` (roth/brokerage only, optional): `{symbol,shares,price,price_at}` — when present, `balance` is derived (`holdingsValue()`) from shares × last-fetched price instead of entered manually; refreshed on demand via Finnhub (`refreshHoldingPrices`, needs `profile.finnhub_key`).
- event: `{id,name,amount,kind:income|expense,flex,recur,date,day,day2,skip[],category}`.
- goal: `{id,name,target_amount,current_amount,monthly_contribution,target_date,priority}`.
- purchase: `{id,description,amount,category,is_discretionary,verdict,was_made,account_id,to_credit,occurred_at}`.
- save: `{id,amount,account_id,dest,date}`.
- savings: `{roth_auto,roth_ytd,roth_limit,roth_monthly,k401_monthly,emergency_monthly,emergency_target,emergency_date}`.
- profile: `{credit_score,priorities,anthropic_key,finnhub_key,annual_salary_pretax}`.

## Engine model (snapshot) — liquid-anchored, daily, NO calendar-month logic
- `liquid` = checking only (spendable now). `total_liquid` = checking+savings (display). savings = earmarked but accessible.
- runway = today → next income event. `freeOverRunway = liquid + winIncome − winExpenses − reserveForNext`; `freeDaily = /runwayDays`.
- `reserveForNext` = shortfall of the paycheck-after vs its own bills (handles rent-on-payday).
- daily save targets (priority: card→emergency→Roth→401k→goals), each `remaining/daysToDeadline`.
- fund fully if `ideal_daily ≤ freeDaily`; else keep ~25% of free cash for spending (never $0) and fund rest in priority; `over_allocated` + `underfunded[]` name shortfalls.
- `spend_today = freeDaily − save_today`. `spent_today/saved_today` from today's purchases/saves.
- everything recomputes from current balances each render → rollover is automatic.

## Conventions
- Bump `sw.js` CACHE + `index.html ?v=N` together on EVERY change or stale assets ship.
- No emojis. Money via `money()/money0()`. Test in preview by clearing SW caches + reload.
- Keep code dense; match surrounding one-liner style.
