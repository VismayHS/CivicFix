import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ComplaintTable } from "@/components/complaint/complaint-table";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { STATUS_LABEL } from "@/lib/constants";
import { data } from "@/lib/data";
import type { ComplaintFilter, ComplaintStatus } from "@/lib/types";

export const metadata: Metadata = { title: "All complaints" };

const selectClass = "h-9 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

export default function AdminComplaintsPage({ searchParams }: PageProps<"/admin/complaints">) {
  return (
    <div className="space-y-8">
      <PageHeader title="All complaints" description="Every complaint in your scope. Filter, then open one to reassign it or close it." />
      <Suspense fallback={<Skeleton className="h-[560px] w-full" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/admin/complaints">["searchParams"] }) {
  const user = await requireUser("ADMIN");
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const status = str(sp.status) as ComplaintFilter["status"] | "";
  const filter: ComplaintFilter = {
    status: status || "ALL",
    wardId: Number(sp.ward) || undefined,
    departmentId: Number(sp.department) || undefined,
    q: str(sp.q).slice(0, 100) || undefined,
  };
  const [rows, wards, departments] = await Promise.all([data.listComplaints(user, filter), data.listWards(), data.listDepartments()]);
  const shown = rows.slice(0, 100);
  return (
    <div className="space-y-5">
      <form className="flex flex-wrap items-center gap-2">
        <label htmlFor="q" className="sr-only">Search</label>
        <Input id="q" name="q" defaultValue={filter.q} placeholder="Search title, text or number" className="h-9 w-64 bg-card" />
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={status} className={selectClass}>
          <option value="">Any status</option>
          <option value="ACTIVE">All open</option>
          {(Object.keys(STATUS_LABEL) as ComplaintStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        {!user.wardId && (
          <>
            <label htmlFor="ward" className="sr-only">Ward</label>
            <select id="ward" name="ward" defaultValue={filter.wardId ?? ""} className={selectClass}>
              <option value="">All wards</option>
              {wards.map((w) => <option key={w.wardId} value={w.wardId}>{w.name}</option>)}
            </select>
          </>
        )}
        <label htmlFor="department" className="sr-only">Department</label>
        <select id="department" name="department" defaultValue={filter.departmentId ?? ""} className={selectClass}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.departmentId} value={d.departmentId}>{d.name}</option>)}
        </select>
        <Button type="submit" variant="outline">Apply</Button>
        <span className="ml-auto text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "complaint" : "complaints"}{rows.length > shown.length && `, showing the newest ${shown.length}`}
        </span>
      </form>
      {shown.length === 0 ? (
        <EmptyState icon={SearchX} title="No complaints match these filters" />
      ) : (
        <ComplaintTable complaints={shown} hrefFor={(c) => `/admin/complaints/${c.complaintId}`} columns={["ward", "department", "assignee", "sla"]} />
      )}
    </div>
  );
}
