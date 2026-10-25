import { ROLE_LABEL, STATUS_LABEL, STATUS_TONE } from "@/lib/constants";
import { formatShortDateTime } from "@/lib/format";
import type { ComplaintStatus, Role } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Entry {
  historyNo: number;
  oldStatus: ComplaintStatus | null;
  newStatus: ComplaintStatus;
  changedByName?: string;
  changedByRole: Role | "SYSTEM";
  remarks: string | null;
  changedAt: string;
}

const RING = {
  neutral: "border-foreground/40 bg-background",
  info: "border-info bg-info-soft",
  signal: "border-signal bg-signal-soft",
  danger: "border-danger bg-danger-soft",
  ok: "border-ok bg-ok-soft",
  dup: "border-dup bg-dup-soft",
} as const;

/** status_history rendered newest last, like a paper docket. */
export function Timeline({ entries, showActors = true }: { entries: Entry[]; showActors?: boolean }) {
  return (
    <ol className="relative">
      {entries.map((e, i) => {
        const last = i === entries.length - 1;
        const same = e.oldStatus === e.newStatus;
        return (
          <li key={e.historyNo} className="relative flex gap-4 pb-6 last:pb-0">
            {!last && <span aria-hidden className="absolute top-5 bottom-0 left-[7px] w-px bg-border" />}
            <span aria-hidden className={cn("relative mt-1 size-[15px] shrink-0 rounded-full border-2", RING[STATUS_TONE[e.newStatus]], last && "ring-4 ring-primary/10")} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium">
                  {same ? "Updated" : STATUS_LABEL[e.newStatus]}
                  {e.oldStatus && !same && <span className="font-normal text-muted-foreground"> from {STATUS_LABEL[e.oldStatus].toLowerCase()}</span>}
                </p>
                <time className="font-mono text-xs text-muted-foreground tabular-nums" dateTime={e.changedAt}>
                  {formatShortDateTime(e.changedAt)}
                </time>
              </div>
              {e.remarks && <p className="mt-0.5 text-sm text-foreground/80">{e.remarks}</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {showActors && e.changedByName ? `${e.changedByName} · ` : ""}
                {ROLE_LABEL[e.changedByRole]}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
