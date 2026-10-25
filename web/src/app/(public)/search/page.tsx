import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ComplaintRef } from "@/components/complaint/complaint-ref";
import { SlaBar } from "@/components/complaint/sla-bar";
import { StatusBadge } from "@/components/complaint/status-badge";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { data } from "@/lib/data";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Search reports" };

const selectClass =
  "h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6 md:py-14">
      <PageHeader
        title="Has someone already reported it?"
        description="Search open and resolved complaints by keyword. If you find yours, upvote it instead of filing again; it raises its priority."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <SearchBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SearchBody({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 120) : "";
  const wardId = Number(sp.ward) || undefined;
  const categoryId = Number(sp.category) || undefined;
  const [wards, categories] = await Promise.all([data.listWards(), data.listCategories()]);
  const searched = q.length > 0 || wardId || categoryId;
  const results = searched ? await data.searchPublicComplaints(q, { wardId, categoryId }) : [];

  return (
    <div className="space-y-6">
      <form role="search" className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="q" className="sr-only">Keywords</label>
        <Input id="q" name="q" defaultValue={q} placeholder="e.g. streetlight 12th Main, garbage, water leak" className="h-10 flex-1 bg-card" autoFocus={!searched} />
        <label htmlFor="ward" className="sr-only">Ward</label>
        <select id="ward" name="ward" defaultValue={wardId ?? ""} className={selectClass}>
          <option value="">All wards</option>
          {wards.map((w) => (
            <option key={w.wardId} value={w.wardId}>{w.name}</option>
          ))}
        </select>
        <label htmlFor="category" className="sr-only">Category</label>
        <select id="category" name="category" defaultValue={categoryId ?? ""} className={selectClass}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.categoryId} value={c.categoryId}>{c.name}</option>
          ))}
        </select>
        <Button type="submit" className="h-10">Search</Button>
      </form>

      {!searched ? (
        <p className="text-sm text-muted-foreground">Keyword search matches exact words. When you file a report we also run a meaning-based check, so &ldquo;crater&rdquo; still finds &ldquo;pothole&rdquo;.</p>
      ) : results.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No matching reports"
          action={
            <Button asChild>
              <Link href="/report">Report it now</Link>
            </Button>
          }
        >
          Nothing matches {q ? <>&ldquo;{q}&rdquo;</> : "those filters"}. Try fewer words, or file a new report.
        </EmptyState>
      ) : (
        <div>
          <p className="mb-3 text-sm text-muted-foreground">
            {results.length} {results.length === 1 ? "report" : "reports"} found
          </p>
          <ul className="divide-y rounded-lg border bg-card">
            {results.map((c) => (
              <li key={c.complaintId}>
                <Link href={`/track/${c.complaintId}`} className="grid gap-2 px-4 py-4 transition-colors hover:bg-accent/40 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <ComplaintRef id={c.complaintId} />
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="mt-1 font-medium">{c.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.categoryName} · {c.wardName} · filed {timeAgo(c.createdAt)} · {c.upvoteCount} upvotes
                    </p>
                  </div>
                  <SlaBar complaint={c} className="sm:w-56" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
