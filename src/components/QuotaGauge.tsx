import {
  countdown,
  countdownPrecise,
  isRateLimited,
  nextReset,
  type Usage,
} from "../pet/stateMachine";

// The gauge under the cat: the 5-hour budget shown as % USED (matching what Claude
// Code's /status reports), as a slim bar that fills up toward the limit, with a soft
// reset countdown beneath. When the window is nearly spent (or a limit is hit) the
// reset line breathes.

interface QuotaGaugeProps {
  usage: Usage;
}

export function QuotaGauge({ usage }: QuotaGaugeProps) {
  const used = Math.round(usage.fiveHourPercent);
  const limited = isRateLimited(usage);
  const low = used >= 75 || limited;
  const color = used >= 90 ? "#E0524A" : used >= 75 ? "#E8913A" : "#5BB98B";
  const resetAt = limited ? usage.fiveHourResetsAt ?? nextReset(usage) : nextReset(usage);

  return (
    <div className="gauge">
      <div className="gauge-row">
        <span className="gauge-cap">5h</span>
        <div className="gauge-track">
          <div className="gauge-fill" style={{ width: `${used}%`, background: color }} />
        </div>
        <span className="gauge-pct" style={{ color }}>
          {used}%
        </span>
      </div>
      <div className={`gauge-reset ${low ? "is-soft" : ""}`}>
        {limited ? `Reset in ${countdownPrecise(resetAt)}` : `resets in ${countdown(resetAt)}`}
      </div>
    </div>
  );
}
