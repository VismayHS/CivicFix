import { ArrowLeft, MapPin } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ComplaintRef } from "@/components/complaint/complaint-ref";
import { SlaBar } from "@/components/complaint/sla-bar";
import { EscalationTag, StatusBadge } from "@/components/complaint/status-badge";
import { Timeline } from "@/components/complaint/timeline";
import { Skeleton } from "@/components/ui/skeleton";
import { data } from "@/lib/data";
import { complaintRef, formatDateTime } from "@/lib/format";

export default function PublicTrackPage({ params }: PageProps<"/track/[id]">) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:py-14">
      <Link href="/track" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Track another
      </Link>
      <Suspense fallback={<Skeleton className="mt-6 h-96 w-full" />}>
        <TrackBody params={params} />
      </Suspense>
    </div>
  );
}

async function TrackBody({ params }: { params: PageProps<"/track/[id]">["params"] }) {
  const { id } = await params;
  const result = await data.getPublicComplaint(Number(id));
  if (!result) notFound();
  const { complaint: c, history } = result;
  return (
    <article className="mt-6 grid gap-10 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <ComplaintRef id={c.complaintId} className="text-sm" />
          <StatusBadge status={c.status} />
          <EscalationTag level={c.escalationLevel} />
        </div>
        <h1 className="mt-3 font-display text-3xl leading-tight font-medium sm:text-4xl">{c.title}</h1>
        <p className="mt-4 text-[0.95rem] leading-relaxed text-foreground/80">{c.description}</p>
        {c.duplicateOf && (
          <p className="mt-4 rounded-md bg-dup-soft px-3 py-2 text-sm text-dup">
            Merged into <Link className="font-medium underline" href={`/track/${c.duplicateOf}`}>{complaintRef(c.duplicateOf)}</Link>, which is being tracked instead.
          </p>
        )}
        <section className="mt-10">
          <h2 className="mb-5 text-base font-semibold">Timeline</h2>
          <Timeline entries={history} showActors={false} />
        </section>
      </div>
      <aside className="space-y-5 lg:pt-10">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-xs font-medium text-muted-foreground">SLA clock</h2>
          <SlaBar complaint={c} size="md" className="mt-2.5" />
          <p className="mt-2 text-xs text-muted-foreground">Deadline {formatDateTime(c.slaDeadline)}</p>
        </div>
        <dl className="divide-y rounded-lg border bg-card text-sm">
          {[
            ["Category", c.categoryName],
            ["Department", c.departmentName],
            ["Ward", c.wardName],
            ["Filed", formatDateTime(c.createdAt)],
            ["Upvotes", String(c.upvoteCount)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {c.address && (
          <p className="flex gap-2 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {c.address}
          </p>
        )}
      </aside>
    </article>
  );
}
