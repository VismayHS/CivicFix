import { ClipboardList, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ComplaintRef } from "@/components/complaint/complaint-ref";
import { SlaBar } from "@/components/complaint/sla-bar";
import { EscalationTag, StatusBadge } from "@/components/complaint/status-badge";
import { EmptyState } from "@/components/layout/empty-state";
import { FilterTabs } from "@/components/layout/filter-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { DONE_STATES, OPEN_STATES } from "@/lib/constants";
import { data } from "@/lib/data";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "My complaints" };

export default function MyComplaintsPage({ searchParams }: PageProps<"/me/complaints">) {
  return (
    <div className="space-y-8">
      <PageHeader
        title="My complaints"
        description="Everything you've reported, with its deadline and latest update."
        actions={
          <Button asChild>
            <Link href="/report">
              <Plus data-icon="inline-start" /> Report an issue
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function List({ searchParams }: { searchParams: PageProps<"/me/complaints">["searchParams"] }) {
  const user = await requireUser("CITIZEN");
  const tab = (await searchParams).tab === "closed" ? "closed" : (await searchParams).tab === "all" ? "all" : "active";
  const all = await data.listComplaints(user);
  const active = all.filter((c) => OPEN_STATES.includes(c.status));
  const closed = all.filter((c) => DONE_STATES.includes(c.status));
  const rows = tab === "active" ? active : tab === "closed" ? closed : all;
  const awaiting = all.filter((c) => c.status === "RESOLVED");

  if (all.length === 0) {
    return (
      <EmptyState icon={ClipboardList} title="You haven't reported anything yet" action={<Button asChild><Link href="/report">Report your first issue</Link></Button>}>
        When you report a pothole, garbage pile or broken light, it shows up here with its deadline and every update.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      {awaiting.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-ok/25 bg-ok-soft/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <span className="font-semibold text-ok">{awaiting.length === 1 ? "1 complaint is" : `${awaiting.length} complaints are`} marked resolved.</span> Please check and confirm, or reopen if it isn&apos;t fixed.
          </p>
          <Button asChild size="sm" variant="outline" className="bg-card">
            <Link href={`/me/complaints/${awaiting[0].complaintId}`}>Review now</Link>
          </Button>
        </div>
      )}
      <FilterTabs
        label="Filter complaints"
        items={[
          { label: "Active", href: "/me/complaints", active: tab === "active", count: active.length },
          { label: "Closed", href: "/me/complaints?tab=closed", active: tab === "closed", count: closed.length },
          { label: "All", href: "/me/complaints?tab=all", active: tab === "all", count: all.length },
        ]}
      />
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nothing here right now.</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((c) => (
            <li key={c.complaintId}>
              <Link href={`/me/complaints/${c.complaintId}`} className="grid gap-3 rounded-lg border bg-card p-4 transition-[border-color,box-shadow] duration-150 hover:border-foreground/25 hover:shadow-[0_2px_10px_-4px_rgba(20,40,60,0.18)] sm:grid-cols-[1fr_15rem] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <ComplaintRef id={c.complaintId} />
                    <StatusBadge status={c.status} />
                    <EscalationTag level={c.escalationLevel} />
                  </div>
                  <p className="mt-1.5 truncate font-medium">{c.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.categoryName} · {c.wardName} · filed {timeAgo(c.createdAt)} · {c.upvoteCount} upvotes
                  </p>
                </div>
                <SlaBar complaint={c} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
