import { getStore } from "@netlify/blobs";

const PROTECTED = [/^fsc:week:/, /^fsc:config$/, /^fsc:scores$/, /^fsc:auto$/];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  const store = getStore({ name: "league", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const prefix = url.searchParams.get("prefix");
    if (prefix) {
      const { blobs } = await store.list({ prefix });
      return json({ keys: blobs.map((b) => b.key) });
    }
    const keys = url.searchParams.getAll("key");
    if (!keys.length) return json({ error: "key required" }, 400);
    const out = {};
    await Promise.all(keys.map(async (k) => { out[k] = (await store.get(k, { type: "json" })) ?? null; }));
    return json(out);
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const pinOk = process.env.COMMISH_PIN && req.headers.get("x-pin") === process.env.COMMISH_PIN;

    if (body.action === "checkPin") return json({ ok: !!pinOk });

    if (body.action === "reset") {
      if (!pinOk) return json({ error: "Commish only" }, 403);
      const { blobs } = await store.list({ prefix: "fsc:" });
      await Promise.all(blobs.map((b) => store.delete(b.key)));
      return json({ ok: true, deleted: blobs.length });
    }

    if (body.action === "join") {
      const name = String(body.name || "").trim().slice(0, 24);
      if (!name) return json({ error: "name required" }, 400);
      const players = (await store.get("fsc:players", { type: "json" })) || [];
      const p = { id: Math.random().toString(36).slice(2, 9), name, emoji: String(body.emoji || "🏈").slice(0, 4), joined: Date.now() };
      players.push(p);
      await store.setJSON("fsc:players", players);
      return json({ player: p, players });
    }

    if (body.action === "picks") {
      const { weekN, playerId, entry } = body;
      if (!weekN || !playerId || !entry) return json({ error: "bad request" }, 400);
      const week = await store.get(`fsc:week:${weekN}`, { type: "json" });
      if (!week) return json({ error: "no such week" }, 404);
      if (Date.now() >= new Date(week.lockAt).getTime()) return json({ error: "Week is locked" }, 409);
      await store.setJSON(`fsc:picks:${weekN}:${playerId}`, { picks: entry.picks || {}, lock: entry.lock || null, savedAt: Date.now() });
      return json({ ok: true });
    }

    // generic set – protected keys need the Commish PIN
    const { key, value } = body;
    if (!key || value === undefined) return json({ error: "key and value required" }, 400);
    if (PROTECTED.some((re) => re.test(key)) && !pinOk) return json({ error: "Commish only" }, 403);
    if (!key.startsWith("fsc:")) return json({ error: "bad key" }, 400);
    await store.setJSON(key, value);
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/store" };
