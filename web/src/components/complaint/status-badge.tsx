import { PRIORITY_LABEL, STATUS_LABEL, STATUS_TONE } from "@/lib/constants";
import type { ComplaintStatus, Priority } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE = {
  neutral: "bg-muted text-foreground/80 ring-border",
  info: "bg-info-soft text-info ring-info/15",
  signal: "bg-signal-soft text-signal ring-signal/20",
  danger: "bg-danger-soft text-danger ring-danger/15",
  ok: "bg-ok-soft text-ok ring-ok/15",
  dup: "bg-dup-soft text-dup ring-dup/15",
} as const;

const DOT = {
  neutral: "bg-foreground/45",
  info: "bg-info",
  signal: "bg-signal",
  danger: "bg-danger",
  ok: "bg-ok",
  dup: "bg-dup",
} as const;

export function StatusBadge({ status, className }: { status: ComplaintStatus; className?: string }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONE[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[tone])} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: Priority }) {
  if (priority === "NORMAL") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-px text-[0.7rem] font-semibold tracking-wide uppercase",
        priority === "CRITICAL" && "bg-danger text-white",
        priority === "HIGH" && "bg-signal-soft text-signal",
        priority === "LOW" && "bg-muted text-muted-foreground",
      )}
    >
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function EscalationTag({ level }: { level: number }) {
  if (!level) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-danger-soft px-1.5 py-px text-[0.7rem] font-semibold text-danger">
      L{level} escalation
    </span>
  );
}
