import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Stat {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "danger" | "signal" | "ok";
}

/** A ruled row of figures, like the totals line of a municipal report. */
export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 overflow-hidden rounded-lg border bg-card sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none", className)}>
      {stats.map((s) => (
        <div key={s.label} className="border-r border-b px-5 py-4 last:border-r-0 lg:border-b-0">
          <dt className="text-xs font-medium text-muted-foreground">{s.label}</dt>
          <dd
            className={cn(
              "mt-1.5 font-mono text-2xl font-medium tracking-tight tabular-nums",
              s.tone === "danger" && "text-danger",
              s.tone === "signal" && "text-signal",
              s.tone === "ok" && "text-ok",
            )}
          >
            {s.value}
          </dd>
          {s.hint && <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>}
        </div>
      ))}
    </dl>
  );
}
