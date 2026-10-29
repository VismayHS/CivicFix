import { formatDateTime, slaState, type SlaLevel } from "@/lib/format";
import type { ComplaintStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The SLA clock: CivicFix's signature element.
 * The track runs from "filed" to 125% of the SLA window; the notch at 80% is
 * the deadline, so overruns stay visible instead of clipping at 100%.
 */
const FILL: Record<SlaLevel, string> = {
  ok: "bg-primary",
  warning: "bg-[#c27a12]",
  breached: "bg-danger",
  met: "bg-ok",
  missed: "bg-[#c27a12]",
  closed: "bg-muted-foreground/40",
};

const TEXT: Record<SlaLevel, string> = {
  ok: "text-foreground/80",
  warning: "text-signal",
  breached: "text-danger",
  met: "text-ok",
  missed: "text-signal",
  closed: "text-muted-foreground",
};

interface Props {
  complaint: { createdAt: string; slaDeadline: string; resolvedAt: string | null; status: ComplaintStatus };
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
  now?: number;
}

export function SlaBar({ complaint, size = "sm", showLabel = true, className, now }: Props) {
  const s = slaState(complaint, now);
  const pos = Math.min(s.used / 1.25, 1) * 100;
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <div
        role="meter"
        aria-label={`SLA: ${s.label}`}
        aria-valuemin={0}
        aria-valuemax={125}
        aria-valuenow={Math.round(s.used * 100)}
        title={`Deadline ${formatDateTime(complaint.slaDeadline)}`}
        className={cn("relative flex-1 overflow-hidden rounded-full bg-[#e6e1d6]", size === "sm" ? "h-1.5 min-w-16" : "h-2.5 min-w-28")}
      >
        <div className={cn("absolute inset-y-0 left-0 rounded-full", FILL[s.level])} style={{ width: `${s.level === "closed" ? 100 : pos}%` }} />
        <div aria-hidden className="absolute inset-y-0 left-[80%] w-px bg-foreground/40" />
      </div>
      {showLabel && (
        // Long labels ("Merged into another report") wrap instead of spilling out of narrow cards.
        <span className={cn("min-w-0 font-mono text-xs leading-tight tabular-nums", TEXT[s.level], size === "md" && "text-sm")}>{s.label}</span>
      )}
    </div>
  );
}
