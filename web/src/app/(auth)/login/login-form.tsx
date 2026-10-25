"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useRef } from "react";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/constants";
import { signIn, type AuthState } from "../actions";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action] = useActionState<AuthState, FormData>(signIn, {});
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const fill = (address: string) => {
    if (email.current) email.current.value = address;
    if (password.current) password.current.value = DEMO_PASSWORD;
    password.current?.focus();
  };

  return (
    <div className="space-y-8">
      <form action={action} className="space-y-5" noValidate>
        <input type="hidden" name="next" value={next} />
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input ref={email} id="email" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} aria-invalid={!!state.fieldErrors?.email} aria-describedby="email-error" className="h-10 bg-card" />
          {state.fieldErrors?.email && <p id="email-error" className="text-sm text-destructive">{state.fieldErrors.email}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input ref={password} id="password" name="password" type="password" autoComplete="current-password" aria-invalid={!!state.fieldErrors?.password} aria-describedby="password-error" className="h-10 bg-card" />
          {state.fieldErrors?.password && <p id="password-error" className="text-sm text-destructive">{state.fieldErrors.password}</p>}
        </div>
        <SubmitButton className="h-10 w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
        <p className="text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"} className="font-medium text-primary hover:underline">
            Create a citizen account
          </Link>
        </p>
      </form>

      <div className="rounded-lg border border-dashed bg-card/60 p-4">
        <p className="text-sm font-medium">Demo accounts</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Password for all: <span className="font-mono text-foreground">{DEMO_PASSWORD}</span>. Pick one to fill the form.
        </p>
        <ul className="mt-3 grid gap-1.5">
          {DEMO_ACCOUNTS.map((a) => (
            <li key={a.email}>
              <button
                type="button"
                onClick={() => fill(a.email)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <span>
                  <span className="font-medium">{a.name}</span>
                  <span className="block text-xs text-muted-foreground">{a.label}</span>
                </span>
                <span className="font-mono text-[0.7rem] text-muted-foreground">{a.email}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
