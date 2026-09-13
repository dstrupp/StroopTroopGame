// Shared between the browser app and the Netlify functions.

export const PTS = { su: 250000, suLock: 500000, suLockMiss: -500000, spread: 750000, spreadMiss: -500000, prop: 250000, sweep: 2000000 };
export const VALID_RESULTS = new Set(["away", "home", "o0", "o1", "o2", "o3"]);
export const TZ = "America/New_York";

export const uid = () => Math.random().toString(36).slice(2, 9);

export const gameValue = (g, locked) =>
  g.type === "su" ? (locked ? PTS.suLock : PTS.su) : g.type === "spread" ? PTS.spread : g.type === "wild" ? Number(g.pts) || 0 : PTS.prop;
export const isOptional = (g) => g.type === "spread" || (g.type === "wild" && g.optional);

export function scoreWeek(week, entry) {
  if (!week || !entry) return { pts: 0, correct: 0, graded: 0, sweep: false };
  let pts = 0, correct = 0, graded = 0, suCorrect = 0, suGraded = 0;
  const games = week.games || [];
  const suTotal = games.filter((g) => g.type === "su").length;
  for (const g of games) {
    if (!g.result) continue;
    const pick = entry.picks?.[g.id];
    if (isOptional(g) && !pick) continue;
    graded++;
    if (g.type === "su") suGraded++;
    const locked = entry.lock === g.id;
    if (pick && pick === g.result) {
      pts += gameValue(g, locked);
      correct++;
      if (g.type === "su") suCorrect++;
    } else if (g.type === "spread") pts += PTS.spreadMiss;
    else if (g.type === "wild") pts -= Number(g.miss) || 0;
    else if (locked) pts += PTS.suLockMiss;
  }
  const sweep = suTotal > 0 && suGraded === suTotal && suCorrect === suTotal;
  if (sweep) pts += PTS.sweep;
  return { pts, correct, graded, sweep };
}

// ── Eastern-time helpers (the server runs in UTC) ──
function tzOffsetMs(date, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}
export function etParts(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, dow };
}
export function etToUtc(y, m, d, h = 0, min = 0) {
  const naive = new Date(Date.UTC(y, m - 1, d, h, min));
  let out = new Date(naive.getTime() - tzOffsetMs(naive, TZ));
  const off2 = tzOffsetMs(out, TZ);
  return new Date(naive.getTime() - off2);
}
// Next Wednesday at 12:00 noon Eastern, strictly after `from`.
export function nextWednesdayLock(from = new Date()) {
  const { y, m, d, dow } = etParts(from);
  let add = (3 - dow + 7) % 7;
  let cand = etToUtc(y, m, d + add, 12, 0);
  if (cand.getTime() <= from.getTime()) cand = etToUtc(y, m, d + add + 7, 12, 0);
  return cand;
}

export function blankWeek(n, lockAt) {
  return {
    n,
    lockAt,
    games: [
      ...[1, 2, 3, 4, 5].map(() => ({ id: uid(), league: "NFL", type: "su", away: "", home: "", result: null })),
      ...[1, 2, 3, 4, 5].map(() => ({ id: uid(), league: "CFB", type: "su", away: "", home: "", result: null })),
      { id: uid(), league: "NFL", type: "spread", away: "", home: "", fav: "home", line: "3.5", result: null },
      { id: uid(), league: "CFB", type: "spread", away: "", home: "", fav: "home", line: "7.5", result: null },
      { id: uid(), league: "ALL", type: "prop", title: "Most passing yards this weekend", options: ["", "", ""], result: null },
    ],
  };
}

export function fillSlate(gamesIn, s) {
  const games = gamesIn.map((g) => ({ ...g }));
  const fill = (list, data) =>
    list.forEach((g, i) => {
      if (data?.[i]) {
        g.away = data[i].away || "";
        g.home = data[i].home || "";
      }
    });
  fill(games.filter((g) => g.league === "NFL" && g.type === "su"), s.nfl);
  fill(games.filter((g) => g.league === "CFB" && g.type === "su"), s.cfb);
  const sp = (lg, d) => {
    const g = games.find((x) => x.league === lg && x.type === "spread");
    if (g && d) Object.assign(g, { away: d.away || "", home: d.home || "", fav: d.fav === "away" ? "away" : "home", line: String(d.line || g.line) });
  };
  sp("NFL", s.nflSpread);
  sp("CFB", s.cfbSpread);
  const pr = games.find((x) => x.type === "prop");
  if (pr && s.showdown) {
    pr.title = s.showdown.title || pr.title;
    pr.options = [0, 1, 2].map((i) => s.showdown.options?.[i] || "");
  }
  return games;
}

export const slateComplete = (games) =>
  games.every((g) => (g.type === "prop" || g.type === "wild" ? g.title && g.options.every((o) => o && o.trim()) : g.away && g.home));

export const slatePrompt = () =>
  `Today is ${new Date().toDateString()}. For the upcoming weekend of NFL and college football (the next games to be played, roughly Wednesday through Monday), find: the 5 most marquee NFL matchups and the 5 most marquee college football matchups (biggest games by rankings, rivalry and national interest), one NFL game and one college game with a well-known point spread, and 3 star NFL quarterbacks playing this weekend for a "most passing yards" showdown. Use short common team names (e.g. "49ers", "Ohio State"). Return exactly this JSON shape: {"nfl":[{"away":"","home":""}],"cfb":[{"away":"","home":""}],"nflSpread":{"away":"","home":"","fav":"home","line":"3.5"},"cfbSpread":{"away":"","home":"","fav":"home","line":"7.5"},"showdown":{"title":"Most passing yards this weekend","options":["","",""]}}. "fav" must be "home" or "away"; "line" is a positive number as a string.`;

export const resultsPrompt = (week) => {
  const list = week.games
    .map((g) =>
      g.type === "prop" || g.type === "wild"
        ? `${g.id}: ${g.type === "wild" ? "CHALLENGE" : "SHOWDOWN"} "${g.title}" – options ${g.options.map((o, i) => `o${i}=${o}`).join(", ")}`
        : `${g.id}: ${g.league} ${g.away} (away) at ${g.home} (home)${g.type === "spread" ? ` – spread: ${g.fav === "home" ? g.home : g.away} favored by ${g.line}; answer who COVERED` : " – answer who WON"}`
    )
    .join("\n");
  return `Today is ${new Date().toDateString()}. Look up the final scores and stats for these games from the most recent weekend and tell me the result of each. For "won" games answer "away" or "home". For spread games answer which side covered ("away" or "home"). For the showdown or any challenge answer "o0", "o1", "o2" or "o3" for whichever option came true. If a game has not finished yet, answer null. Games:\n${list}\nReturn exactly: {"results":{"<id>":"home"}} with one entry per id.`;
};

// Parse the JSON object out of a Claude reply
export function extractJson(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < 0) throw new Error("No JSON in reply");
  return JSON.parse(text.slice(s, e + 1));
}
