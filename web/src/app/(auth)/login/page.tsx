import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="font-display text-3xl font-medium">Sign in</h1>
      <p className="mt-2 mb-8 text-sm text-muted-foreground">Citizens, department staff and administrators all sign in here. You&apos;ll land on the right workspace for your role.</p>
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <LoginForm />
      </Suspense>
    </>
  );
}
