import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ComplaintTable } from "@/components/complaint/complaint-table";
import { EmptyState } from "@/components/layout/empty-state";
import { FilterTabs } from "@/components/layout/filter-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { StatStrip } from "@/components/layout/stat-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { OPEN_STATES } from "@/lib/constants";
import { data } from "@/lib/data";
import { slaState } from "@/lib/format";

export const metadata: Metadata = { title: "Work queue" };

type Tab = "mine" | "team" | "breached" | "done";

export default function QueuePage({ searchParams }: PageProps<"/staff/queue">) {
  return (
    <Suspense fallback={<Skeleton className="h-[560px] w-full" />}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/staff/queue">["searchParams"] }) {
  const user = await requireUser("STAFF", "ADMIN");
  const raw = (await searchParams).tab;
  const tab: Tab = raw === "team" || raw === "breached" || raw === "done" ? raw : "mine";
  const [all, matches] = await Promise.all([data.listComplaints(user), data.listDuplicateMatches(user, "PENDING")]);
  const open = all.filter((c) => OPEN_STATES.includes(c.status));
  const mine = open.filter((c) => c.assignedTo === user.userId);
  const breached = open.filter((c) => slaState(c).level === "breached");
  const dueSoon = mine.filter((c) => {
    const s = slaState(c);
    return s.level !== "breached" && s.remainingMs < 24 * 3_600_000;
  });
  const done = all.filter((c) => !OPEN_STATES.includes(c.status)).slice(0, 50);

  // Most urgent first: least time remaining (breached ones are negative).
  const byUrgency = (xs: typeof all) => [...xs].sort((a, b) => slaState(a).remainingMs - slaState(b).remainingMs);
  const rows = tab === "mine" ? byUrgency(mine) : tab === "team" ? byUrgency(open) : tab === "breached" ? byUrgency(breached) : done;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Work queue"
        description="Sorted by time left on the SLA clock, most urgent first. Open a complaint to update its status; the citizen is notified automatically."
      />
      <StatStrip
        stats={[
          { label: "Assigned to me", value: mine.length },
          { label: "Due in 24 hours", value: dueSoon.length, tone: dueSoon.length ? "signal" : "default" },
          { label: "Past deadline (team)", value: breached.length, tone: breached.length ? "danger" : "default" },
          { label: "Duplicates to review", value: matches.length, hint: matches.length ? "See Duplicate review" : undefined },
        ]}
      />
      <div className="space-y-4">
        <FilterTabs
          label="Queue filter"
          items={[
            { label: "Mine", href: "/staff/queue", active: tab === "mine", count: mine.length },
            { label: "Whole team", href: "/staff/queue?tab=team", active: tab === "team", count: open.length },
            { label: "Past deadline", href: "/staff/queue?tab=breached", active: tab === "breached", count: breached.length },
            { label: "Recently closed", href: "/staff/queue?tab=done", active: tab === "done" },
          ]}
        />
        {rows.length === 0 ? (
          <EmptyState icon={Inbox} title={tab === "mine" ? "Nothing assigned to you" : "Nothing here"}>
            {tab === "mine" ? "New complaints in your department and ward are assigned automatically to whoever has the lightest load." : "No complaints match this view."}
          </EmptyState>
        ) : (
          <ComplaintTable complaints={rows} hrefFor={(c) => `/staff/complaints/${c.complaintId}`} columns={tab === "mine" ? ["category", "ward", "sla", "upvotes"] : ["category", "ward", "assignee", "sla"]} />
        )}
      </div>
    </div>
  );
}
