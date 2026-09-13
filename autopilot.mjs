import { getStore } from "@netlify/blobs";
import { askClaude } from "./ai.mjs";
import { scoreWeek, blankWeek, fillSlate, slateComplete, slatePrompt, resultsPrompt, nextWednesdayLock, VALID_RESULTS } from "../../shared/league.mjs";

// Runs the league week: pull results → post tally → build next week's slate.
// Idempotent, so it's safe to run several times on Tuesday and to trigger by hand.
export async function runAutopilot({ force = false } = {}) {
  const store = getStore({ name: "league", consistency: "strong" });
  const log = [];
  const cfg = (await store.get("fsc:config", { type: "json" })) || { currentWeek: 1, weeks: [] };
  let week = await store.get(`fsc:week:${cfg.currentWeek}`, { type: "json" });
  if (!week) return { log: ["No current week posted – nothing to do."] };
  const auto = (await store.get("fsc:auto", { type: "json" })) || {};
  const locked = Date.now() >= new Date(week.lockAt).getTime();
  if (!locked && !force) return { log: [`Week ${week.n} hasn't locked yet – nothing to do.`] };

  // 1) Results
  if (week.games.some((g) => !g.result)) {
    try {
      const r = await askClaude(resultsPrompt(week));
      week = { ...week, games: week.games.map((g) => (!g.result && VALID_RESULTS.has(r.results?.[g.id]) ? { ...g, result: r.results[g.id] } : g)) };
      await store.setJSON(`fsc:week:${week.n}`, week);
      const left = week.games.filter((g) => !g.result).length;
      log.push(`Pulled results for week ${week.n}; ${left} game(s) still ungraded.`);
      auto.lastResults = Date.now();
    } catch (e) {
      log.push(`Results pull failed: ${e.message}`);
    }
  }

  // 2) Tally
  if (week.games.every((g) => g.result) && auto.tallied !== week.n) {
    const players = (await store.get("fsc:players", { type: "json" })) || [];
    const { blobs } = await store.list({ prefix: `fsc:picks:${week.n}:` });
    const entries = {};
    for (const b of blobs) entries[b.key.split(":")[3]] = await store.get(b.key, { type: "json" });
    const sc = (await store.get("fsc:scores", { type: "json" })) || {};
    for (const p of players) sc[p.id] = { ...(sc[p.id] || {}), [week.n]: scoreWeek(week, entries[p.id]).pts };
    await store.setJSON("fsc:scores", sc);
    auto.tallied = week.n;
    auto.talliedAt = Date.now();
    log.push(`Posted the tally for week ${week.n}.`);
  }

  // 3) Next week
  const nextN = week.n + 1;
  const nextExists = await store.get(`fsc:week:${nextN}`, { type: "json" });
  if (!nextExists && auto.tallied === week.n) {
    try {
      const s = await askClaude(slatePrompt());
      const games = fillSlate(blankWeek(nextN).games, s);
      if (slateComplete(games)) {
        const nw = { n: nextN, lockAt: nextWednesdayLock().toISOString(), games, auto: true };
        await store.setJSON(`fsc:week:${nextN}`, nw);
        const weeks = Array.from(new Set([...(cfg.weeks || []), nextN])).sort((a, b) => a - b);
        await store.setJSON("fsc:config", { ...cfg, weeks, currentWeek: nextN });
        log.push(`Built and posted week ${nextN}, locks ${nw.lockAt}.`);
      } else log.push(`Slate for week ${nextN} came back incomplete – build it by hand in Commish.`);
    } catch (e) {
      log.push(`Slate build failed: ${e.message}`);
    }
  }

  auto.lastRun = Date.now();
  auto.lastLog = log;
  await store.setJSON("fsc:auto", auto);
  return { log };
}

export default async (req) => {
  // Scheduled invocations arrive with an empty body; manual ones (from Commish) carry the PIN.
  const manual = req.headers.get("x-pin");
  if (manual && manual !== process.env.COMMISH_PIN) return new Response("Commish only", { status: 403 });
  const out = await runAutopilot({ force: !!manual });
  console.log("autopilot", out.log);
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
};

// Tuesdays 7am, 1pm and 7pm Eastern (11:00, 17:00, 23:00 UTC during daylight time).
export const config = { schedule: "0 11,17,23 * * 2" };
