import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { VectorConsole } from "./vector-console";

export const metadata: Metadata = { title: "Vector console" };

export default function VectorPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Vector console"
        description="The Qdrant collection behind duplicate detection. Search by meaning, then read, update or delete individual points: the rubric's vector RUD, live."
      />
      <Suspense fallback={<Skeleton className="h-[560px] w-full" />}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  await requireUser("ADMIN");
  const [info, wards] = await Promise.all([data.getVectorCollection(), data.listWards()]);
  return <VectorConsole info={info} wards={wards.map((w) => ({ wardId: w.wardId, name: w.name }))} />;
}
