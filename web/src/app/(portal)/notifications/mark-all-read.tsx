"use client";

import { CheckCheck } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { markNotificationsRead } from "@/app/(portal)/actions";
import { Button } from "@/components/ui/button";

export function MarkAllRead() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await markNotificationsRead("all");
          if (!res.ok) toast.error(res.error);
        })
      }
    >
      <CheckCheck data-icon="inline-start" /> Mark all as read
    </Button>
  );
}
