"use client";

import { CheckCheck, Play } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { runAutoClose, runSlaSweep } from "@/app/(portal)/actions";
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
            description: "Same procedure pg_cron runs every 15 minutes: CALL sp_escalate_overdue();",
          });
        })
      }
    >
      <Play data-icon="inline-start" /> {pending ? "Running…" : `Run SLA sweep now${awaiting ? ` (${awaiting})` : ""}`}
    </Button>
  );
}

export function AutoCloseButton({ due }: { due: number }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await runAutoClose();
          if (!res.ok) return void toast.error(res.error);
          const n = res.data?.closed ?? 0;
          toast.success(n ? `Closed ${n} complaint${n === 1 ? "" : "s"} resolved over 7 days ago` : "Nothing to close. Every resolved complaint is still in its 7-day review window.", {
            description: "Same procedure pg_cron runs nightly at 02:30: CALL sp_auto_close_resolved();",
          });
        })
      }
    >
      <CheckCheck data-icon="inline-start" /> {pending ? "Closing…" : `Run auto-close${due ? ` (${due})` : ""}`}
    </Button>
  );
}
