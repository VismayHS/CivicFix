import { complaintRef } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ComplaintRef({ id, className }: { id: number; className?: string }) {
  return <span className={cn("font-mono text-xs tracking-tight text-muted-foreground tabular-nums", className)}>{complaintRef(id)}</span>;
}
