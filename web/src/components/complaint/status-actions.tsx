"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { changeStatus } from "@/app/(portal)/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ComplaintStatus, Role } from "@/lib/types";

interface Copy {
  label: string;
  title: string;
  description: string;
  needsNote: boolean;
  variant?: "default" | "outline" | "destructive";
}

function copyFor(to: ComplaintStatus, from: ComplaintStatus, role: Role): Copy | null {
  switch (to) {
    case "IN_PROGRESS":
      return { label: from === "ASSIGNED" ? "Start work" : "Resume work", title: "Move to in progress", description: "Let the citizen know work has started. A note is optional.", needsNote: false };
    case "RESOLVED":
      return { label: "Mark resolved", title: "Mark as resolved", description: "Describe what was done. The citizen will be asked to confirm the fix.", needsNote: true };
    case "CLOSED":
      return role === "CITIZEN"
        ? { label: "Confirm it's fixed", title: "Confirm the fix", description: "This closes the complaint. Thank you for checking.", needsNote: false }
        : { label: "Close complaint", title: "Close without resolution", description: "Use this for invalid or out-of-scope reports. Explain why.", needsNote: true, variant: "outline" };
    case "REOPENED":
      return { label: "Not fixed, reopen", title: "Reopen this complaint", description: "Tell the team what is still wrong. It goes back to them with its history.", needsNote: true, variant: "outline" };
    default:
      // ASSIGNED (handled by reassign), ESCALATED (system only), DUPLICATE (duplicate review)
      return null;
  }
}

export function StatusActions({ complaintId, status, allowed, role }: { complaintId: number; status: ComplaintStatus; allowed: ComplaintStatus[]; role: Role }) {
  const [target, setTarget] = useState<ComplaintStatus | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const options = allowed.map((to) => ({ to, copy: copyFor(to, status, role) })).filter((o): o is { to: ComplaintStatus; copy: Copy } => o.copy !== null);
  const current = options.find((o) => o.to === target)?.copy;

  if (!options.length) return null;

  const submit = () =>
    start(async () => {
      const res = await changeStatus(complaintId, target!, note);
      if (res.ok) {
        toast.success(res.message ?? "Updated");
        setTarget(null);
        setNote("");
      } else toast.error(res.error);
    });

  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Next step</h2>
      <div className="mt-3 flex flex-col gap-2">
        {options.map((o, i) => (
          <Button key={o.to} variant={o.copy.variant ?? (i === 0 ? "default" : "outline")} onClick={() => setTarget(o.to)} className="w-full">
            {o.copy.label}
          </Button>
        ))}
      </div>
      <Dialog open={target !== null} onOpenChange={(open) => !open && !pending && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{current?.title}</DialogTitle>
            <DialogDescription>{current?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="status-note">{current?.needsNote ? "Note (required)" : "Note (optional)"}</Label>
            <Textarea id="status-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={500} placeholder={target === "RESOLVED" ? "e.g. Pothole filled with cold mix and compacted. Photos attached in the work order." : ""} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || (current?.needsNote && note.trim().length < 3)}>
              {pending ? "Saving…" : current?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
