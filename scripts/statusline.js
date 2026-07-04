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

function main() {
  const raw = readStdin();
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    /* ignore malformed input */
  }

  const rl = input.rate_limits || input.rateLimits || {};
  const fiveHour = normWindow(pick(rl, ["five_hour", "fiveHour", "session", "5h"]));
  const weekly = normWindow(pick(rl, ["seven_day", "sevenDay", "weekly", "week", "7d"]));

  const dir = path.join(os.homedir(), ".claude");
  const file = path.join(dir, "cc-pet-usage.json");

  // rate_limits is only present in the payload AFTER an API response (per the docs),
  // so many renders legitimately omit it. When a window is missing this time, carry
  // forward the last-known value from the cache instead of nulling it out — otherwise
  // the widget's numbers would blink away between API responses.
  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(file, "utf8")) || {};
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
    if (process.env.CC_PET_DEBUG === "1") {
      try {
        fs.writeFileSync(path.join(dir, "cc-pet-debug.json"), raw || "{}");
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* non-fatal: widget just keeps its last value */
  }

  // Pass-through line for the terminal statusline.
  const f = fiveHour && typeof fiveHour.used_percentage === "number"
    ? `${Math.round(100 - fiveHour.used_percentage)}%` : "--";
  const w = weekly && typeof weekly.used_percentage === "number"
    ? `${Math.round(100 - weekly.used_percentage)}%` : "--";
  process.stdout.write(`🐱 5h ${f} · wk ${w} left`);
}

main();
