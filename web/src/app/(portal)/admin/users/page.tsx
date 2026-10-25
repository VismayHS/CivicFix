import type { Metadata } from "next";
import { Suspense } from "react";
import { FilterTabs } from "@/components/layout/filter-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABEL } from "@/lib/constants";
import { data } from "@/lib/data";
import { formatDate } from "@/lib/format";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ActiveToggle, CreateStaffDialog } from "./user-controls";

export const metadata: Metadata = { title: "Users & roles" };

export default function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <Suspense fallback={<Skeleton className="h-[560px] w-full" />}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/admin/users">["searchParams"] }) {
  const viewer = await requireUser("ADMIN");
  const sp = await searchParams;
  const role = (["CITIZEN", "STAFF", "ADMIN"] as Role[]).find((r) => r === sp.role);
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const [everyone, wards, departments] = await Promise.all([data.listUsers(viewer), data.listWards(), data.listDepartments()]);
  const users = everyone.filter((u) => (!role || u.role === role) && (!q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase())));
  const supervisors = everyone.filter((u) => u.role !== "CITIZEN" && u.isActive).map((u) => ({ userId: u.userId, name: u.name, role: u.role }));
  const count = (r?: Role) => everyone.filter((u) => !r || u.role === r).length;
  const href = (r?: Role) => `/admin/users${r ? `?role=${r}` : ""}`;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Users & roles"
        description="Three roles, enforced twice: in the app and in PostgreSQL through database roles and Row-Level Security. Citizens register themselves; staff and administrators are created here."
        actions={<CreateStaffDialog wards={wards} departments={departments} supervisors={supervisors} lockedWardId={viewer.wardId} />}
      />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <FilterTabs
          label="Role filter"
          items={[
            { label: "Everyone", href: href(), active: !role, count: count() },
            { label: "Citizens", href: href("CITIZEN"), active: role === "CITIZEN", count: count("CITIZEN") },
            { label: "Staff", href: href("STAFF"), active: role === "STAFF", count: count("STAFF") },
            { label: "Administrators", href: href("ADMIN"), active: role === "ADMIN", count: count("ADMIN") },
          ]}
        />
        <form className="flex gap-2">
          {role && <input type="hidden" name="role" value={role} />}
          <label htmlFor="user-q" className="sr-only">Search users</label>
          <Input id="user-q" name="q" defaultValue={q} placeholder="Search name or email" className="h-9 w-56 bg-card" />
        </form>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Role</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Department</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Ward</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Phone</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Joined</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Active</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.userId} className={cn("border-b last:border-0", !u.isActive && "text-muted-foreground")}>
                <td className="px-4 py-2.5">
                  <p className="font-medium">{u.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{u.email}</p>
                </td>
                <td className="px-3 py-2.5">{u.role === "ADMIN" && u.wardId === null ? "Commissioner" : ROLE_LABEL[u.role]}</td>
                <td className="px-3 py-2.5">{departments.find((d) => d.departmentId === u.departmentId)?.name ?? "–"}</td>
                <td className="px-3 py-2.5">{wards.find((w) => w.wardId === u.wardId)?.name ?? "–"}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{u.phones.join(", ") || "–"}</td>
                <td className="px-3 py-2.5 text-xs">{formatDate(u.createdAt)}</td>
                <td className="px-4 py-2.5 text-right">
                  <ActiveToggle userId={u.userId} active={u.isActive} disabled={u.userId === viewer.userId} name={u.name} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
