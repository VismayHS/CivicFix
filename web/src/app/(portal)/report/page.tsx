import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { ReportWizard } from "./report-wizard";

export const metadata: Metadata = { title: "Report an issue" };

export default function ReportPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Report an issue" description="Three short steps. As you describe the problem we check for similar open reports nearby, so you can back an existing one instead of filing twice." />
      <Suspense fallback={<Skeleton className="h-[520px] w-full" />}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  await requireUser("CITIZEN");
  const [wards, categories, departments] = await Promise.all([data.listWards(), data.listCategories(), data.listDepartments()]);
  return <ReportWizard wards={wards} categories={categories} departments={departments} />;
}
