#!/usr/bin/env node
/*
 * ClaudeCat statusline hook.
 *
 * Claude Code invokes the configured statusLine command once per render, passing a
 * JSON payload on stdin. For Claude.ai (Pro/Max) subscribers it includes `rate_limits`
 * with the official 5-hour and 7-day usage:
 *
 *   rate_limits: {
 *     five_hour: { used_percentage: 23.5, resets_at: 1738425600 },  // resets_at = UNIX SECONDS
 *     seven_day: { used_percentage: 41.2, resets_at: 1738857600 }
 *   }
 *
 * `used_percentage` is 0..100 CONSUMED. We cache a normalized snapshot to
 * ~/.claude/cc-pet-usage.json for the ClaudeCat widget, and print a short pass-through
 * line so the terminal statusline still shows something.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function pick(obj, keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] != null) return obj[k];
  }
  return undefined;
}

// resets_at is documented as Unix epoch *seconds*. Be tolerant of ms or ISO too.
function toIso(resets) {
  if (resets == null) return undefined;
  if (typeof resets === "number") {
    const ms = resets < 1e12 ? resets * 1000 : resets; // seconds -> ms
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const d = new Date(resets);
  return Number.isNaN(d.getTime()) ? String(resets) : d.toISOString();
}

function normWindow(w) {
  if (!w || typeof w !== "object") return null;
  const used = pick(w, ["used_percentage", "usedPercentage", "percent", "used_pct"]);
  const resets = pick(w, ["resets_at", "resetsAt", "reset_at", "resetAt", "reset"]);
  const out = {};
  if (typeof used === "number") out.used_percentage = used;
  const iso = toIso(resets);
  if (iso) out.resets_at = iso;
  return Object.keys(out).length ? out : null;
}

function deepFind(obj, keyCandidates, maxDepth) {
  if (!obj || typeof obj !== "object" || maxDepth <= 0) return undefined;
  for (const k of keyCandidates) {
    if (obj[k] != null) return obj[k];
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFind(item, keyCandidates, maxDepth - 1);
      if (found != null) return found;
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (["messages", "prompt", "conversation", "tools", "args", "text"].includes(key)) continue;
      const found = deepFind(obj[key], keyCandidates, maxDepth - 1);
      if (found != null) return found;
    }
  }
  return undefined;
}

function recurseKeys(obj, depth) {
  if (!obj || typeof obj !== "object" || depth <= 0) return [];
  const keys = Object.keys(obj);
  if (depth <= 1) return keys;
  const nested = [];
  for (const key of keys) {
    const child = recurseKeys(obj[key], depth - 1);
    for (const ck of child) {
      nested.push(key + "." + ck);
    }
  }
  return nested;
}

function main() {
  const raw = readStdin();
  let input = {};
  let parseOk = false;
  try {
    input = JSON.parse(raw);
    parseOk = true;
  } catch {
    /* ignore malformed input */
  }

  // Try top-level rate_limits first, then deep-search the payload.
  let rl = input.rate_limits || input.rateLimits || {};
  if (!Object.keys(rl).length) {
    const found = deepFind(input, ["rate_limits", "rateLimits", "rate_limits"], 4);
    if (found && typeof found === "object" && !Array.isArray(found)) rl = found;
  }
  const fiveHour = normWindow(pick(rl, ["five_hour", "fiveHour", "session", "5h"]));
  const weekly = normWindow(pick(rl, ["seven_day", "sevenDay", "weekly", "week", "7d"]));

  const dir = path.join(os.homedir(), ".claude");
  const file = path.join(dir, "cc-pet-usage.json");

  // rate_limits is only present in the payload AFTER an API response (per the docs),
  // so many renders legitimately omit it. When a window is missing this time, carry
  // forward the last-known value from the cache instead of nulling it out — otherwise
  // the widget's numbers would blink away between API responses.
  //
  // But carry-forward has a limit: the 5-hour window rolls every 5h, so a value more
  // than a few hours old is meaningless. We drop anything older than MAX_CARRY_MS so
  // yesterday's numbers can never masquerade as current — better to show nothing than
  // a stale figure that disagrees with `/status`.
  const MAX_CARRY_MS = 3 * 60 * 60 * 1000; // 3 hours
  let prev = {};
  try {
    const cached = JSON.parse(fs.readFileSync(file, "utf8")) || {};
    const age = Date.now() - Date.parse(cached.updated_at || 0);
    if (Number.isFinite(age) && age <= MAX_CARRY_MS) prev = cached;
  } catch {
    /* no prior cache */
  }

  const snapshot = {
    five_hour: fiveHour || prev.five_hour || null,
    weekly: weekly || prev.weekly || null,
    updated_at: new Date().toISOString(),
    source: "statusline",
    // Kept for transparency / debugging across Claude Code versions.
    rate_limits_raw: Object.keys(rl).length ? rl : prev.rate_limits_raw || null,
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmp, file);
  } catch {
    /* non-fatal: widget just keeps its last value */
  }

  // Always write a debug snapshot so we can diagnose what Claude Code sends.
  try {
    const rawSnippet = raw.length > 4000 ? raw.slice(0, 4000) + "\n... [truncated]" : raw;
    const debug = {
      time: new Date().toISOString(),
      parseOk,
      rawLength: raw.length,
      rawPreview: rawSnippet,
      inputKeys: parseOk ? Object.keys(input) : [],
      inputKeys_nested: parseOk ? recurseKeys(input, 2) : [],
      rlKeys: Object.keys(rl),
      rlFound: Object.keys(rl).length > 0,
      fiveHour,
      weekly,
    };
    fs.writeFileSync(path.join(dir, "cc-pet-debug.json"), JSON.stringify(debug, null, 2));
    // Append a compact per-render trace so we can see whether rate_limits EVER arrives
    // across a real session (the single-snapshot debug file above only shows the last
    // render, which is often an idle one). Capped so it can't grow without bound.
    const logLine = JSON.stringify({
      t: new Date().toISOString(),
      sid: parseOk ? String(input.session_id || "").slice(0, 8) : "",
      apiMs: parseOk ? input.cost && input.cost.total_api_duration_ms : null,
      rlFound: Object.keys(rl).length > 0,
      five: fiveHour && fiveHour.used_percentage,
      week: weekly && weekly.used_percentage,
    }) + "\n";
    const logFile = path.join(dir, "cc-pet-trace.log");
    try {
      const existing = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
      const lines = (existing + logLine).split("\n").filter(Boolean).slice(-200);
      fs.writeFileSync(logFile, lines.join("\n") + "\n");
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }

  // Pass-through line for the terminal statusline.
  const f = fiveHour && typeof fiveHour.used_percentage === "number"
    ? `${Math.round(100 - fiveHour.used_percentage)}%` : "--";
  const w = weekly && typeof weekly.used_percentage === "number"
    ? `${Math.round(100 - weekly.used_percentage)}%` : "--";
  process.stdout.write(`🐱 5h ${f} · wk ${w} left`);
}

main();
