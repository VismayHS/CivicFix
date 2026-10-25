import type { Metadata } from "next";
import { Suspense } from "react";
import { OpenByDepartmentChart, SlaByDepartmentChart } from "@/components/charts/charts";
import { PageHeader, Section } from "@/components/layout/page-header";
import { StatStrip } from "@/components/layout/stat-strip";
import { ComplaintsMap } from "@/components/map";
import { Skeleton } from "@/components/ui/skeleton";
import { data } from "@/lib/data";
import { formatHours, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "City dashboard" };

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-10 sm:px-6 md:py-14">
      <PageHeader
        title="How Bengaluru's wards are doing"
        description="Live figures from every complaint filed through CivicFix. Updated as staff change status; deadlines come from each category's SLA."
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardBody />
      </Suspense>
    </div>
  );
}

async function DashboardBody() {
  const s = await data.getPublicStats();
  const breached = s.byWard.reduce((n, w) => n + w.breached, 0);
  const wards = [...s.byWard].sort((a, b) => b.open - a.open);
  return (
    <>
      <StatStrip
        stats={[
          { label: "Open complaints", value: s.totals.open },
          { label: "Past deadline now", value: breached, tone: breached ? "danger" : "default" },
          { label: "Resolved this month", value: s.totals.resolvedThisMonth },
          { label: "Median time to resolve", value: formatHours(s.totals.medianResolutionHours) },
          { label: "Resolved within SLA", value: formatPct(s.totals.slaMetPct), tone: (s.totals.slaMetPct ?? 0) >= 75 ? "ok" : "signal" },
        ]}
      />

      <Section title="Reports on the map" description="Complaints from the last 45 days. Colour shows status: blue in progress, red escalated, green resolved.">
        <div className="overflow-hidden rounded-lg border bg-card p-1.5">
          <ComplaintsMap points={s.mapPoints} />
        </div>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Resolved within SLA, by department" description="Share of resolved complaints closed before their deadline. Amber is below 70%.">
          <div className="rounded-lg border bg-card p-4">
            <SlaByDepartmentChart rows={s.byDepartment} />
          </div>
        </Section>
        <Section title="Open work by department" description="Red shows open complaints already past their deadline.">
          <div className="rounded-lg border bg-card p-4">
            <OpenByDepartmentChart rows={s.byDepartment} />
          </div>
        </Section>
      </div>

      <Section title="Ward by ward">
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-medium">Ward</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Zone</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Open</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Past deadline</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Resolved</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Avg. time</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Within SLA</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {wards.map((w) => (
                <tr key={w.wardId} className="border-b last:border-0">
                  <td className="px-4 py-2.5 font-sans font-medium">{w.wardName}</td>
                  <td className="px-3 py-2.5 font-sans text-muted-foreground">{w.zone}</td>
                  <td className="px-3 py-2.5 text-right">{w.open}</td>
                  <td className={cn("px-3 py-2.5 text-right", w.breached > 0 && "text-danger")}>{w.breached}</td>
                  <td className="px-3 py-2.5 text-right">{w.resolved}</td>
                  <td className="px-3 py-2.5 text-right">{formatHours(w.avgResolutionHours)}</td>
                  <td className="px-4 py-2.5 text-right">{formatPct(w.slaMetPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-10">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-[430px] w-full" />
      <div className="grid gap-10 lg:grid-cols-2">
        <Skeleton className="h-[320px]" />
        <Skeleton className="h-[320px]" />
      </div>
    </div>
  );
}
