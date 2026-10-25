import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import BlurText from "@/components/bits/BlurText";
import CountUp from "@/components/bits/CountUp";
import { ComplaintRef } from "@/components/complaint/complaint-ref";
import { SlaBar } from "@/components/complaint/sla-bar";
import { StatusBadge } from "@/components/complaint/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { data } from "@/lib/data";
import { timeAgo } from "@/lib/format";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Suspense fallback={<FiguresSkeleton />}>
        <Figures />
      </Suspense>
      <HowItWorks />
      <DuplicateExplainer />
      <Suspense fallback={<div className="mx-auto h-112 max-w-6xl px-4 sm:px-6" />}>
        <SlaAndRecent />
      </Suspense>
      <ClosingCta />
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b">
      <div aria-hidden className="paper-grain absolute inset-0 opacity-70" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <div role="heading" aria-level={1}>
            <BlurText
              text="Report it once. We'll see it through."
              animateBy="words"
              delay={90}
              stepDuration={0.4}
              trigger="load"
              className="font-display text-[2.7rem] leading-[1.04] font-medium tracking-tight text-foreground sm:text-6xl lg:text-[4.25rem]"
            />
          </div>
          <p className="mt-6 max-w-xl text-lg text-foreground/75">
            CivicFix sends your complaint to the right Bengaluru department, checks whether a neighbour already reported it, and escalates it automatically when a repair deadline slips.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/report">
                Report an issue <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/track">Track a complaint</Link>
            </Button>
          </div>
          <ul className="mt-10 grid max-w-lg gap-2.5 text-sm text-foreground/80 sm:grid-cols-2">
            {["Routed to the right department", "A repair deadline on every report", "Duplicates merged, not ignored", "Escalates without you chasing it"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check className="size-4 text-ok" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <HeroDocket />
      </div>
    </section>
  );
}

/** The product, shown working: one complaint moving through its SLA. */
function HeroDocket() {
  const H = 3_600_000;
  const t0 = Date.UTC(2026, 9, 21, 8, 10);
  const c = {
    createdAt: new Date(t0).toISOString(),
    slaDeadline: new Date(t0 + 72 * H).toISOString(),
    resolvedAt: null,
    status: "ESCALATED" as const,
  };
  const steps = [
    { t: "Mon 8:10 am", text: "Filed by Priya N. · routed to Roads & Infrastructure" },
    { t: "Mon 8:14 am", text: "Auto-assigned to the Koramangala field team" },
    { t: "Thu 8:15 am", text: "72-hour deadline missed · escalated to department head" },
  ];
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div className="rounded-xl border bg-card p-5 shadow-[0_24px_60px_-28px_rgba(20,40,60,0.45)] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-muted-foreground">CF-01042 · Koramangala</span>
          <StatusBadge status="ESCALATED" />
        </div>
        <p className="mt-3 text-lg leading-snug font-semibold">Deep pothole near Sony World junction</p>
        <p className="mt-1 text-sm text-muted-foreground">Pothole or damaged road · 72 h SLA · 23 neighbours upvoted</p>
        <SlaBar complaint={c} size="md" className="mt-5" now={t0 + 79 * H} />
        <ol className="mt-6 space-y-3 border-t pt-5">
          {steps.map((s, i) => (
            <li key={s.t} className="reveal flex gap-3 text-sm" style={{ ["--i" as string]: i + 3 }}>
              <span className="w-24 shrink-0 font-mono text-xs leading-5 text-muted-foreground">{s.t}</span>
              <span className={i === 2 ? "font-medium text-danger" : "text-foreground/85"}>{s.text}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="reveal absolute -bottom-6 -left-4 hidden w-64 rounded-lg border bg-card p-3.5 text-sm shadow-[0_16px_40px_-24px_rgba(20,40,60,0.5)] sm:block" style={{ ["--i" as string]: 7 }}>
        <p className="font-medium">Looks like an existing report</p>
        <p className="mt-1 text-muted-foreground">&ldquo;Big crater on the road by Sony World signal&rdquo; matched CF-01042 at <span className="font-mono text-foreground">0.87</span></p>
      </div>
    </div>
  );
}

async function Figures() {
  const { totals } = await data.getPublicStats();
  const items = [
    { label: "Resolved this month", value: totals.resolvedThisMonth, decimals: 0, suffix: "" },
    { label: "Median time to resolve", value: totals.medianResolutionHours ?? 0, decimals: 1, suffix: " h" },
    { label: "Resolved within SLA", value: totals.slaMetPct ?? 0, decimals: 0, suffix: "%" },
    { label: "Duplicate reports merged", value: totals.duplicatesCaught, decimals: 0, suffix: "" },
  ];
  return (
    <section aria-label="City figures" className="border-b bg-card">
      <dl className="mx-auto grid max-w-6xl grid-cols-2 px-4 sm:px-6 lg:grid-cols-4">
        {items.map((it, i) => (
          <div key={it.label} className={`py-8 ${i % 2 ? "pl-6" : "pr-6"} lg:px-6 ${i ? "lg:border-l" : "lg:pl-0"} ${i > 1 ? "border-t lg:border-t-0" : ""}`}>
            <dt className="text-sm text-muted-foreground">{it.label}</dt>
            <dd className="mt-2 font-mono text-4xl font-medium tracking-tight tabular-nums">
              <CountUp to={it.value} decimals={it.decimals} duration={1.4} suffix={it.suffix} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function FiguresSkeleton() {
  return (
    <section className="border-b bg-card">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-24" />
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { title: "Describe what's wrong", text: "Pick a category, drop a pin, and write it in your own words. As you type we show similar open reports nearby, so you can back one instead of filing it again." },
    { title: "It lands with the right team", text: "The category decides the department and the repair deadline: 12 hours for a fallen tree, 72 for a pothole. The least-loaded field officer in your ward gets it within minutes." },
    { title: "Late work goes up the chain", text: "If the deadline passes, the complaint escalates to the department head, then the ward administrator, then the commissioner. You see every step." },
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
      <h2 className="max-w-2xl font-display text-4xl leading-tight font-medium md:text-5xl">From your street to a closed ticket, in three steps</h2>
      <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
        {steps.map((s, i) => (
          <li key={s.title} className="relative">
            <div className="flex items-center gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-primary font-mono text-sm font-medium text-primary">{i + 1}</span>
              {i < steps.length - 1 && <span aria-hidden className="hidden h-px flex-1 bg-border md:block" />}
            </div>
            <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DuplicateExplainer() {
  return (
    <section className="bg-rail text-rail-foreground">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 md:py-24 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 className="font-display text-4xl leading-tight font-medium md:text-5xl">Different words, same pothole</h2>
          <p className="mt-5 max-w-lg text-rail-muted">
            Keyword search misses reports that describe the same problem differently. CivicFix compares the meaning of each new report with open ones in the same ward using sentence embeddings, and flags close matches for staff to merge.
          </p>
          <p className="mt-4 max-w-lg text-rail-muted">
            Merged reports keep every upvote, so a problem that affects forty households is treated like one.
          </p>
        </div>
        <figure className="space-y-3">
          {[
            { who: "Report A · 9:12 am", text: "Huge pothole near Silk Board signal, bikes are falling" },
            { who: "Report B · 11:47 am", text: "Big crater on the road by Silk Board junction" },
          ].map((r) => (
            <blockquote key={r.who} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <p className="font-mono text-xs text-rail-muted">{r.who}</p>
              <p className="mt-1.5 text-lg">&ldquo;{r.text}&rdquo;</p>
            </blockquote>
          ))}
          <figcaption className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-[#f1eee7] p-4 text-[#14283c]">
            <span className="text-sm">Shared keywords: only <span className="font-medium">&ldquo;Silk Board&rdquo;</span></span>
            <span className="text-sm">Example cosine similarity: <span className="font-mono font-medium">0.86</span></span>
            <span className="ml-auto rounded-full bg-[#14283c] px-2.5 py-0.5 text-xs font-semibold text-white">Flagged as duplicate</span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

async function SlaAndRecent() {
  const [categories, departments, stats] = await Promise.all([data.listCategories(), data.listDepartments(), data.getPublicStats()]);
  return (
    <section className="mx-auto grid max-w-6xl gap-14 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[1.1fr_1fr]">
      <div>
        <h2 className="font-display text-3xl font-medium md:text-4xl">Every category has a deadline</h2>
        <p className="mt-3 max-w-lg text-muted-foreground">Deadlines are set per category by the municipality and stored with the category, so every report of the same kind gets the same promise.</p>
        <div className="mt-8 overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-medium">Category</th>
                <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Department</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {[...categories].sort((a, b) => a.slaHours - b.slaHours).map((c) => (
                <tr key={c.categoryId} className="border-b last:border-0">
                  <td className="px-4 py-2.5">{c.name}</td>
                  <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{departments.find((d) => d.departmentId === c.departmentId)?.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{c.slaHours < 48 ? `${c.slaHours} h` : `${c.slaHours / 24} days`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <div className="flex items-end justify-between gap-4">
          <h2 className="font-display text-3xl font-medium md:text-4xl">Recently fixed</h2>
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            City dashboard <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </div>
        <ul className="mt-8 divide-y rounded-lg border bg-card">
          {stats.recentResolved.map((c) => (
            <li key={c.complaintId}>
              <Link href={`/track/${c.complaintId}`} className="block px-4 py-3.5 transition-colors hover:bg-accent/40">
                <div className="flex items-center justify-between gap-3">
                  <ComplaintRef id={c.complaintId} />
                  <StatusBadge status={c.status} />
                </div>
                <p className="mt-1 truncate font-medium">{c.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {c.wardName} · fixed {timeAgo(c.resolvedAt!)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="border-t bg-[#efebe2]">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-display text-3xl font-medium">Seen something that needs fixing?</h2>
          <p className="mt-2 text-muted-foreground">It takes about a minute. You can track it without calling anyone.</p>
        </div>
        <Button asChild size="lg">
          <Link href="/report">
            Report an issue <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
