import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { MobilePortalBar, RailNav } from "@/components/layout/portal-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABEL } from "@/lib/constants";
import { data } from "@/lib/data";
import { signOut } from "../(auth)/actions";

async function navProps() {
  const user = await requireUser();
  const [unread, wards, departments] = await Promise.all([data.unreadNotificationCount(user), data.listWards(), data.listDepartments()]);
  const ward = wards.find((w) => w.wardId === user.wardId)?.name;
  const dept = departments.find((d) => d.departmentId === user.departmentId)?.name;
  const scope =
    user.role === "CITIZEN"
      ? "Citizen"
      : user.role === "STAFF"
        ? [dept, ward].filter(Boolean).join(" · ")
        : ward
          ? `Ward admin · ${ward}`
          : "Municipal commissioner";
  return { role: user.role, name: user.name, scope: scope || ROLE_LABEL[user.role], unread, signOut };
}

async function Rail() {
  return <RailNav {...await navProps()} />;
}

async function MobileBar() {
  return <MobilePortalBar {...await navProps()} />;
}

function RailSkeleton() {
  return (
    <div className="space-y-2 px-3 py-2">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-9 bg-white/8" />
      ))}
    </div>
  );
}

export default function PortalLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-64 shrink-0 bg-rail lg:block">
        <aside className="sticky top-0 flex h-dvh flex-col text-rail-foreground">
          <div className="px-6 pt-6 pb-5">
            <Logo tone="paper" href="/" />
          </div>
          <Suspense fallback={<RailSkeleton />}>
            <Rail />
          </Suspense>
        </aside>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div className="h-14 bg-rail lg:hidden" />}>
          <MobileBar />
        </Suspense>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
