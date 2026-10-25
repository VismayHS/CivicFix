"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { reviewDuplicate } from "@/app/(portal)/actions";
import { Button } from "@/components/ui/button";

export function ReviewButtons({ complaintId, matchedId }: { complaintId: number; matchedId: number }) {
  const [pending, start] = useTransition();
  const decide = (decision: "CONFIRMED" | "REJECTED") =>
    start(async () => {
      const res = await reviewDuplicate(complaintId, matchedId, decision);
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
    });
  return (
    <>
      <Button variant="outline" disabled={pending} onClick={() => decide("REJECTED")}>
        Different issues
      </Button>
      <Button disabled={pending} onClick={() => decide("CONFIRMED")}>
        Same issue, merge
      </Button>
    </>
  );
}
