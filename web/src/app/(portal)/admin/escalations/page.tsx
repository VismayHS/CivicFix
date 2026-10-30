import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ComplaintRef } from "@/components/complaint/complaint-ref";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatStrip } from "@/components/layout/stat-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { ESCALATION_LEVELS, OPEN_STATES } from "@/lib/constants";
import { data } from "@/lib/data";
import { formatShortDateTime, slaState } from "@/lib/format";
import type { Escalation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AutoCloseButton, SweepButton } from "./sweep-button";

export const metadata: Metadata = { title: "Escalations" };

// Same rule as sp_auto_close_resolved: resolved more than 7 days ago
function pastReviewWindow(c: { resolvedAt: string | null }) {
  return c.resolvedAt !== null && new Date(c.resolvedAt).getTime() < Date.now() - 7 * 24 * 3_600_000;
}

export default function EscalationsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[560px] w-full" />}>
      <Body />
    </Suspense>
  );
}

async function Body() {
  const user = await requireUser("ADMIN");
  const [escalations, complaints, resolved] = await Promise.all([
    data.listEscalations(user),
    data.listComplaints(user, { status: "ACTIVE" }),
    data.listComplaints(user, { status: "RESOLVED" }),
  ]);
  const awaitingSweep = complaints.filter((c) => OPEN_STATES.includes(c.status) && slaState(c).level === "breached" && c.escalationLevel === 0).length;
  const dueToClose = resolved.filter(pastReviewWindow).length;

  // Group rows into one chain per complaint
  const chains = new Map<number, Escalation[]>();
  for (const e of escalations) chains.set(e.complaintId, [...(chains.get(e.complaintId) ?? []), e]);
  const ordered = [...chains.values()].map((list) => list.sort((a, b) => a.escalationLevel - b.escalationLevel)).sort((a, b) => b[b.length - 1].escalatedAt.localeCompare(a[a.length - 1].escalatedAt));
  const active = ordered.filter((list) => list.some((e) => !e.resolvedAt));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Escalations"
        description="When a complaint passes its deadline, the SLA sweep (sp_escalate_overdue, run by pg_cron every 15 minutes) escalates it: department head at breach, ward administrator after 24 h, commissioner after 48 h. A complaint left resolved for 7 days without the citizen confirming or reopening it is closed by sp_auto_close_resolved, nightly at 02:30."
        actions={
          <>
            <AutoCloseButton due={dueToClose} />
            <SweepButton awaiting={awaitingSweep} />
          </>
        }
      />
      <StatStrip
        stats={[
          { label: "Active chains", value: active.length, tone: active.length ? "danger" : "default" },
          { label: "Overdue, not yet escalated", value: awaitingSweep, tone: awaitingSweep ? "signal" : "default", hint: awaitingSweep ? "Run the sweep to escalate them" : undefined },
          ...ESCALATION_LEVELS.map((l) => ({ label: `Level ${l.level} · ${l.label}`, value: escalations.filter((e) => e.escalationLevel === l.level).length })),
        ]}
      />
      {ordered.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No escalations">Every complaint in your scope is within its deadline.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {ordered.map((list) => {
            const first = list[0];
            const open = list.some((e) => !e.resolvedAt);
            return (
              <li key={first.complaintId} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ComplaintRef id={first.complaintId} />
                  <Link href={`/admin/complaints/${first.complaintId}`} className="font-medium hover:underline">
                    {first.complaintTitle}
                  </Link>
                  <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs font-medium", open ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok")}>{open ? "Open" : "Acknowledged"}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {first.departmentName} · {first.wardName}
                </p>
                <ol className="mt-3 grid gap-2 sm:grid-cols-3">
                  {ESCALATION_LEVELS.map((lvl) => {
                    const e = list.find((x) => x.escalationLevel === lvl.level);
                    return (
                      <li key={lvl.level} className={cn("rounded-md border px-3 py-2 text-sm", e ? (e.resolvedAt ? "border-ok/25 bg-ok-soft/50" : "border-danger/25 bg-danger-soft/50") : "border-dashed text-muted-foreground")}>
                        <p className="text-xs font-semibold">L{lvl.level} · {lvl.label}</p>
                        {e ? (
                          <p className="mt-0.5">
                            {e.escalatedToName} <span className="text-xs text-muted-foreground">· {formatShortDateTime(e.escalatedAt)} · {e.reason}</span>
                          </p>
                        ) : (
                          <p className="mt-0.5 text-xs">Not reached</p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
