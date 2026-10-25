import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FiledResolvedChart, SlaByDepartmentChart } from "@/components/charts/charts";
import { PageHeader, Section } from "@/components/layout/page-header";
import { StatStrip } from "@/components/layout/stat-strip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { formatHours, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

export default function AdminOverviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[640px] w-full" />}>
      <Body />
    </Suspense>
  );
}

async function Body() {
  const user = await requireUser("ADMIN");
  const [a, wards] = await Promise.all([data.getAdminAnalytics(user), data.listWards()]);
  const scope = user.wardId ? `${wards.find((w) => w.wardId === user.wardId)?.name} ward` : "all wards";
  const funnelMax = Math.max(1, ...a.escalationFunnel.map((f) => f.count));
  return (
    <div className="space-y-10">
      <PageHeader
        title="Overview"
        description={`Service levels across ${scope}. Figures come from the complaint, escalation and duplicate_match tables.`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/admin/escalations">Escalations</Link>
            </Button>
            <Button asChild>
              <Link href="/admin/complaints?status=ACTIVE">Open complaints</Link>
            </Button>
          </>
        }
      />
      <StatStrip
        stats={[
          { label: "Open now", value: a.kpis.open },
          { label: "Past deadline", value: a.kpis.breachedNow, tone: a.kpis.breachedNow ? "danger" : "default" },
          { label: "Escalated this week", value: a.kpis.escalatedThisWeek, tone: a.kpis.escalatedThisWeek ? "signal" : "default" },
          { label: "Within SLA", value: formatPct(a.kpis.slaMetPct), tone: (a.kpis.slaMetPct ?? 0) >= 75 ? "ok" : "signal" },
          { label: "Avg. resolution", value: formatHours(a.kpis.avgResolutionHours) },
          { label: "Duplicates pending", value: a.kpis.pendingDuplicates },
        ]}
      />
      <div className="grid gap-10 xl:grid-cols-[1.3fr_1fr]">
        <Section title="Filed vs resolved, last 30 days" description="When the green line stays under the blue one, the backlog is growing.">
          <div className="rounded-lg border bg-card p-4">
            <FiledResolvedChart rows={a.daily} />
          </div>
        </Section>
        <Section title="Within SLA by department" description="Amber is below 70%.">
          <div className="rounded-lg border bg-card p-4">
            <SlaByDepartmentChart rows={a.slaByDepartment} />
          </div>
        </Section>
      </div>
      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Ward ranking" description="Ranked by share resolved within SLA (RANK() OVER in SQL).">
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
                  <th scope="col" className="w-12 px-4 py-2.5 font-medium">#</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Ward</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Open</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Late</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Within SLA</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {a.wardRanking.map((w) => (
                  <tr key={w.wardId} className="border-b last:border-0">
                    <td className="px-4 py-2.5 text-muted-foreground">{w.rank}</td>
                    <td className="px-3 py-2.5 font-sans font-medium">{w.wardName}</td>
                    <td className="px-3 py-2.5 text-right">{w.open}</td>
                    <td className={cn("px-3 py-2.5 text-right", w.breached && "text-danger")}>{w.breached}</td>
                    <td className="px-4 py-2.5 text-right">{formatPct(w.slaMetPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Escalation funnel" description="How far late complaints travel up the chain.">
          <ol className="space-y-3 rounded-lg border bg-card p-5">
            {a.escalationFunnel.map((f) => (
              <li key={f.level} className="grid grid-cols-[9.5rem_1fr_3rem] items-center gap-3 text-sm">
                <span className={f.level ? "text-foreground" : "font-medium"}>{f.level ? `L${f.level} · ${f.label}` : f.label}</span>
                <span className="h-6 overflow-hidden rounded bg-muted">
                  <span className={cn("block h-full rounded", f.level === 0 ? "bg-[#c27a12]" : "bg-danger")} style={{ width: `${(f.count / funnelMax) * 100}%`, opacity: f.level ? 1 - (f.level - 1) * 0.22 : 1 }} />
                </span>
                <span className="text-right font-mono tabular-nums">{f.count}</span>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  );
}
