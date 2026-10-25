"use client";

import { ThumbsUp } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import { toggleUpvote, withdrawComplaint } from "@/app/(portal)/actions";
import { Button } from "@/components/ui/button";
import { complaintRef } from "@/lib/format";
import { cn } from "@/lib/utils";

export function UpvoteButton({ complaintId, upvoted, count, className }: { complaintId: number; upvoted: boolean; count: number; className?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant={upvoted ? "default" : "outline"}
      aria-pressed={upvoted}
      disabled={pending}
      className={cn("gap-2", className)}
      onClick={() =>
        start(async () => {
          const res = await toggleUpvote(complaintId);
          if (!res.ok) toast.error(res.error);
          else toast.success(res.data?.upvoted ? `Upvoted ${complaintRef(complaintId)}. We'll keep you posted.` : "Upvote removed.");
        })
      }
    >
      <ThumbsUp className="size-4" aria-hidden />
      {upvoted ? "Upvoted" : "Upvote"} <span className="font-mono tabular-nums">{count}</span>
    </Button>
  );
}

export function WithdrawButton({ complaintId }: { complaintId: number }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      className="w-full text-muted-foreground"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await withdrawComplaint(complaintId);
          if (res.ok) toast.success(res.message);
          else toast.error(res.error);
        })
      }
    >
      {pending ? "Withdrawing…" : "Withdraw this complaint"}
    </Button>
  );
}

/** Shows a one-time confirmation after filing, then cleans the URL. */
export function FiledToast({ complaintId }: { complaintId: number }) {
  const params = useSearchParams();
  const router = useRouter();
  const shown = useRef(false);
  useEffect(() => {
    if (params.get("filed") === "1" && !shown.current) {
      shown.current = true;
      toast.success(`Complaint ${complaintRef(complaintId)} filed`, { description: "It has been routed and assigned. Keep this reference to track it." });
      router.replace(`/me/complaints/${complaintId}`, { scroll: false });
    }
  }, [params, router, complaintId]);
  return null;
}
