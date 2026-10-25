"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { assignComplaint } from "@/app/(portal)/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

interface StaffOption {
  userId: number;
  name: string;
  departmentName: string;
  wardName: string;
  sameWard: boolean;
}

export function ReassignControl({ complaintId, current, staff }: { complaintId: number; current: number | null; staff: StaffOption[] }) {
  const [value, setValue] = useState(current ? String(current) : "");
  const [pending, start] = useTransition();
  const local = staff.filter((s) => s.sameWard);
  const other = staff.filter((s) => !s.sameWard);
  return (
    <div className="rounded-lg border bg-card p-4">
      <Label htmlFor="reassign" className="text-sm font-semibold">
        Assigned officer
      </Label>
      <p className="mt-0.5 text-xs text-muted-foreground">Reassigning moves the complaint to that officer&apos;s department.</p>
      <div className="mt-3 flex gap-2">
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger id="reassign" className="h-9 min-w-0 flex-1 bg-background">
            <SelectValue placeholder="Choose staff" />
          </SelectTrigger>
          <SelectContent>
            {[
              { label: "In this ward", items: local },
              { label: "Same department, other wards", items: other },
            ].map((g) =>
              g.items.length ? (
                <SelectGroup key={g.label}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {g.items.map((s) => (
                    <SelectItem key={s.userId} value={String(s.userId)}>
                      {s.name} · {s.departmentName.split(" ")[0]} · {s.wardName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null,
            )}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={pending || !value || value === String(current)}
          onClick={() =>
            start(async () => {
              const res = await assignComplaint(complaintId, Number(value));
              if (res.ok) toast.success(res.message);
              else toast.error(res.error);
            })
          }
        >
          {pending ? "Saving…" : "Assign"}
        </Button>
      </div>
    </div>
  );
}
