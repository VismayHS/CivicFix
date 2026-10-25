import { ArrowLeft, MapPin } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ESCALATION_LEVELS } from "@/lib/constants";
import { complaintRef, formatDateTime, formatShortDateTime } from "@/lib/format";
import type { ComplaintDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ComplaintRef } from "./complaint-ref";
import { SlaBar } from "./sla-bar";
import { EscalationTag, PriorityTag, StatusBadge } from "./status-badge";
import { Timeline } from "./timeline";

interface Props {
  detail: ComplaintDetail;
  backHref: string;
  backLabel: string;
  linkBase: string;
  actions?: ReactNode;
  asideExtra?: ReactNode;
  showFiler?: boolean;
}

export function ComplaintDetailView({ detail, backHref, backLabel, linkBase, actions, asideExtra, showFiler = true }: Props) {
  const { complaint: c, history, escalations, duplicateMatches } = detail;
  return (
    <div>
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {backLabel}
      </Link>

      <header className="mt-5 border-b pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <ComplaintRef id={c.complaintId} className="text-sm" />
          <StatusBadge status={c.status} />
          <PriorityTag priority={c.priority} />
          <EscalationTag level={c.escalationLevel} />
        </div>
        <h1 className="mt-3 font-display text-3xl leading-tight font-medium sm:text-[2.15rem]">{c.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {c.categoryName} · {c.wardName} · filed {formatDateTime(c.createdAt)}
          {showFiler && <> by {c.filedByName}</>}
        </p>
      </header>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-10">
          <section>
            <h2 className="sr-only">Description</h2>
            <p className="max-w-[68ch] text-[0.98rem] leading-relaxed whitespace-pre-line text-foreground/85">{c.description}</p>
            {c.address && (
              <p className="mt-4 flex gap-2 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {c.address}
                {c.latitude !== null && <span className="font-mono text-xs">({c.latitude.toFixed(4)}, {c.longitude?.toFixed(4)})</span>}
              </p>
            )}
            {c.duplicateOf && (
              <p className="mt-4 rounded-md bg-dup-soft px-3 py-2 text-sm text-dup">
                Merged into{" "}
                <Link className="font-medium underline" href={`${linkBase}/${c.duplicateOf}`}>
                  {complaintRef(c.duplicateOf)}
                </Link>
                . Upvotes were moved there.
              </p>
            )}
          </section>

          {escalations.length > 0 && (
            <section>
              <h2 className="mb-4 text-base font-semibold">Escalation chain</h2>
              <ol className="grid gap-2 sm:grid-cols-3">
                {ESCALATION_LEVELS.map((lvl) => {
                  const e = escalations.find((x) => x.escalationLevel === lvl.level);
                  return (
                    <li key={lvl.level} className={cn("rounded-lg border p-3", e ? "border-danger/30 bg-danger-soft/60" : "border-dashed bg-card/50")}>
                      <p className={cn("text-xs font-semibold", e ? "text-danger" : "text-muted-foreground")}>Level {lvl.level} · {lvl.label}</p>
                      {e ? (
                        <>
                          <p className="mt-1 text-sm font-medium">{e.escalatedToName}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{formatShortDateTime(e.escalatedAt)} · {e.reason}</p>
                          {e.resolvedAt && <p className="mt-1 text-xs font-medium text-ok">Acknowledged {formatShortDateTime(e.resolvedAt)}</p>}
                        </>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">{lvl.hoursAfterBreach ? `${lvl.hoursAfterBreach} h after breach` : "At breach"}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          <section>
            <h2 className="mb-5 text-base font-semibold">Timeline</h2>
            <Timeline entries={history} />
          </section>
        </div>

        <aside className="space-y-5">
          {actions}
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-xs font-medium text-muted-foreground">SLA clock</h2>
            <SlaBar complaint={c} size="md" className="mt-2.5" />
            <p className="mt-2 text-xs text-muted-foreground">Deadline {formatDateTime(c.slaDeadline)}</p>
          </div>
          <dl className="divide-y rounded-lg border bg-card text-sm">
            {[
              ["Department", c.departmentName],
              ["Assigned to", c.assignedToName ?? "Unassigned"],
              ["Ward", c.wardName],
              ["Upvotes", String(c.upvoteCount)],
              ["Last update", formatShortDateTime(c.updatedAt)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {duplicateMatches.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">Possible duplicates</h2>
              <ul className="mt-3 space-y-3">
                {duplicateMatches.map((m) => {
                  const other = m.complaint.complaintId === c.complaintId ? m.matched : m.complaint;
                  return (
                    <li key={`${m.complaint.complaintId}-${m.matched.complaintId}`} className="text-sm">
                      <Link href={`${linkBase}/${other.complaintId}`} className="font-medium hover:underline">
                        {other.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {complaintRef(other.complaintId)} · similarity <span className="font-mono">{m.similarityScore.toFixed(2)}</span> ·{" "}
                        {m.reviewStatus === "PENDING" ? "awaiting review" : m.reviewStatus.toLowerCase()}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {asideExtra}
        </aside>
      </div>
    </div>
  );
}
