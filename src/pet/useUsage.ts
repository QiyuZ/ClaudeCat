import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DataStatus, Usage } from "./stateMachine";

// Shape emitted by the Rust core (mirrors the cc-pet-usage.json cache written by
// scripts/statusline.js). resets_at / updated_at are ISO-8601 strings.
interface Window_ {
  used_percentage?: number | null;
  resets_at?: string | null;
}
interface RawSnapshot {
  five_hour?: Window_ | null;
  weekly?: Window_ | null;
  updated_at?: string | null;
}
interface UsagePayload {
  status: DataStatus;
  data: RawSnapshot | null;
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function parse(payload: UsagePayload): { usage: Usage | null; status: DataStatus } {
  if (payload.status === "nodata" || !payload.data) {
    return { usage: null, status: "nodata" };
  }
  const d = payload.data;
  // A snapshot with neither window populated carries no real usage — Claude Code only
  // emits `rate_limits` for Pro/Max accounts after the first API response, so a fresh or
  // API-less render leaves both null. Reporting that as a confident 0% used is a lie;
  // surface it as "waiting for usage" instead so the widget doesn't flatline at 0%.
  const hasFive = typeof d.five_hour?.used_percentage === "number";
  const hasWeekly = typeof d.weekly?.used_percentage === "number";
  if (!hasFive && !hasWeekly) {
    return { usage: null, status: "nodata" };
  }
  const usage: Usage = {
    fiveHourPercent: clampPct(d.five_hour?.used_percentage),
    weeklyPercent: clampPct(d.weekly?.used_percentage),
    fiveHourResetsAt: toMs(d.five_hour?.resets_at),
    weeklyResetsAt: toMs(d.weekly?.resets_at),
    updatedAt: toMs(d.updated_at) ?? Date.now(),
  };
  return { usage, status: payload.status };
}

function clampPct(n: number | null | undefined): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function useUsage(): { usage: Usage | null; status: DataStatus } {
  const [state, setState] = useState<{ usage: Usage | null; status: DataStatus }>({
    usage: null,
    status: "nodata",
  });

  useEffect(() => {
    let alive = true;
    invoke<UsagePayload>("get_usage")
      .then((p) => alive && setState(parse(p)))
      .catch(() => {});
    const un = listen<UsagePayload>("usage-updated", (e) => {
      if (alive) setState(parse(e.payload));
    });
    return () => {
      alive = false;
      un.then((f) => f());
    };
  }, []);

  return state;
}
