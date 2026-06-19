# Telos

A private, $0-to-run personal-finance PWA. Everything runs on your device (localStorage); no server, no accounts, works offline on Wi-Fi/5G/airplane mode. Your data never leaves your phone. See `CLAUDE.md` for the architecture.

## Run locally
```
python -m http.server 8000 --directory frontend
```
Open http://localhost:8000 (or double-click `run.bat`).

## Put it on your phone
Host `frontend/` on any free static host (Netlify, Cloudflare Pages, GitHub Pages), then iPhone Safari → Share → **Add to Home Screen**. It runs full-screen like a native app and persists data on-device.

**Back up regularly:** Manage → Data → Back up. iOS can evict a web app's storage after ~2 weeks unused.

---

## Change the app from your phone (GitHub → Claude → auto-deploy)

One-time setup (from a computer, once):

1. **Create a private GitHub repo** and push this folder (`.gitignore` excludes `backups/`, but keep it private):
   ```
   git remote add origin https://github.com/<you>/telos.git
   git push -u origin main
   ```
2. **Install the Claude GitHub app** on the repo: https://github.com/apps/claude → Install → select this repo.
3. **Add your API key as a secret:** repo → Settings → Secrets and variables → Actions → New repository secret → name `ANTHROPIC_API_KEY`, value from https://console.anthropic.com.
4. **Turn on GitHub Pages:** repo → Settings → Pages → Build and deployment → Source = **GitHub Actions**. The included `.github/workflows/deploy.yml` publishes `frontend/` on every push to `main`. Your site lives at `https://<you>.github.io/telos/`.
5. Add that URL to your phone Home Screen.

Daily loop (from the GitHub mobile app on your phone):

1. Open an **Issue** (or comment on a PR): `@claude add an APY field to savings accounts and show projected interest`.
2. Claude opens a **pull request** with the change.
3. Review and **merge** it on your phone.
4. Pages redeploys in ~1 min → reopen Telos to test.

> Each `@claude` run uses your Anthropic API key (a few cents per change). `.github/workflows/claude.yml` (the bot) and `.github/workflows/deploy.yml` (Pages) are already set up.

---

## How it works
- **Manage** — your accounts, retirement, emergency target, goals, details.
- **Calendar** — every paycheck/bill/one-off as a recurring or one-time event; the source of truth for cashflow.
- **Home** — net worth, today's spend & save (computed live from current cash + upcoming events), goals, what's coming.
- **Decide** — type a purchase → YES/CAUTION/VETO against your runway to the next paycheck; log it.
- **History** — every logged decision + saved-by-skipping.
- **Coach** — optional AI (your Anthropic key) that knows your full picture.

The verdict + daily math are pure arithmetic in `frontend/app.js` — no AI, no internet, no cost. (`backend/` is a legacy server version, unused.)
