# Stroop Troop Pick'em

All files live at the top level of the repo (GitHub's web uploader flattens folders).
`setup.mjs` runs as the Netlify build step and lays them out into `public/`, `shared/` and `netlify/functions/`.

Netlify environment variables: `ANTHROPIC_API_KEY`, `COMMISH_PIN`.
Autopilot runs Tuesdays 7am / 1pm / 7pm Eastern (see autopilot.mjs).
To change the app: edit app.jsx, run `npm run bundle` to regenerate app.js, upload both.
