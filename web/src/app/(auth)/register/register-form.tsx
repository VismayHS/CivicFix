"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { register, type AuthState } from "../actions";

const FIELDS = [
  { name: "name", label: "Full name", type: "text", autoComplete: "name", hint: null },
  { name: "email", label: "Email", type: "email", autoComplete: "email", hint: null },
  { name: "phone", label: "Mobile number", type: "tel", autoComplete: "tel", hint: "Staff may call you to locate the problem." },
  { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: "At least 8 characters." },
] as const;

export function RegisterForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action] = useActionState<AuthState, FormData>(register, {});
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {FIELDS.map((f) => {
        const err = state.fieldErrors?.[f.name];
        return (
          <div key={f.name} className="space-y-2">
            <Label htmlFor={f.name}>{f.label}</Label>
            <Input
              id={f.name}
              name={f.name}
              type={f.type}
              autoComplete={f.autoComplete}
              defaultValue={f.name === "password" ? undefined : state.values?.[f.name]}
              aria-invalid={!!err}
              aria-describedby={`${f.name}-msg`}
              className="h-10 bg-card"
            />
            {(err || f.hint) && (
              <p id={`${f.name}-msg`} className={err ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
                {err ?? f.hint}
              </p>
            )}
          </div>
        );
      })}
      <SubmitButton className="h-10 w-full" pendingText="Creating account…">
        Create account
      </SubmitButton>
      <p className="text-center text-sm text-muted-foreground">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
