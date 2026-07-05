import { countdown, type Usage } from "../pet/stateMachine";

// Weekly budget as a little health bar of hearts — the hover popup under the cat. Hearts
// are "energy left": full hearts deplete as the weekly window is spent, so a nearly-spent
// week reads at a glance as a tired cat running low on hearts. This mirrors how weekly
// usage already drives the cat's mood (loadOf = max(5h, weekly) in stateMachine.ts).

const HEARTS = 5;

// SVG hearts only (no emoji — renders consistently and takes our tier colors).
function Heart({ filled, color }: { filled: boolean; color: string }) {
  return (
    <svg
      className={`heart ${filled ? "is-full" : "is-empty"}`}
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden="true"
    >
      <path
        d="M12 20.5S3.5 15.4 3.5 9.6C3.5 6.6 5.7 4.7 8.2 4.7c1.7 0 3 1 3.8 2.3.8-1.3 2.1-2.3 3.8-2.3 2.5 0 4.7 1.9 4.7 4.9 0 5.8-8.5 10.9-8.5 10.9z"
        fill={filled ? color : "none"}
        stroke={filled ? "none" : "rgba(154, 107, 60, 0.4)"}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WeeklyHearts({ usage }: { usage: Usage }) {
  const used = Math.round(usage.weeklyPercent);
  const remaining = Math.max(0, 100 - used);
  const full = Math.min(HEARTS, Math.round((remaining / 100) * HEARTS));
  // Hearts stay heart-colored (rose → amber → red) so depletion, not hue, tells the story.
  const color = remaining > 30 ? "#FF7EA0" : remaining > 12 ? "#F0A24B" : "#E86A5C";

  return (
    <div className="weekly" role="status" aria-label={`Weekly usage ${used} percent`}>
      <div className="weekly-hearts">
        {Array.from({ length: HEARTS }, (_, i) => (
          <Heart key={i} filled={i < full} color={color} />
        ))}
      </div>
      <div className="weekly-meta">
        <span className="weekly-label">week</span>
        <span className="weekly-sub">
          {used}% used
          {usage.weeklyResetsAt != null && ` · ${countdown(usage.weeklyResetsAt)}`}
        </span>
      </div>
    </div>
  );
}
