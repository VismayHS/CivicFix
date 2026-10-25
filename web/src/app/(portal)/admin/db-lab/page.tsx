import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { LabRunner } from "./lab-runner";

export const metadata: Metadata = { title: "DB Lab" };

export default function DbLabPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="DB Lab"
        description="The rubric's query catalogue, runnable against live data: joins, nested, correlated and recursive queries, CTEs, window functions, a stored function and full-text search. Each query also lives in db/queries/."
      />
      <Suspense fallback={<Skeleton className="h-[560px] w-full" />}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  await requireUser("ADMIN");
  const queries = await data.listLabQueries();
  return <LabRunner queries={queries} source={data.name} />;
}
