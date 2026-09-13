import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { PTS, scoreWeek, isOptional, blankWeek, fillSlate, slatePrompt, resultsPrompt, nextWednesdayLock, VALID_RESULTS, uid } from "./league.mjs";

const EMOJIS = ["🏈", "🔥", "🐐", "👑", "🎯", "🦄", "💎", "🚀", "🍀", "🎰", "🦁", "🍕"];
const RANK_TITLES = ["Troop Commander", "Second in Command", "Sergeant Sure Thing", "Corporal Coin-Flip", "Private Parlay", "Cadet", "Recruit", "Water Boy"];
const HYPE = ["Picks saved. Salute! 🫡", "Locked and loaded. 🎯", "The Troop thanks you. 🏈", "Bold. Very bold. 🔥", "Saved. Now go trash talk. 📣", "Picks in. Sunday can't come fast enough. ⏱️"];
const SMACK = [
  "Somebody's mom might be in first place. Just saying.",
  "Points don't lie. Excuses do.",
  "Every dynasty starts with one good Sunday.",
  "The lock button is not for the faint of heart.",
  "Water Boy is a title, not a life sentence.",
  "Commander today. Cadet tomorrow. That's football.",
];
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmt = (n) => (n || 0).toLocaleString();
const short = (n) => {
  const a = Math.abs(n || 0);
  const s = n < 0 ? "-" : "";
  if (a >= 1e6) return s + (a / 1e6).toFixed(a % 1e6 ? 2 : 0).replace(/\.?0+$/, "") + "M";
  if (a >= 1e3) return s + Math.round(a / 1e3) + "K";
  return s + a;
};

// ───────────────────────── API helpers ─────────────────────────
async function api(path, body, pin) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...(pin ? { "x-pin": pin } : {}) }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
async function sget(...keys) {
  const qs = keys.map((k) => "key=" + encodeURIComponent(k)).join("&");
  const res = await fetch(`/api/store?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error("load failed");
  const data = await res.json();
  return keys.length === 1 ? data[keys[0]] : data;
}
async function slist(prefix) {
  const res = await fetch(`/api/store?prefix=${encodeURIComponent(prefix)}`, { cache: "no-store" });
  return (await res.json()).keys || [];
}
const sset = (key, value, pin) => api("/api/store", { key, value }, pin);
const checkPin = async (pin) => (await api("/api/store", { action: "checkPin" }, pin)).ok;
const askClaude = async (prompt, pin) => (await api("/api/ai", { prompt }, pin)).result;
const runAutopilot = (pin) => api("/api/autopilot", {}, pin);
const local = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => ({
        l: Math.random() * 100, d: 1.6 + Math.random() * 1.4, w: 6 + Math.random() * 8,
        c: ["#FFB703", "#FF3D7F", "#F5F2EA", "#1F7A4D", "#4CC9F0"][i % 5], r: Math.random() * 360, s: Math.random() * 0.6,
      })),
    []
  );
  return (
    <div className="fsc-confetti">
      {bits.map((b, i) => (
        <span key={i} style={{ left: `${b.l}%`, width: b.w, height: b.w * 0.45, background: b.c, animationDuration: `${b.d}s`, animationDelay: `${b.s}s`, transform: `rotate(${b.r}deg)` }} />
      ))}
    </div>
  );
}

function CountUp({ value }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const start = shown, end = value, t0 = performance.now(), dur = 900;
    if (start === end) return;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (end - start) * e));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{fmt(shown)}</>;
}

// ───────────────────────── small UI bits ─────────────────────────
function Choice({ options, value, onPick, disabled, result }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map((o) => {
        const chosen = value === o.id;
        const won = result && result === o.id;
        const lost = result && chosen && result !== o.id;
        return (
          <button
            key={o.id}
            disabled={disabled}
            onClick={() => onPick(o.id)}
            className={`fsc-choice ${chosen ? "on" : ""} ${won ? "won" : ""} ${lost ? "lost" : ""}`}
          >
            <span className="block text-base leading-tight">{o.label}</span>
            {o.sub && <span className="block text-xs opacity-80 mt-1">{o.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, tag, children }) {
  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-2 px-1">
        <h2 className="fsc-h2">{title}</h2>
        {tag && <span className="fsc-tag">{tag}</span>}
      </div>
      {children}
    </div>
  );
}

// ───────────────────────── main app ─────────────────────────
function App() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [me, setMe] = useState(null);
  const [players, setPlayers] = useState([]);
  const [config, setConfig] = useState({ currentWeek: 1, weeks: [] });
  const [week, setWeek] = useState(null);
  const [weekPicks, setWeekPicks] = useState({});
  const [scores, setScores] = useState({});
  const [auto, setAuto] = useState({});
  const [tab, setTab] = useState("picks");
  const [toast, setToast] = useState("");
  const [party, setParty] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pin, setPinState] = useState(() => sessionStorage.getItem("fsc:pin") || "");
  const setPin = (p) => { sessionStorage.setItem("fsc:pin", p); setPinState(p); };

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2500); };
  const celebrate = () => { setParty(true); setTimeout(() => setParty(false), 3200); };

  async function loadAll() {
    setLoading(true);
    setErr("");
    try {
      const d = await sget("fsc:players", "fsc:config", "fsc:scores", "fsc:auto");
      const c = d["fsc:config"] || { currentWeek: 1, weeks: [] };
      setConfig(c);
      setPlayers(d["fsc:players"] || []);
      setScores(d["fsc:scores"] || {});
      setAuto(d["fsc:auto"] || {});
      const meId = local.get("fsc:me");
      setMe((d["fsc:players"] || []).find((p) => p.id === meId) || null);
      await loadWeek(c.currentWeek);
    } catch (e) {
      setErr("Couldn't reach the league. Check your connection and tap Reload.");
    }
    setLoading(false);
  }

  async function loadWeek(n) {
    if (n === undefined) {
      const d = await sget("fsc:config", "fsc:scores", "fsc:auto");
      const c = d["fsc:config"] || config;
      setConfig(c);
      setScores(d["fsc:scores"] || {});
      setAuto(d["fsc:auto"] || {});
      n = c.currentWeek || 1;
    }
    const w = await sget(`fsc:week:${n}`);
    setWeek(w);
    const keys = await slist(`fsc:picks:${n}:`);
    const entries = keys.length ? await sget(...keys) : {};
    const byPlayer = {};
    if (keys.length === 1) byPlayer[keys[0].split(":")[3]] = entries;
    else for (const k of keys) if (entries[k]) byPlayer[k.split(":")[3]] = entries[k];
    setWeekPicks(byPlayer);
  }

  useEffect(() => { loadAll(); }, []);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && !loading) loadWeek(config.currentWeek).catch(() => {}); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [config.currentWeek, loading]);

  const locked = week?.lockAt ? now >= new Date(week.lockAt).getTime() : false;
  const myEntry = me ? weekPicks[me.id] : null;

  const totals = useMemo(() => {
    const t = {};
    for (const p of players) t[p.id] = Object.values(scores[p.id] || {}).reduce((a, b) => a + b, 0);
    return t;
  }, [players, scores]);
  const liveWeek = useMemo(() => {
    const t = {};
    for (const p of players) t[p.id] = scoreWeek(week, weekPicks[p.id]);
    return t;
  }, [players, week, weekPicks]);

  async function join(name, emoji) {
    const r = await api("/api/store", { action: "join", name, emoji });
    setPlayers(r.players);
    local.set("fsc:me", r.player.id);
    setMe(r.player);
    flash(`Welcome to the Troop, ${r.player.name}. 🫡`);
    celebrate();
  }
  function claim(p) { local.set("fsc:me", p.id); setMe(p); }

  async function savePicks(picks, lock) {
    if (!me || !week) return;
    try {
      await api("/api/store", { action: "picks", weekN: week.n, playerId: me.id, entry: { picks, lock } });
      setWeekPicks({ ...weekPicks, [me.id]: { picks, lock: lock || null, savedAt: Date.now() } });
      flash(pickOne(HYPE));
      celebrate();
    } catch (e) {
      flash(e.message === "Week is locked" ? "Too late – this week is locked 🔒" : "Save failed – try again");
    }
  }

  async function saveWeek(w) {
    await sset(`fsc:week:${w.n}`, w, pin);
    const weeks = Array.from(new Set([...(config.weeks || []), w.n])).sort((a, b) => a - b);
    const c = { ...config, weeks, currentWeek: w.n };
    await sset("fsc:config", c, pin);
    setConfig(c);
    setWeek(w);
    await loadWeek(w.n);
  }
  async function postTally() {
    if (!week) return;
    const sc = (await sget("fsc:scores")) || {};
    for (const p of players) sc[p.id] = { ...(sc[p.id] || {}), [week.n]: scoreWeek(week, weekPicks[p.id]).pts };
    await sset("fsc:scores", sc, pin);
    setScores(sc);
    flash(`Week ${week.n} tally posted.`);
    celebrate();
  }
  async function resetLeague() {
    await api("/api/store", { action: "reset" }, pin);
    local.set("fsc:me", null);
    await loadAll();
  }

  if (loading) return <Shell><p className="text-center py-20 opacity-70">Rallying the Troop…</p></Shell>;
  if (err) return <Shell><p className="text-center py-16 px-4">{err}</p><div className="px-4"><button className="fsc-btn w-full" onClick={loadAll}>Reload</button></div></Shell>;
  if (!me) return <Shell><Join players={players} onJoin={join} onClaim={claim} /></Shell>;

  return (
    <Shell>
      <header className="fsc-board">
        <div className="fsc-marquee"><span>STROOP TROOP</span><span>PICK'EM</span><span>2026</span></div>
        <div className="flex justify-between items-start mt-2">
          <div>
            <div className="text-sm opacity-80">{me.emoji} {me.name}</div>
            <div className="fsc-score"><CountUp value={totals[me.id] + (liveWeek[me.id]?.pts || 0) - (scores[me.id]?.[week?.n] || 0)} /></div>
            <div className="text-xs opacity-70">points, season to date</div>
          </div>
          <div className="text-right text-xs pt-1">
            {week ? (
              <>
                <div className="font-bold text-sm">Week {week.n}</div>
                <div className="opacity-80">{locked ? "Picks are locked 🔒" : `Lock: ${new Date(week.lockAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`}</div>
              </>
            ) : (
              <div className="opacity-80">No week posted yet</div>
            )}
          </div>
        </div>
      </header>
      <div className="fsc-bunting" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <span key={i} />)}</div>
      {party && <Confetti />}

      <nav className="fsc-tabs">
        {[["picks", "Picks"], ["board", "Board"], ["commish", "Commish"]].map(([k, l]) => (
          <button key={k} className={`fsc-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>

      <main className="px-3 pb-24">
        {tab === "picks" && <Picks week={week} entry={myEntry} locked={locked} onSave={savePicks} live={liveWeek[me.id]} />}
        {tab === "board" && <Board players={players} totals={totals} scores={scores} live={liveWeek} week={week} weekPicks={weekPicks} locked={locked} meId={me.id} onSwitch={() => setMe(null)} />}
        {tab === "commish" && (
          <Commish config={config} week={week} players={players} onSaveWeek={saveWeek} onPostTally={postTally} onReset={resetLeague} onLoadWeek={loadWeek} flash={flash} pin={pin} setPin={setPin} auto={auto} />
        )}
      </main>

      {toast && <div className="fsc-toast">{toast}</div>}
    </Shell>
  );
}

createRoot(document.getElementById("root")).render(<App />);

// ───────────────────────── shell + styles ─────────────────────────
function Shell({ children }) {
  return (
    <div className="fsc-root">
      <style>{`
        .fsc-root{--navy:#14213D;--ink:#0D1730;--gold:#FFB703;--pink:#FF3D7F;--chalk:#F5F2EA;--turf:#1F7A4D;--flag:#E63946;
          background:var(--navy) repeating-linear-gradient(0deg,transparent 0 44px,rgba(245,242,234,.05) 44px 46px);color:var(--chalk);min-height:100vh;font-family:'Archivo',system-ui,sans-serif;max-width:520px;margin:0 auto;position:relative;overflow-x:hidden}
        .fsc-marquee{display:flex;justify-content:space-between;font-family:'Archivo Black',sans-serif;font-size:12px;letter-spacing:2px;color:var(--ink);background:var(--gold);margin:-16px -14px 0;padding:6px 14px;
          background-image:radial-gradient(circle,rgba(255,255,255,.9) 1.2px,transparent 1.6px);background-size:14px 14px;background-position:0 0}
        .fsc-marquee span{background:var(--gold);padding:0 6px;animation:fsc-blink 1.6s steps(2) infinite}
        .fsc-marquee span:nth-child(2){animation-delay:.5s}.fsc-marquee span:nth-child(3){animation-delay:1s}
        @keyframes fsc-blink{50%{color:var(--pink)}}
        .fsc-bunting{display:flex;justify-content:space-between;padding:0 4px;height:14px;overflow:hidden}
        .fsc-bunting span{width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;border-top:14px solid var(--pink)}
        .fsc-bunting span:nth-child(odd){border-top-color:var(--gold)}
        .fsc-confetti{position:fixed;inset:0;pointer-events:none;z-index:30;overflow:hidden}
        .fsc-confetti span{position:absolute;top:-20px;border-radius:2px;animation:fsc-fall linear forwards}
        @keyframes fsc-fall{to{transform:translateY(110vh) rotate(720deg);opacity:.2}}
        .fsc-crown{display:inline-block;animation:fsc-bob 1.4s ease-in-out infinite}
        @keyframes fsc-bob{50%{transform:translateY(-3px) rotate(-8deg)}}
        .fsc-smack{font-style:italic;text-align:center;font-size:13px;color:var(--gold);padding:6px 12px 10px}
        @media (prefers-reduced-motion:reduce){.fsc-marquee span,.fsc-crown,.fsc-confetti span{animation:none}}
        .fsc-board{background:var(--ink);padding:16px 14px 12px;border-bottom:4px solid var(--gold)}
        .fsc-score{font-family:'Archivo Black',sans-serif;font-size:44px;line-height:1;color:var(--gold);letter-spacing:-1px;margin:4px 0 2px;font-variant-numeric:tabular-nums}
        .fsc-h1{font-family:'Archivo Black',sans-serif;font-size:30px;line-height:1.05;color:var(--gold)}
        .fsc-h2{font-family:'Archivo Black',sans-serif;font-size:17px;color:var(--chalk)}
        .fsc-tag{font-size:12px;font-weight:700;color:var(--gold)}
        .fsc-tabs{display:flex;background:var(--ink);border-bottom:1px solid rgba(255,255,255,.12);position:sticky;top:0;z-index:5}
        .fsc-tab{flex:1;padding:12px 0;font-weight:700;color:rgba(245,242,234,.6);background:none;border:0;border-bottom:3px solid transparent;font-size:15px}
        .fsc-tab.on{color:var(--gold);border-bottom-color:var(--gold)}
        .fsc-card{background:rgba(255,255,255,.06);border-radius:14px;padding:12px;margin-bottom:10px}
        .fsc-choice{padding:14px 8px;border-radius:12px;background:rgba(255,255,255,.08);color:var(--chalk);font-weight:700;border:2px solid transparent;min-height:60px}
        .fsc-choice.on{background:var(--gold);color:var(--ink);border-color:var(--gold)}
        .fsc-choice.won{border-color:var(--turf);box-shadow:inset 0 0 0 2px var(--turf)}
        .fsc-choice.won.on{background:var(--turf);color:#fff}
        .fsc-choice.lost{background:var(--flag);color:#fff;border-color:var(--flag)}
        .fsc-choice:disabled{opacity:.9}
        .fsc-btn{background:var(--gold);color:var(--ink);font-weight:800;border:0;border-radius:12px;padding:14px 18px;font-size:16px}
        .fsc-btn.pink{background:var(--pink);color:#fff}
        .fsc-btn.ghost{background:rgba(255,255,255,.1);color:var(--chalk)}
        .fsc-btn:disabled{opacity:.5}
        .fsc-input{width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:11px 12px;color:var(--chalk);font-size:16px}
        .fsc-input::placeholder{color:rgba(245,242,234,.45)}
        .fsc-lock{font-size:12px;font-weight:700;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.1);color:var(--chalk);border:0}
        .fsc-lock.on{background:var(--pink);color:#fff}
        .fsc-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--gold);color:var(--ink);font-weight:800;padding:12px 18px;border-radius:999px;z-index:20;box-shadow:0 8px 24px rgba(0,0,0,.4);white-space:nowrap}
        .fsc-row{display:flex;align-items:center;gap:10px;padding:12px 10px;border-radius:12px;margin-bottom:6px;background:rgba(255,255,255,.06)}
        .fsc-row.first{background:var(--gold);color:var(--ink)}
        .fsc-row.me{outline:2px solid var(--pink)}
        .fsc-rank{font-family:'Archivo Black',sans-serif;font-size:22px;width:34px;text-align:center}
        .fsc-pts{font-family:'Archivo Black',sans-serif;font-size:18px;font-variant-numeric:tabular-nums}
        .fsc-root button{cursor:pointer}
        .fsc-root button:focus-visible,.fsc-root input:focus-visible,.fsc-root select:focus-visible{outline:3px solid var(--pink);outline-offset:2px}
        select.fsc-input option{color:#000}
      `}</style>
      {children}
    </div>
  );
}

// ───────────────────────── join screen ─────────────────────────
function Join({ players, onJoin, onClaim }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [busy, setBusy] = useState(false);
  return (
    <div className="px-4 py-8">
      <div className="fsc-marquee" style={{ margin: "0 0 18px", borderRadius: 8 }}><span>STROOP TROOP</span><span>PICK'EM</span><span>2026</span></div>
      <h1 className="fsc-h1 mb-1">Enlist in the Stroop Troop</h1>
      <p className="opacity-80 mb-6">Pick winners. Rack up millions. Earn the title Troop Commander – or Water Boy.</p>

      {players.length > 0 && (
        <div className="mb-8">
          <h2 className="fsc-h2 mb-2">Already in the league? Tap your name</h2>
          <div className="grid grid-cols-2 gap-2">
            {players.map((p) => (
              <button key={p.id} className="fsc-btn ghost text-left" onClick={() => onClaim(p)}>{p.emoji} {p.name}</button>
            ))}
          </div>
        </div>
      )}

      <h2 className="fsc-h2 mb-2">New here? Pick your game name</h2>
      <input className="fsc-input mb-3" placeholder="DJ Jazzy, Queen of Sundays, Touchdown Tina…" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
      <div className="flex flex-wrap gap-2 mb-4">
        {EMOJIS.map((e) => (
          <button key={e} onClick={() => setEmoji(e)} className="text-2xl w-11 h-11 rounded-xl" style={{ background: emoji === e ? "var(--gold)" : "rgba(255,255,255,.08)" }}>{e}</button>
        ))}
      </div>
      <button
        className="fsc-btn w-full"
        disabled={!name.trim() || busy}
        onClick={async () => {
          setBusy(true);
          await onJoin(name, emoji);
          setBusy(false);
        }}
      >
        Enlist
      </button>
      <p className="text-xs opacity-60 mt-6">Your name is saved on this device – the whole Troop sees the same board.</p>
    </div>
  );
}

// ───────────────────────── picks tab ─────────────────────────
function Picks({ week, entry, locked, onSave, live }) {
  const [picks, setPicks] = useState(entry?.picks || {});
  const [lock, setLock] = useState(entry?.lock || null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPicks(entry?.picks || {});
    setLock(entry?.lock || null);
  }, [entry, week?.n]);

  if (!week || !week.games?.length)
    return <div className="fsc-card text-center py-10">No games posted yet. The Commish sets the slate under the Commish tab.</div>;

  const groups = [
    ["NFL – pick the winner", week.games.filter((g) => g.league === "NFL" && g.type === "su"), `${short(PTS.su)} each`],
    ["College – pick the winner", week.games.filter((g) => g.league === "CFB" && g.type === "su"), `${short(PTS.su)} each`],
    ["Feeling frisky? Beat the spread", week.games.filter((g) => g.type === "spread"), `optional · win ${short(PTS.spread)} / lose ${short(PTS.spreadMiss)}`],
    ["Player showdown", week.games.filter((g) => g.type === "prop"), `${short(PTS.prop)}`],
    ["Wildcard challenges", week.games.filter((g) => g.type === "wild"), "anything goes"],
  ];
  const required = week.games.filter((g) => !isOptional(g));
  const made = required.filter((g) => picks[g.id]).length;
  const togglePick = (g, v) => {
    const next = { ...picks };
    if (next[g.id] === v) delete next[g.id];
    else next[g.id] = v;
    setPicks(next);
  };
  const optionsFor = (g) => {
    if (g.type === "prop" || g.type === "wild") return g.options.map((o, i) => ({ id: `o${i}`, label: o }));
    if (g.type === "spread") {
      const favAway = g.fav === "away";
      return [
        { id: "away", label: g.away, sub: favAway ? `−${g.line}` : `+${g.line}` },
        { id: "home", label: g.home, sub: favAway ? `+${g.line}` : `−${g.line}` },
      ];
    }
    return [{ id: "away", label: g.away, sub: "away" }, { id: "home", label: g.home, sub: "home" }];
  };

  return (
    <div className="pt-4">
      {locked ? (
        <div className="fsc-card mb-4" style={{ background: "rgba(255,183,3,.15)" }}>
          <div className="font-bold">Week {week.n} is locked. No takebacks. 🔒</div>
          <div className="text-sm opacity-80">This week so far: <b>{fmt(live?.pts)}</b> points · {live?.correct}/{live?.graded} right{live?.sweep ? " · CLEAN SWEEP 🧹 +2M" : ""}</div>
        </div>
      ) : (
        <div className="fsc-card mb-4 text-sm opacity-90">
          Tap a team to pick it. The 10 winner picks and the showdown are required. Want to supersize? Tap <b>Lock 🔒</b> on your surest winner pick – it pays {short(PTS.suLock)} instead of {short(PTS.su)}, but costs you {short(PTS.suLock)} if it misses. Spread bets are optional: skip them, or go for it and win {short(PTS.spread)} / lose {short(PTS.spreadMiss)}. Save before the lock time – you can change your mind until then.
        </div>
      )}

      {groups.map(([title, games, tag]) =>
        games.length ? (
          <Section key={title} title={title} tag={tag}>
            {games.map((g) => (
              <div key={g.id} className="fsc-card">
                {(g.type === "prop" || g.type === "wild") && <div className="text-sm font-semibold mb-1">{g.title}</div>}
                {g.type === "wild" && <div className="text-xs mb-2" style={{ color: "var(--gold)" }}>Win {short(Number(g.pts))}{Number(g.miss) ? ` · lose ${short(Number(g.miss))}` : ""}{g.optional ? " · optional" : " · required"}</div>}
                {g.type !== "prop" && g.type !== "wild" && g.note && <div className="text-xs opacity-70 mb-2">{g.note}</div>}
                <Choice options={optionsFor(g)} value={picks[g.id]} result={g.result} disabled={locked} onPick={(v) => togglePick(g, v)} />
                {isOptional(g) && !locked && <div className="text-xs opacity-60 mt-2 text-right">{picks[g.id] ? "You're in – tap again to pass" : "Sitting this one out"}</div>}
                {isOptional(g) && locked && !entry?.picks?.[g.id] && <div className="text-xs opacity-60 mt-2 text-right">Passed</div>}
                {g.type === "su" && !locked && (
                  <div className="mt-2 text-right">
                    <button className={`fsc-lock ${lock === g.id ? "on" : ""}`} onClick={() => setLock(lock === g.id ? null : g.id)}>{lock === g.id ? "Locked in, soldier 🔒" : "Lock it 🔒"}</button>
                  </div>
                )}
                {g.type === "su" && locked && entry?.lock === g.id && <div className="mt-2 text-right text-xs" style={{ color: "var(--pink)" }}>Your lock 🔒</div>}
              </div>
            ))}
          </Section>
        ) : null
      )}

      {!locked && (
        <div className="fixed bottom-0 left-0 right-0 p-3" style={{ background: "linear-gradient(transparent, var(--navy) 40%)" }}>
          <div className="max-w-lg mx-auto">
            <button
              className="fsc-btn w-full"
              disabled={busy || made === 0}
              onClick={async () => {
                setBusy(true);
                await onSave(picks, lock);
                setBusy(false);
              }}
            >
              {busy ? "Saving…" : `Save picks (${made}/${required.length} required)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── leaderboard ─────────────────────────
function Board({ players, totals, scores, live, week, weekPicks, locked, meId, onSwitch }) {
  const [open, setOpen] = useState(null);
  const rows = players
    .map((p) => {
      const posted = scores[p.id]?.[week?.n] || 0;
      const liveNow = live[p.id]?.pts || 0;
      return { ...p, total: totals[p.id] - posted + liveNow, weekPts: liveNow, made: Object.keys(weekPicks[p.id]?.picks || {}).length, sweep: live[p.id]?.sweep };
    })
    .sort((a, b) => b.total - a.total);

  const smack = useMemo(() => pickOne(SMACK), [week?.n]);
  return (
    <div className="pt-4">
      <h2 className="fsc-h2 px-1 mb-1">Troop roll call</h2>
      <div className="fsc-smack">"{smack}"</div>
      {rows.length === 0 && <div className="fsc-card text-center py-8">Nobody's enlisted yet.</div>}
      {rows.map((r, i) => (
        <div key={r.id}>
          <button className={`fsc-row w-full text-left ${i === 0 && r.total > 0 ? "first" : ""} ${r.id === meId ? "me" : ""}`} onClick={() => setOpen(open === r.id ? null : r.id)}>
            <div className="fsc-rank">{i === 0 && r.total > 0 ? <span className="fsc-crown">👑</span> : i === rows.length - 1 && rows.length > 2 ? "🪣" : i + 1}</div>
            <div className="flex-1 min-w-0">
              <div className="font-bold truncate">{r.emoji} {r.name}</div>
              <div className="text-xs opacity-75">{i === rows.length - 1 && rows.length > 2 ? RANK_TITLES[RANK_TITLES.length - 1] : RANK_TITLES[Math.min(i, RANK_TITLES.length - 2)]}{r.sweep ? " · Clean sweep 🧹" : ""}</div>
            </div>
            <div className="text-right">
              <div className="fsc-pts">{fmt(r.total)}</div>
              <div className="text-xs opacity-75">{week ? (locked ? `${short(r.weekPts)} this week` : r.made ? `${r.made} picks in` : "no picks yet") : ""}</div>
            </div>
          </button>
          {open === r.id && week && (
            <div className="fsc-card text-sm" style={{ marginTop: -2 }}>
              {!locked ? (
                <div className="opacity-70">Picks are secret until the week locks.</div>
              ) : (
                (week.games || []).map((g) => {
                  const p = weekPicks[r.id]?.picks?.[g.id];
                  const label = !p ? "—" : g.type === "prop" || g.type === "wild" ? g.options[Number(p.slice(1))] : p === "away" ? g.away : g.home;
                  const state = !g.result || !p ? "" : p === g.result ? "✅" : "❌";
                  return (
                    <div key={g.id} className="flex justify-between py-1 border-b border-white/10 last:border-0">
                      <span className="opacity-70">{g.type === "prop" ? "Showdown" : g.type === "wild" ? g.title : `${g.away} @ ${g.home}`}</span>
                      <span className="font-semibold">{label} {weekPicks[r.id]?.lock === g.id ? "🔒" : ""} {state}</span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      ))}
      <div className="fsc-card mt-6 text-xs opacity-80">
        <div className="font-bold text-sm mb-1 opacity-100">How points work</div>
        Winner picks {short(PTS.su)} each – that's the bread and butter. Lock one winner pick to make it {short(PTS.suLock)} (or lose {short(PTS.suLock)}). Spread bets are optional: win {short(PTS.spread)}, lose {short(PTS.spreadMiss)}, or pass. Player showdown {short(PTS.prop)}. Go 10-for-10 on winners for a {short(PTS.sweep)} clean sweep. Tally posts Tuesday morning after Monday night football.
      </div>
      <button className="fsc-btn ghost w-full mt-3 text-sm" onClick={onSwitch}>Not you? Switch player</button>
    </div>
  );
}

// ───────────────────────── commissioner ─────────────────────────
function Commish({ config, week, players, onSaveWeek, onPostTally, onReset, onLoadWeek, flash, pin, setPin, auto }) {
  const [pinInput, setPinInput] = useState("");
  const [ok, setOk] = useState(!!pin);
  const [autoLog, setAutoLog] = useState(auto?.lastLog || []);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!ok)
    return (
      <div className="pt-6">
        <div className="fsc-card">
          <div className="font-bold mb-2">Commissioner only</div>
          <input className="fsc-input mb-3" type="password" inputMode="numeric" placeholder="PIN" value={pinInput} onChange={(e) => setPinInput(e.target.value)} />
          <button className="fsc-btn w-full" onClick={async () => { if (await checkPin(pinInput)) { setPin(pinInput); setOk(true); } else flash("Wrong PIN"); }}>Unlock</button>
          <p className="text-xs opacity-60 mt-3">The PIN is the COMMISH_PIN you set in Netlify.</p>
        </div>
      </div>
    );

  const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const startWeek = (n) => {
    const base = week && week.n === n ? week : null;
    setDraft(base ? JSON.parse(JSON.stringify(base)) : blankWeek(n, toLocalInput(nextWednesdayLock())));
  };

  const upd = (id, patch) => setDraft({ ...draft, games: draft.games.map((g) => (g.id === id ? { ...g, ...patch } : g)) });

  const complete = (g) => (g.type === "prop" || g.type === "wild" ? g.title && g.options.length >= 2 && g.options.every((o) => o.trim()) && (g.type !== "wild" || Number(g.pts) > 0) : g.away.trim() && g.home.trim());
  const addWild = () =>
    setDraft({ ...draft, games: [...draft.games, { id: uid(), league: "ALL", type: "wild", title: "", options: ["", ""], pts: "500000", miss: "250000", optional: true, result: null }] });
  const removeGame = (id) => setDraft({ ...draft, games: draft.games.filter((g) => g.id !== id) });

  if (draft) {
    const ready = draft.games.every(complete);
    return (
      <div className="pt-4">
        <div className="flex justify-between items-baseline mb-3">
          <h2 className="fsc-h2">Week {draft.n} slate</h2>
          <button className="text-sm opacity-70" onClick={() => setDraft(null)}>Cancel</button>
        </div>
        <div className="fsc-card" style={{ background: "rgba(255,61,127,.15)" }}>
          <div className="text-sm mb-2">Let the app find this weekend's marquee games, lines and a QB showdown. Check what it fills in – it's a draft, and lines move.</div>
          <button
            className="fsc-btn pink w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const s = await askClaude(slatePrompt(), pin);
                setDraft({ ...draft, games: fillSlate(draft.games, s) });
                flash("Slate filled – give it a once-over");
              } catch {
                flash("Couldn't pull the slate – fill it in by hand");
              }
              setBusy(false);
            }}
          >
            {busy ? "Searching the web…" : "Fill the slate for me"}
          </button>
        </div>
        <div className="fsc-card">
          <label className="text-sm font-semibold block mb-1">Picks lock at</label>
          <input className="fsc-input" type="datetime-local" value={draft.lockAt.slice(0, 16)} onChange={(e) => setDraft({ ...draft, lockAt: e.target.value })} />
        </div>
        {[["NFL", "su", "NFL winners (5)"], ["CFB", "su", "College winners (5)"], ["NFL", "spread", "NFL spread game"], ["CFB", "spread", "College spread game"]].map(([lg, ty, title]) => (
          <Section key={title} title={title}>
            {draft.games.filter((g) => g.league === lg && g.type === ty).map((g) => (
              <div key={g.id} className="fsc-card">
                <div className="grid grid-cols-2 gap-2">
                  <input className="fsc-input" placeholder="Away team" value={g.away} onChange={(e) => upd(g.id, { away: e.target.value })} />
                  <input className="fsc-input" placeholder="Home team" value={g.home} onChange={(e) => upd(g.id, { home: e.target.value })} />
                </div>
                {ty === "spread" && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <select className="fsc-input" value={g.fav} onChange={(e) => upd(g.id, { fav: e.target.value })}>
                      <option value="home">Home is favored</option>
                      <option value="away">Away is favored</option>
                    </select>
                    <input className="fsc-input" placeholder="Line, e.g. 3.5" inputMode="decimal" value={g.line} onChange={(e) => upd(g.id, { line: e.target.value })} />
                  </div>
                )}
              </div>
            ))}
          </Section>
        ))}
        <Section title="Player showdown (3 players)">
          {draft.games.filter((g) => g.type === "prop").map((g) => (
            <div key={g.id} className="fsc-card">
              <input className="fsc-input mb-2" placeholder="Question, e.g. Most rushing yards" value={g.title} onChange={(e) => upd(g.id, { title: e.target.value })} />
              {g.options.map((o, i) => (
                <input key={i} className="fsc-input mb-2" placeholder={`Player ${i + 1}`} value={o} onChange={(e) => upd(g.id, { options: g.options.map((x, j) => (j === i ? e.target.value : x)) })} />
              ))}
            </div>
          ))}
        </Section>
        <Section title="Wildcard challenges" tag="optional">
          <p className="text-xs opacity-70 px-1 mb-2">Anything with a result: Ryder Cup, a golf major, the World Series, "does Sebastian finish the Thanksgiving turkey trot." 2–4 options, you set the stakes.</p>
          {draft.games.filter((g) => g.type === "wild").map((g) => (
            <div key={g.id} className="fsc-card">
              <input className="fsc-input mb-2" placeholder="The challenge, e.g. Who wins the Ryder Cup?" value={g.title} onChange={(e) => upd(g.id, { title: e.target.value })} />
              {g.options.map((o, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input className="fsc-input" placeholder={`Option ${i + 1}`} value={o} onChange={(e) => upd(g.id, { options: g.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                  {g.options.length > 2 && <button className="fsc-btn ghost" onClick={() => upd(g.id, { options: g.options.filter((_, j) => j !== i) })}>✕</button>}
                </div>
              ))}
              {g.options.length < 4 && <button className="fsc-lock mb-3" onClick={() => upd(g.id, { options: [...g.options, ""] })}>+ add option</button>}
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div><label className="text-xs opacity-70">Points if right</label><input className="fsc-input" inputMode="numeric" value={g.pts} onChange={(e) => upd(g.id, { pts: e.target.value.replace(/[^0-9]/g, "") })} /></div>
                <div><label className="text-xs opacity-70">Points lost if wrong</label><input className="fsc-input" inputMode="numeric" value={g.miss} onChange={(e) => upd(g.id, { miss: e.target.value.replace(/[^0-9]/g, "") })} /></div>
              </div>
              <div className="flex justify-between items-center">
                <button className={`fsc-lock ${g.optional ? "" : "on"}`} onClick={() => upd(g.id, { optional: !g.optional })}>{g.optional ? "Optional – tap to make required" : "Required – tap to make optional"}</button>
                <button className="text-xs opacity-70" onClick={() => removeGame(g.id)}>Remove</button>
              </div>
            </div>
          ))}
          <button className="fsc-btn ghost w-full" onClick={addWild}>+ Add a wildcard challenge</button>
        </Section>
        <button
          className="fsc-btn w-full mb-16"
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSaveWeek({ ...draft, lockAt: new Date(draft.lockAt).toISOString() });
              flash(`Week ${draft.n} posted. Tell the family.`);
              setDraft(null);
            } catch {
              flash("Save failed – try again");
            }
            setBusy(false);
          }}
        >
          {ready ? `Post week ${draft.n}` : "Fill in every game to post"}
        </button>
      </div>
    );
  }

  const setResult = async (g, r) => {
    const w = { ...week, games: week.games.map((x) => (x.id === g.id ? { ...x, result: x.result === r ? null : r } : x)) };
    await onSaveWeek(w);
  };
  const gradedAll = week?.games?.every((g) => g.result);

  return (
    <div className="pt-4">
      <Section title="Autopilot">
        <div className="fsc-card text-sm">
          <div className="font-bold mb-1">The app runs the week for you 🤖</div>
          <div className="opacity-80 mb-3">Every Tuesday at 7am, 1pm and 7pm Eastern the server pulls results, posts the tally, and builds next week's slate with a Wednesday noon lock – whether or not anyone opens the app. You only come here to fix a result or add a wildcard.</div>
          {auto?.lastRun && <div className="text-xs opacity-70 mb-2">Last run: {new Date(auto.lastRun).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>}
          {autoLog.length > 0 && <ul className="text-xs opacity-80 mb-3">{autoLog.map((l, i) => <li key={i}>· {l}</li>)}</ul>}
          <button className="fsc-btn ghost w-full" disabled={busy} onClick={async () => { setBusy(true); try { const r = await runAutopilot(pin); setAutoLog(r.log || []); flash("Autopilot ran"); await onLoadWeek(); } catch { flash("Autopilot failed – see log"); } setBusy(false); }}>{busy ? "Running…" : "Run autopilot now"}</button>
        </div>
      </Section>
      <Section title="This week">
        <div className="fsc-card">
          {week ? (
            <div className="text-sm mb-3">Week {week.n} is posted · {players.length} players in the league · locks {new Date(week.lockAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
          ) : (
            <div className="text-sm mb-3">Nothing posted yet. Build week 1 and the family can start picking.</div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button className="fsc-btn" onClick={() => startWeek((week?.n || 0) + 1)}>Build week {(week?.n || 0) + 1}</button>
            {week && <button className="fsc-btn ghost" onClick={() => startWeek(week.n)}>Edit week {week.n}</button>}
          </div>
        </div>
      </Section>

      {week && (
        <Section title="Enter results" tag="tap the winner / who covered">
          <button
            className="fsc-btn ghost w-full mb-3"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await askClaude(resultsPrompt(week), pin);
                const valid = VALID_RESULTS;
                const w = { ...week, games: week.games.map((g) => (valid.has(r.results?.[g.id]) ? { ...g, result: r.results[g.id] } : g)) };
                await onSaveWeek(w);
                const n = Object.values(r.results || {}).filter((v) => valid.has(v)).length;
                flash(`Filled ${n} results – double-check them`);
              } catch {
                flash("Couldn't pull results – tap them in");
              }
              setBusy(false);
            }}
          >
            {busy ? "Searching the web…" : "Pull results from the web"}
          </button>
          {week.games.map((g) => {
            const opts = g.type === "prop" || g.type === "wild" ? g.options.map((o, i) => ({ id: `o${i}`, label: o })) : [{ id: "away", label: g.away }, { id: "home", label: g.home }];
            return (
              <div key={g.id} className="fsc-card">
                <div className="text-xs opacity-70 mb-2">{g.type === "prop" || g.type === "wild" ? g.title : `${g.league} ${g.type === "spread" ? `spread (${g.fav === "home" ? g.home : g.away} −${g.line})` : "winner"}`}</div>
                <Choice options={opts} value={g.result} onPick={(r) => setResult(g, r)} />
              </div>
            );
          })}
          <button
            className="fsc-btn pink w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onPostTally();
              setBusy(false);
            }}
          >
            {gradedAll ? `Post the Tuesday tally for week ${week.n}` : "Post partial tally (you can re-post later)"}
          </button>
          <p className="text-xs opacity-60 mt-2">Posting locks this week's points into season totals. Re-post any time if a result changes.</p>
        </Section>
      )}

      {config.weeks?.length > 1 && (
        <Section title="Look at an earlier week">
          <div className="flex flex-wrap gap-2">
            {config.weeks.map((n) => (
              <button key={n} className={`fsc-btn ${n === week?.n ? "" : "ghost"} text-sm`} onClick={() => onLoadWeek(n)}>Wk {n}</button>
            ))}
          </div>
        </Section>
      )}

      <Section title="Settings">
        <div className="fsc-card">
          <div className="text-sm font-semibold mb-1">Start the whole league over</div>
          <p className="text-xs opacity-70 mb-2">Deletes every player, week, pick and score. No undo.</p>
          <button className="fsc-btn ghost w-full" onClick={() => { if (window.confirm("Wipe everything and start over?")) onReset(); }}>Wipe league</button>
        </div>
      </Section>
    </div>
  );
}
