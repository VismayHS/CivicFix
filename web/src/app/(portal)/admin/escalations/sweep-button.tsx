"use client";

import { Play } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { runSlaSweep } from "@/app/(portal)/actions";
import { Button } from "@/components/ui/button";

export function SweepButton({ awaiting }: { awaiting: number }) {
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await runSlaSweep();
          if (!res.ok) return void toast.error(res.error);
          const n = res.data?.escalated ?? 0;
          toast.success(n ? `Sweep escalated ${n} complaint${n === 1 ? "" : "s"}` : "Sweep finished. Nothing new to escalate.", {
            description: "Same procedure pg_cron runs every 5 minutes: CALL sp_escalate_overdue();",
          });
        })
      }
    >
      <Play data-icon="inline-start" /> {pending ? "Running…" : `Run SLA sweep now${awaiting ? ` (${awaiting})` : ""}`}
    </Button>
  );
}
