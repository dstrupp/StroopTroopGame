import { runAutopilot } from "./autopilot.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!process.env.COMMISH_PIN || req.headers.get("x-pin") !== process.env.COMMISH_PIN) return new Response("Commish only", { status: 403 });
  const out = await runAutopilot({ force: true });
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
};

export const config = { path: "/api/autopilot" };
