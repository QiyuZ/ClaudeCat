import { countdown, countdownPrecise, isRateLimited, type Usage } from "../pet/stateMachine";

// The always-visible stat under the cat: the 5-hour window as % USED (matching Claude
// Code's /status), drawn as a chunky, glossy "fuel" pill with a little paw, plus the
// real reset countdown. Weekly lives in the hover popup (see WeeklyHearts). When a limit
// is hit the reset line breathes.

interface QuotaGaugeProps {
  usage: Usage;
}

// Visual warmth tier for the gauge (independent of the mood tiers): green while there's
// plenty, amber as it tightens, coral when nearly spent.
function tier(used: number): "chill" | "tired" | "weary" {
  return used >= 90 ? "weary" : used >= 75 ? "tired" : "chill";
}

function Paw({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <ellipse cx="12" cy="15.5" rx="5" ry="4.2" />
      <ellipse cx="5.6" cy="10.6" rx="2" ry="2.6" />
      <ellipse cx="9.4" cy="7.2" rx="2" ry="2.7" />
      <ellipse cx="14.6" cy="7.2" rx="2" ry="2.7" />
      <ellipse cx="18.4" cy="10.6" rx="2" ry="2.6" />
    </svg>
  );
}

export function QuotaGauge({ usage }: QuotaGaugeProps) {
  const five = Math.round(usage.fiveHourPercent);
  const limited = isRateLimited(usage);
  const t = tier(five);
  const reset = usage.fiveHourResetsAt;

  return (
    <div className={`gauge gauge--${t}`}>
      <div className="gauge-row">
        <Paw className="gauge-paw" />
        <div className="gauge-track">
          <div className="gauge-fill" style={{ width: `${Math.max(6, five)}%` }}>
            <span className="gauge-shine" />
          </div>
        </div>
        <span className="gauge-pct">
          {five}
          <span className="gauge-pct-sign">%</span>
        </span>
      </div>
      {reset != null && (
        <div className={`gauge-reset ${five >= 75 || limited ? "is-soft" : ""}`}>
          {limited ? `Reset in ${countdownPrecise(reset)}` : `resets in ${countdown(reset)}`}
        </div>
      )}
    </div>
  );
}
