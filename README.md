# Stroop Troop Pick'em

Family NFL + college football pick'em. Static React front end + three Netlify Functions
(key-value store on Netlify Blobs, a Claude web-search helper, and a Tuesday autopilot cron).

## Deploy (one time, ~15 minutes)

1. **GitHub** – create a new private repo and upload this folder (everything except `node_modules`).
2. **Netlify** – Add new site → Import an existing project → pick the repo.
   Build command and publish folder are read from `netlify.toml`; leave the defaults.
3. **Environment variables** (Site configuration → Environment variables):
   - `ANTHROPIC_API_KEY` – from console.anthropic.com. Pays for the results/slate lookups (pennies a week).
   - `COMMISH_PIN` – the PIN you'll type in the Commish tab. Anything 4+ characters.
4. Deploy. Your site is live at `https://<name>.netlify.app` – rename it under Site configuration → Site details.
5. Open the site, Enlist, go to Commish, enter your PIN, **Build week 1** → **Fill the slate for me** → check it → **Post week 1**.
6. Text the link to the family.

## Weekly (automatic)

`netlify/functions/autopilot.mjs` runs Tuesdays at 7am / 1pm / 7pm Eastern:
pulls results → posts the tally → builds next week's slate with a Wednesday-noon lock.
The Commish tab has a **Run autopilot now** button and a log of the last run.

## Local development

```
npm install
npm run build          # bundles src/app.jsx → public/app.js
npx netlify dev        # serves site + functions at http://localhost:8888 (needs Netlify CLI, logged in)
```

## Layout

- `src/app.jsx` – the React app (bundled to `public/app.js`)
- `shared/league.mjs` – scoring rules, prompts, slate helpers (shared by browser and functions)
- `netlify/functions/store.mjs` – `/api/store` key-value API (Commish PIN required for weeks/config/scores)
- `netlify/functions/ai.mjs` – `/api/ai` Claude + web search (Commish only)
- `netlify/functions/autopilot.mjs` – scheduled Tuesday job; `run-autopilot.mjs` exposes `/api/autopilot` for the button
