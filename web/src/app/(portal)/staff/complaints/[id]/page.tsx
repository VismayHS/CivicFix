import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ComplaintDetailView } from "@/components/complaint/complaint-detail-view";
import { StatusActions } from "@/components/complaint/status-actions";
import { StatusBadge } from "@/components/complaint/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { complaintRef } from "@/lib/format";

export default function StaffComplaintPage({ params }: PageProps<"/staff/complaints/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[560px] w-full" />}>
      <Body params={params} />
    </Suspense>
  );
}

async function Body({ params }: { params: PageProps<"/staff/complaints/[id]">["params"] }) {
  const user = await requireUser("STAFF", "ADMIN");
  const id = Number((await params).id);
  const [detail, similar] = await Promise.all([data.getComplaint(user, id), data.similarComplaints(user, id)]);
  if (!detail) notFound();
  const c = detail.complaint;
  const notMine = user.role === "STAFF" && c.assignedTo !== user.userId && detail.allowedTransitions.length === 0;
  return (
    <ComplaintDetailView
      detail={detail}
      backHref="/staff/queue"
      backLabel="Work queue"
      linkBase="/staff/complaints"
      actions={
        <>
          {notMine && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Assigned to {c.assignedToName ?? "nobody"}. Only the assigned officer or the department head can change its status.</p>}
          <StatusActions complaintId={c.complaintId} status={c.status} allowed={detail.allowedTransitions} role={user.role} />
        </>
      }
      asideExtra={
        similar.length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Similar complaints in this ward</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Nearest neighbours by meaning, from the vector index.</p>
            <ul className="mt-3 space-y-3">
              {similar.map((s) => (
                <li key={s.complaintId} className="text-sm">
                  <Link href={`/staff/complaints/${s.complaintId}`} className="font-medium hover:underline">
                    {s.title}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{complaintRef(s.complaintId)}</span>
                    <StatusBadge status={s.status} />
                    <span className="ml-auto font-mono">{s.score.toFixed(2)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      }
    />
  );
}
