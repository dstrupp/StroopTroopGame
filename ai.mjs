import { extractJson } from "../../shared/league.mjs";

export async function askClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
      max_tokens: 1500,
      system: "You are a sports data assistant. Use web search to find current, accurate information. Respond with ONLY a single JSON object – no prose, no markdown fences, no explanation.",
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Claude API ${res.status}`);
  const text = (data.content || []).filter((i) => i.type === "text").map((i) => i.text).join("\n");
  return extractJson(text);
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!process.env.COMMISH_PIN || req.headers.get("x-pin") !== process.env.COMMISH_PIN) return json({ error: "Commish only" }, 403);
  const { prompt } = await req.json().catch(() => ({}));
  if (!prompt) return json({ error: "prompt required" }, 400);
  try {
    return json({ result: await askClaude(prompt) });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
};

export const config = { path: "/api/ai" };
