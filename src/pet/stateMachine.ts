// Turns Claude Code usage into the cat's mood. Driven by whichever budget (5-hour
// or weekly) is more constrained, so the cat looks tired when *either* runs low.
// The mood is the single knob the character art reacts to — see characters/cat.tsx.

// "typing" is an activity overlay (cat is actively working), not a tiredness tier — it's
// set in App from the live `active` signal, never returned by moodFor.
export type Mood = "chill" | "typing" | "tired" | "weary" | "sleeping";
export type DataStatus = "ok" | "stale" | "nodata";

export interface Usage {
  /** 0..100 — official 5-hour rolling limit usage. */
  fiveHourPercent: number;
  /** 0..100 — official 7-day limit usage. */
  weeklyPercent: number;
  /** epoch ms when the 5h window resets, or null if unknown. */
  fiveHourResetsAt: number | null;
  /** epoch ms when the weekly window resets, or null if unknown. */
  weeklyResetsAt: number | null;
  /** epoch ms this snapshot was produced. */
  updatedAt: number;
}

/** The binding constraint: the fuller of the two budgets. */
export function loadOf(u: Usage): number {
  return Math.max(u.fiveHourPercent, u.weeklyPercent);
}

/** Remaining headroom in the 5-hour window (drives the gauge fill). */
export function fiveHourRemaining(u: Usage): number {
  return clamp(100 - u.fiveHourPercent);
}

export function weeklyRemaining(u: Usage): number {
  return clamp(100 - u.weeklyPercent);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

// Mood tiers along a single "tiredness" axis. The cat stays relaxed (an animated
// grooming idle) until a budget is genuinely nearly spent — only above 90% does it
// look tired, then lies down, then curls up asleep once a limit is actually hit.
// Rate-limited is treated as >= 99.5, not a strict 100: the usage endpoint can report
// e.g. 99.7 at the moment you're actually capped, and rounding that down to "weary" would
// hide the asleep/reset state. Half a percent of slack costs nothing and avoids that gap.
export const RATE_LIMIT_PCT = 99.5;

export function moodFor(u: Usage): Mood {
  const load = loadOf(u);
  if (load >= RATE_LIMIT_PCT) return "sleeping"; // rate-limited: out cold, "Reset in mm:ss"
  if (load >= 97) return "weary"; // right at the edge: lying down, exhausted
  if (load >= 90) return "tired"; // nearly out: sitting, droopy
  return "chill"; // plenty of headroom: relaxed
}

/** Whether the cat is out cold (rate-limited) — the breathing "Reset in" whisper. */
export function isRateLimited(u: Usage): boolean {
  return loadOf(u) >= RATE_LIMIT_PCT;
}

/** Data older than this reads as "offline" — cat dims, numbers fade. */
export const STALE_AFTER_MS = 10 * 60 * 1000;

export const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The soonest reset instant across both windows. */
export function nextReset(u: Usage): number | null {
  const a = u.fiveHourResetsAt ?? Infinity;
  const b = u.weeklyResetsAt ?? Infinity;
  const m = Math.min(a, b);
  return Number.isFinite(m) ? m : null;
}

/**
 * A reset instant that's guaranteed to be in the future. Windows are periodic (5h / 7d),
 * so if the reported reset already passed — because it just rolled over, or because the
 * machine clock disagrees with the server that issued the timestamp — we advance it by
 * whole periods until it's ahead of now. On a correctly-clocked machine with a future
 * reset this is a no-op.
 */
export function futureReset(resetsAt: number | null, periodMs: number, now = Date.now()): number | null {
  if (resetsAt == null) return null;
  if (resetsAt > now) return resetsAt;
  const k = Math.ceil((now - resetsAt) / periodMs);
  return resetsAt + k * periodMs;
}

/** "2h 14m" / "3d 4h" style compact countdown. */
export function countdown(resetsAt: number | null, now = Date.now()): string {
  if (resetsAt == null) return "--";
  const ms = resetsAt - now;
  if (ms <= 0) return "any moment";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** mm:ss precise countdown, for the sleeping "Reset in" whisper. */
export function countdownPrecise(resetsAt: number | null, now = Date.now()): string {
  if (resetsAt == null) return "--:--";
  const ms = Math.max(0, resetsAt - now);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
