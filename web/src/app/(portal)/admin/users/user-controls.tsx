"use client";

import { UserPlus } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { createStaff, setUserActive, type CreateStaffState } from "@/app/(portal)/actions";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Department, Ward } from "@/lib/types";

export function ActiveToggle({ userId, active, disabled, name }: { userId: number; active: boolean; disabled: boolean; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Switch
      checked={active}
      disabled={disabled || pending}
      aria-label={`${name} is ${active ? "active" : "inactive"}`}
      onCheckedChange={(next) =>
        start(async () => {
          const res = await setUserActive(userId, next);
          if (res.ok) toast.success(res.message);
          else toast.error(res.error);
        })
      }
    />
  );
}

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60";

export function CreateStaffDialog({
  wards,
  departments,
  supervisors,
  lockedWardId,
}: {
  wards: Ward[];
  departments: Department[];
  supervisors: { userId: number; name: string; role: string }[];
  lockedWardId: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"STAFF" | "ADMIN">("STAFF");
  const [state, action] = useActionState<CreateStaffState, FormData>(createStaff, {});
  const err = state.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus data-icon="inline-start" /> Add staff or admin
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a staff member or administrator</DialogTitle>
          <DialogDescription>They get a temporary password to change on first sign-in.</DialogDescription>
        </DialogHeader>
        {state.created ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                Account created for <span className="font-medium">{state.created.email}</span>. Temporary password:{" "}
                <span className="font-mono font-medium text-foreground">{state.created.temporaryPassword}</span>
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
            {state.error && (
              <Alert variant="destructive" className="sm:col-span-2">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <Field id="name" label="Full name" error={err.name} className="sm:col-span-2">
              <Input id="name" name="name" autoComplete="off" aria-invalid={!!err.name} />
            </Field>
            <Field id="email" label="Email" error={err.email}>
              <Input id="email" name="email" type="email" autoComplete="off" aria-invalid={!!err.email} />
            </Field>
            <Field id="phone" label="Phone" error={err.phone}>
              <Input id="phone" name="phone" type="tel" placeholder="+9198…" aria-invalid={!!err.phone} />
            </Field>
            <Field id="role" label="Role">
              <select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value as "STAFF" | "ADMIN")} className={selectClass}>
                <option value="STAFF">Department staff</option>
                <option value="ADMIN">Ward administrator</option>
              </select>
            </Field>
            <Field id="departmentId" label="Department" error={err.departmentId}>
              <select id="departmentId" name="departmentId" disabled={role === "ADMIN"} className={selectClass} defaultValue="">
                <option value="">{role === "ADMIN" ? "Not applicable" : "Choose…"}</option>
                {departments.map((d) => <option key={d.departmentId} value={d.departmentId}>{d.name}</option>)}
              </select>
            </Field>
            <Field id="wardId" label="Ward" error={err.wardId}>
              <select id="wardId" name="wardId" className={selectClass} defaultValue={lockedWardId ?? ""} disabled={lockedWardId !== null}>
                <option value="">Choose…</option>
                {wards.map((w) => <option key={w.wardId} value={w.wardId}>{w.name}</option>)}
              </select>
              {lockedWardId !== null && <input type="hidden" name="wardId" value={lockedWardId} />}
            </Field>
            <Field id="supervisorId" label="Reports to">
              <select id="supervisorId" name="supervisorId" className={selectClass} defaultValue="">
                <option value="">Nobody</option>
                {supervisors.map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
              </select>
            </Field>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <SubmitButton pendingText="Creating…">Create account</SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, error, children, className }: { id: string; label: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
