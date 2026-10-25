import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FiledToast, WithdrawButton } from "@/components/complaint/citizen-actions";
import { ComplaintDetailView } from "@/components/complaint/complaint-detail-view";
import { StatusActions } from "@/components/complaint/status-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { data } from "@/lib/data";

export default function CitizenComplaintPage({ params }: PageProps<"/me/complaints/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[560px] w-full" />}>
      <Body params={params} />
    </Suspense>
  );
}

async function Body({ params }: { params: PageProps<"/me/complaints/[id]">["params"] }) {
  const user = await requireUser("CITIZEN");
  const id = Number((await params).id);
  const detail = await data.getComplaint(user, id);
  if (!detail) notFound();
  const c = detail.complaint;
  const canWithdraw = c.status === "OPEN" || c.status === "ASSIGNED";
  return (
    <>
      <FiledToast complaintId={c.complaintId} />
      <ComplaintDetailView
        detail={detail}
        backHref="/me/complaints"
        backLabel="My complaints"
        linkBase="/track"
        showFiler={false}
        actions={
          detail.allowedTransitions.length > 0 || canWithdraw ? (
            <div className="space-y-2">
              {c.status === "RESOLVED" && (
                <p className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">The team marked this resolved. Is it fixed?</p>
              )}
              <StatusActions complaintId={c.complaintId} status={c.status} allowed={detail.allowedTransitions} role="CITIZEN" />
              {canWithdraw && <WithdrawButton complaintId={c.complaintId} />}
            </div>
          ) : null
        }
      />
    </>
  );
}
