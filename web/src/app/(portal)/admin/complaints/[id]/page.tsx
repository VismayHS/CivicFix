import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ComplaintDetailView } from "@/components/complaint/complaint-detail-view";
import { ReassignControl } from "@/components/complaint/reassign-control";
import { StatusActions } from "@/components/complaint/status-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { DONE_STATES } from "@/lib/constants";
import { data } from "@/lib/data";

export default function AdminComplaintPage({ params }: PageProps<"/admin/complaints/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[560px] w-full" />}>
      <Body params={params} />
    </Suspense>
  );
}

async function Body({ params }: { params: PageProps<"/admin/complaints/[id]">["params"] }) {
  const user = await requireUser("ADMIN");
  const id = Number((await params).id);
  const [detail, staff, wards, departments] = await Promise.all([data.getComplaint(user, id), data.listAssignableStaff(user, id), data.listWards(), data.listDepartments()]);
  if (!detail) notFound();
  const c = detail.complaint;
  const options = staff.map((s) => ({
    userId: s.userId,
    name: s.name,
    departmentName: departments.find((d) => d.departmentId === s.departmentId)?.name ?? "",
    wardName: wards.find((w) => w.wardId === s.wardId)?.name ?? "",
    sameWard: s.wardId === c.wardId,
  }));
  return (
    <ComplaintDetailView
      detail={detail}
      backHref="/admin/complaints"
      backLabel="All complaints"
      linkBase="/admin/complaints"
      actions={
        <>
          <StatusActions complaintId={c.complaintId} status={c.status} allowed={detail.allowedTransitions} role="ADMIN" />
          {!DONE_STATES.includes(c.status) && <ReassignControl complaintId={c.complaintId} current={c.assignedTo} staff={options} />}
        </>
      }
    />
  );
}
