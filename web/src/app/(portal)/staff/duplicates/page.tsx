import { GitMerge } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ComplaintRef } from "@/components/complaint/complaint-ref";
import { StatusBadge } from "@/components/complaint/status-badge";
import { EmptyState } from "@/components/layout/empty-state";
import { FilterTabs } from "@/components/layout/filter-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { DUPLICATE_THRESHOLD } from "@/lib/constants";
import { data } from "@/lib/data";
import { formatShortDateTime, timeAgo } from "@/lib/format";
import type { DuplicateMatch } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ReviewButtons } from "./review-buttons";

export const metadata: Metadata = { title: "Duplicate review" };

export default function DuplicatesPage({ searchParams }: PageProps<"/staff/duplicates">) {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Duplicate review"
        description={`New reports that read like an existing open complaint in the same ward (similarity ≥ ${DUPLICATE_THRESHOLD}). Merging moves upvotes to the original and closes the copy.`}
      />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/staff/duplicates">["searchParams"] }) {
  const user = await requireUser("STAFF", "ADMIN");
  const reviewed = (await searchParams).tab === "reviewed";
  const all = await data.listDuplicateMatches(user);
  const pending = all.filter((m) => m.reviewStatus === "PENDING");
  const done = all.filter((m) => m.reviewStatus !== "PENDING");
  const base = user.role === "ADMIN" ? "/admin/complaints" : "/staff/complaints";
  return (
    <div className="space-y-6">
      <FilterTabs
        label="Review filter"
        items={[
          { label: "Waiting for review", href: "/staff/duplicates", active: !reviewed, count: pending.length },
          { label: "Reviewed", href: "/staff/duplicates?tab=reviewed", active: reviewed, count: done.length },
        ]}
      />
      {!reviewed ? (
        pending.length === 0 ? (
          <EmptyState icon={GitMerge} title="No possible duplicates waiting">When a new report closely matches an open one, it appears here for a quick yes or no.</EmptyState>
        ) : (
          <ul className="space-y-5">
            {pending.map((m) => (
              <MatchCard key={`${m.complaint.complaintId}-${m.matched.complaintId}`} m={m} base={base} />
            ))}
          </ul>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-medium">New report</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Matched with</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Score</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Decision</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {done.map((m) => (
                <tr key={`${m.complaint.complaintId}-${m.matched.complaintId}`} className="border-b last:border-0">
                  <td className="px-4 py-2.5"><Link className="hover:underline" href={`${base}/${m.complaint.complaintId}`}>{m.complaint.title}</Link></td>
                  <td className="px-3 py-2.5"><Link className="hover:underline" href={`${base}/${m.matched.complaintId}`}>{m.matched.title}</Link></td>
                  <td className="px-3 py-2.5 text-right font-mono">{m.similarityScore.toFixed(2)}</td>
                  <td className={cn("px-3 py-2.5 font-medium", m.reviewStatus === "CONFIRMED" ? "text-dup" : "text-muted-foreground")}>{m.reviewStatus === "CONFIRMED" ? "Merged" : "Kept separate"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{m.reviewedByName} · {m.reviewedAt ? formatShortDateTime(m.reviewedAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MatchCard({ m, base }: { m: DuplicateMatch; base: string }) {
  const pct = Math.round(m.similarityScore * 100);
  return (
    <li className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-2.5">
        <span className="text-sm font-medium">Similarity</span>
        <span className="h-1.5 w-40 overflow-hidden rounded-full bg-[#e6e1d6]">
          <span className={cn("block h-full rounded-full", m.similarityScore >= 0.8 ? "bg-dup" : "bg-primary")} style={{ width: `${pct}%` }} />
        </span>
        <span className="font-mono text-sm">{m.similarityScore.toFixed(2)}</span>
        <span className="ml-auto text-xs text-muted-foreground">Detected {timeAgo(m.detectedAt)}</span>
      </div>
      <div className="grid md:grid-cols-2 md:divide-x">
        {[
          { label: "New report", c: m.complaint },
          { label: "Existing complaint", c: m.matched },
        ].map(({ label, c }) => (
          <div key={label} className="p-4">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ComplaintRef id={c.complaintId} />
              <StatusBadge status={c.status} />
            </div>
            <Link href={`${base}/${c.complaintId}`} className="mt-1.5 block font-medium hover:underline">
              {c.title}
            </Link>
            <p className="mt-1.5 line-clamp-3 text-sm text-foreground/80">{c.description}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {c.categoryName} · {c.wardName} · {timeAgo(c.createdAt)} · {c.upvoteCount} upvotes
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
        <ReviewButtons complaintId={m.complaint.complaintId} matchedId={m.matched.complaintId} />
      </div>
    </li>
  );
}
